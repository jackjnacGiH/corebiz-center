import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Loader2, Download, FileText, AlertCircle } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { formatThaiAddress } from '../components/CustomerPickerModal';
import type { QuoteData } from '../components/QuotationPDF';

/**
 * PublicQuote — public (no-login) quote viewer.
 *
 * A customer who never registered through the website can't open the
 * `/account` portal link, so when the system creates a quote from chat it
 * sends THIS link instead: `/q/:token`. The token is an unguessable
 * `quotes.public_token` (same secret-link model as the survey page). It calls
 * the anon-callable `get_quote_by_token` RPC, renders the quote, and lets the
 * customer download the PDF — without any account.
 *
 * The on-screen quote is rendered as plain HTML (not a PDF iframe) so it shows
 * reliably on every device — most customers open the LINE link on a phone,
 * where an embedded <PDFViewer> blob iframe often renders blank. The actual PDF
 * is one tap away via "ดาวน์โหลด PDF".
 */
function fmt(n: number): string {
  return new Intl.NumberFormat('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
}
function fmtDate(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '—' : d.toLocaleDateString('th-TH', { year: 'numeric', month: 'long', day: 'numeric' });
}

export default function PublicQuote() {
  const { token } = useParams<{ token: string }>();
  const [state, setState] = useState<'loading' | 'ready' | 'notfound' | 'error'>('loading');
  const [data, setData] = useState<QuoteData | null>(null);
  const [errMsg, setErrMsg] = useState('');
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!token) { setState('notfound'); return; }
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: row, error } = await (supabase as any).rpc('get_quote_by_token', { p_token: token });
        if (error) throw error;
        if (!alive) return;
        if (!row) { setState('notfound'); return; }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const q = row as any;
        const mapped: QuoteData = {
          code: q.code,
          customer_name: q.customer_name || null,
          customer_address: formatThaiAddress(q.customer_billing_address) || null,
          customer_tax_id: q.customer_tax_id || null,
          created_at: q.created_at,
          valid_until: q.valid_until ?? null,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          items: ((q.items ?? []) as any[]).map((it) => ({
            sku: it.sku ?? '',
            product_name: it.product_name ?? '',
            quantity: Number(it.quantity ?? 0),
            unit_price: Number(it.unit_price ?? 0),
            total: Number(it.total ?? 0),
          })),
          subtotal: Number(q.subtotal ?? 0),
          discount: Number(q.discount ?? 0),
          vat: Number(q.vat ?? 0),
          total: Number(q.total ?? 0),
          notes: q.notes ?? null,
          seller: q.seller
            ? {
                name: q.seller.name || 'JNAC Thailand',
                tax_id: q.seller.tax_id ?? null,
                address: q.seller.address ?? null,
                phone: q.seller.phone ?? null,
                email: q.seller.email ?? null,
                website: q.seller.website ?? null,
                logo_url: q.seller.logo_url ?? null,
              }
            : null,
          doc_type: 'quotation',
        };
        setData(mapped);
        setState('ready');
      } catch (e) {
        if (!alive) return;
        setErrMsg((e as Error).message);
        setState('error');
      }
    })();
    return () => { alive = false; };
  }, [token]);

  async function onDownload() {
    if (!data || downloading) return;
    setDownloading(true);
    try {
      // Lazy-load the heavy @react-pdf/renderer bundle only when the customer
      // actually downloads — so the HTML quote view loads instantly on mobile.
      const { downloadQuotation } = await import('../components/QuotationPDF');
      await downloadQuotation(data);
    } catch { /* ignore — download is best-effort */ }
    finally { setDownloading(false); }
  }

  // ---- Loading / error states -------------------------------------------
  if (state !== 'ready' || !data) {
    return (
      <div className="min-h-screen bg-neutral-100 flex items-center justify-center p-4">
        <div className="w-full max-w-md bg-white rounded-2xl shadow-xl border border-neutral-100 p-8 text-center">
          {state === 'loading' && (
            <>
              <Loader2 size={40} className="mx-auto text-indigo-500 animate-spin" />
              <p className="mt-4 text-sm text-neutral-500">กำลังโหลดใบเสนอราคา…</p>
            </>
          )}
          {state === 'notfound' && (
            <>
              <FileText size={48} className="mx-auto text-neutral-300" />
              <h2 className="mt-4 text-lg font-bold text-neutral-800">ไม่พบใบเสนอราคา</h2>
              <p className="mt-2 text-sm text-neutral-500">
                ลิงก์อาจไม่ถูกต้องหรือหมดอายุแล้ว กรุณาติดต่อทีมงาน JNAC เพื่อขอลิงก์ใหม่ค่ะ
              </p>
            </>
          )}
          {state === 'error' && (
            <>
              <AlertCircle size={48} className="mx-auto text-red-400" />
              <h2 className="mt-4 text-lg font-bold text-neutral-800">เปิดใบเสนอราคาไม่สำเร็จ</h2>
              <p className="mt-2 text-sm text-neutral-500 break-all">{errMsg}</p>
            </>
          )}
          <div className="mt-6 pt-4 border-t border-neutral-100 text-center text-[10px] text-neutral-300">
            JNAC · CoreBiz Center
          </div>
        </div>
      </div>
    );
  }

  // ---- Ready: sticky header + HTML quote --------------------------------
  const seller = data.seller;
  const sellerName = seller?.name || 'JNAC Thailand';
  const sellerContact = [seller?.website, seller?.email].filter(Boolean).join('  ·  ');
  return (
    <div className="min-h-screen bg-neutral-100">
      {/* Top bar */}
      <header className="bg-white border-b border-neutral-200 px-4 py-3 flex items-center gap-3 sticky top-0 z-10">
        <div className="w-9 h-9 rounded-lg bg-indigo-600 text-white grid place-items-center flex-shrink-0">
          <FileText size={18} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-bold text-sm text-neutral-800 truncate">ใบเสนอราคา {data.code}</div>
          <div className="text-xs text-neutral-400 truncate">{data.customer_name || 'JNAC Thailand'}</div>
        </div>
        <button
          type="button"
          onClick={() => void onDownload()}
          disabled={downloading}
          className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3.5 h-9 text-sm font-semibold text-white hover:bg-indigo-700 transition flex-shrink-0 disabled:opacity-60"
        >
          {downloading ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />} ดาวน์โหลด PDF
        </button>
      </header>

      {/* Quote paper */}
      <main className="max-w-3xl mx-auto p-3 sm:p-6">
        <div className="bg-white rounded-2xl shadow-sm border border-neutral-200 overflow-hidden">
          {/* Brand + doc meta */}
          <div className="flex flex-wrap items-start justify-between gap-3 border-b-2 border-indigo-600 p-5 sm:p-6">
            <div className="flex items-start gap-3 max-w-[62%]">
              {seller?.logo_url && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={seller.logo_url} alt="logo" className="w-12 h-12 object-contain flex-shrink-0" />
              )}
              <div className="min-w-0">
                <div className="text-base font-extrabold text-indigo-600 leading-tight">{sellerName}</div>
                {seller?.address && <div className="text-[11px] text-neutral-500 mt-0.5 leading-snug">{seller.address}</div>}
                {seller?.tax_id && <div className="text-[11px] text-neutral-500">เลขประจำตัวผู้เสียภาษี {seller.tax_id}</div>}
                {seller?.phone && <div className="text-[11px] text-neutral-500">โทร. {seller.phone}</div>}
                {sellerContact && <div className="text-[11px] text-neutral-400">{sellerContact}</div>}
              </div>
            </div>
            <div className="text-right">
              <div className="text-lg font-bold text-neutral-800">ใบเสนอราคา / QUOTATION</div>
              <div className="text-xs text-neutral-500 mt-1">เลขที่ / No: {data.code}</div>
              <div className="text-xs text-neutral-500">วันที่ / Date: {fmtDate(data.created_at)}</div>
              {data.valid_until && (
                <div className="text-xs text-neutral-500">ใช้ได้ถึง / Valid until: {fmtDate(data.valid_until)}</div>
              )}
            </div>
          </div>

          {/* Customer / issuer */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 p-5 sm:p-6 border-b border-neutral-100">
            <div>
              <div className="text-[10px] uppercase tracking-wider text-neutral-400 mb-1">ลูกค้า / Customer</div>
              <div className="text-sm font-semibold text-neutral-800">{data.customer_name || '—'}</div>
              {data.customer_address && <div className="text-xs text-neutral-500 mt-0.5">{data.customer_address}</div>}
              {data.customer_tax_id && <div className="text-xs text-neutral-500 mt-0.5">เลขประจำตัวผู้เสียภาษี: {data.customer_tax_id}</div>}
            </div>
            <div className="sm:text-right">
              <div className="text-[10px] uppercase tracking-wider text-neutral-400 mb-1">ผู้ออกเอกสาร / Issued by</div>
              <div className="text-sm font-semibold text-neutral-800">{sellerName}</div>
              {seller?.phone && <div className="text-xs text-neutral-500 mt-0.5">โทร. {seller.phone}</div>}
            </div>
          </div>

          {/* Items */}
          <div className="p-5 sm:p-6">
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="bg-neutral-50 text-neutral-500 text-xs">
                    <th className="text-left font-semibold px-2 py-2 rounded-l-lg">SKU</th>
                    <th className="text-left font-semibold px-2 py-2">รายการ / Description</th>
                    <th className="text-right font-semibold px-2 py-2">จำนวน</th>
                    <th className="text-right font-semibold px-2 py-2">หน่วยละ</th>
                    <th className="text-right font-semibold px-2 py-2 rounded-r-lg">รวม</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((it, i) => (
                    <tr key={i} className="border-b border-neutral-100">
                      <td className="px-2 py-2.5 text-neutral-500 whitespace-nowrap align-top">{it.sku}</td>
                      <td className="px-2 py-2.5 text-neutral-800 align-top">{it.product_name}</td>
                      <td className="px-2 py-2.5 text-right text-neutral-700 tabular-nums align-top">{it.quantity}</td>
                      <td className="px-2 py-2.5 text-right text-neutral-700 tabular-nums align-top">{fmt(it.unit_price)}</td>
                      <td className="px-2 py-2.5 text-right font-semibold text-neutral-800 tabular-nums align-top">{fmt(it.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Totals */}
            <div className="mt-4 ml-auto w-full sm:w-72 text-sm">
              <div className="flex justify-between py-1 text-neutral-600">
                <span>ยอดสินค้า / Subtotal</span><span className="tabular-nums">{fmt(data.subtotal)}</span>
              </div>
              {data.discount > 0 && (
                <div className="flex justify-between py-1 text-neutral-600">
                  <span>ส่วนลด / Discount</span><span className="tabular-nums">- {fmt(data.discount)}</span>
                </div>
              )}
              <div className="flex justify-between py-1 text-neutral-600">
                <span>ภาษีมูลค่าเพิ่ม 7% / VAT</span><span className="tabular-nums">{fmt(data.vat)}</span>
              </div>
              <div className="flex justify-between py-2 px-3 mt-1 rounded-lg bg-indigo-600 text-white font-bold">
                <span>ยอดสุทธิ / Grand Total (THB)</span><span className="tabular-nums">{fmt(data.total)}</span>
              </div>
            </div>

            {data.notes && (
              <div className="mt-5">
                <div className="text-[10px] uppercase tracking-wider text-neutral-400 mb-1">หมายเหตุ / Notes</div>
                <div className="text-xs text-neutral-500 whitespace-pre-wrap">{data.notes}</div>
              </div>
            )}
          </div>

          <div className="px-5 sm:px-6 py-4 border-t border-neutral-100 text-[11px] text-neutral-400">
            เอกสารนี้สร้างจากระบบ CoreBiz Center — ราคาสุทธิ ทีมงานจะยืนยันอีกครั้งก่อนออกใบสั่งขาย
          </div>
        </div>

        {/* Mobile-friendly download CTA under the paper */}
        <button
          type="button"
          onClick={() => void onDownload()}
          disabled={downloading}
          className="mt-4 w-full inline-flex items-center justify-center gap-2 rounded-xl bg-indigo-600 h-12 text-sm font-bold text-white hover:bg-indigo-700 transition disabled:opacity-60"
        >
          {downloading ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
          ดาวน์โหลดใบเสนอราคา (PDF)
        </button>

        <div className="mt-4 text-center text-[10px] text-neutral-300">JNAC · CoreBiz Center</div>
      </main>
    </div>
  );
}
