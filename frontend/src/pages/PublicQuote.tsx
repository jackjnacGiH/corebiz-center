import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Loader2, Download, FileText, AlertCircle } from 'lucide-react';
import { supabase } from '../lib/supabase';
import QuoteDocument, { type OrgInfo, type QuoteDocItem, formatThaiAddress } from '../components/QuoteDocument';
import { printElement } from '../lib/print';

/**
 * PublicQuote — public (no-login) quote viewer.
 *
 * A customer who never registered through the website can't open the
 * `/account` portal link, so when the system creates a quote from chat it
 * sends THIS link instead: `/q/:token`. The token is an unguessable
 * `quotes.public_token` (same secret-link model as the survey page). It calls
 * the anon-callable `get_quote_by_token` RPC and renders the quote.
 *
 * It reuses the SAME <QuoteDocument> component as the in-system quote view, so
 * the customer sees an identical document. "ดาวน์โหลด PDF" uses the same
 * printElement() popup as the admin (browser print → Save as PDF), which is
 * reliable across devices and produces an identical-looking document.
 */
interface QuoteView {
  code: string;
  created_at: string;
  valid_until?: string | null;
  customerName: string;
  customerAddress?: string | null;
  customerTaxId?: string | null;
  org: OrgInfo;
  items: QuoteDocItem[];
  subtotal: number;
  discount: number;
  vat: number;
  total: number;
  note?: string | null;
}

const DOC_ID = 'public-quote-doc';

function fmtMoney(n: number): string {
  return new Intl.NumberFormat('th-TH', { style: 'currency', currency: 'THB' }).format(n);
}
function fmtDate(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '—' : d.toLocaleDateString('th-TH', { year: 'numeric', month: 'long', day: 'numeric' });
}

export default function PublicQuote() {
  const { token } = useParams<{ token: string }>();
  const [state, setState] = useState<'loading' | 'ready' | 'notfound' | 'error'>('loading');
  const [q, setQ] = useState<QuoteView | null>(null);
  const [errMsg, setErrMsg] = useState('');

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
        const r = row as any;
        const s = r.seller ?? {};
        const mapped: QuoteView = {
          code: r.code,
          created_at: r.created_at,
          valid_until: r.valid_until ?? null,
          customerName: r.customer_name || '—',
          customerAddress: formatThaiAddress(r.customer_billing_address) || null,
          customerTaxId: r.customer_tax_id || null,
          org: {
            business_name: s.name || 'บริษัท เจ แนค (ประเทศไทย) จำกัด',
            address: s.address ?? null,
            tax_id: s.tax_id ?? null,
            phone: s.phone ?? null,
            email: s.email ?? null,
            website: s.website ?? null,
            logo_url: s.logo_url ?? null,
          },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          items: ((r.items ?? []) as any[]).map((it) => ({
            name: it.product_name ?? '',
            sku: it.sku ?? '',
            qty: Number(it.quantity ?? 0),
            unit: Number(it.unit_price ?? 0),
            unitLabel: it.unit ?? null,
            lineDisc: Number(it.discount ?? 0),
            total: Number(it.total ?? 0),
          })),
          subtotal: Number(r.subtotal ?? 0),
          discount: Number(r.discount ?? 0),
          vat: Number(r.vat ?? 0),
          total: Number(r.total ?? 0),
          note: r.notes ?? null,
        };
        setQ(mapped);
        setState('ready');
      } catch (e) {
        if (!alive) return;
        setErrMsg((e as Error).message);
        setState('error');
      }
    })();
    return () => { alive = false; };
  }, [token]);

  function onDownload() {
    if (!q) return;
    printElement(DOC_ID, { title: `ใบเสนอราคา ${q.code}`, copies: ['ต้นฉบับ'] });
  }

  // ---- Loading / error states -------------------------------------------
  if (state !== 'ready' || !q) {
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

  const dateLabel = q.valid_until
    ? `${fmtDate(q.created_at)} (ยืนราคาถึง ${fmtDate(q.valid_until)})`
    : fmtDate(q.created_at);

  // ---- Ready: sticky header + the in-system quote document ---------------
  return (
    <div className="min-h-screen bg-neutral-100">
      <header className="bg-white border-b border-neutral-200 px-4 py-3 flex items-center gap-3 sticky top-0 z-10">
        <div className="w-9 h-9 rounded-lg bg-indigo-600 text-white grid place-items-center flex-shrink-0">
          <FileText size={18} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-bold text-sm text-neutral-800 truncate">ใบเสนอราคา {q.code}</div>
          <div className="text-xs text-neutral-400 truncate">{q.customerName}</div>
        </div>
        <button
          type="button"
          onClick={onDownload}
          className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3.5 h-9 text-sm font-semibold text-white hover:bg-indigo-700 transition flex-shrink-0"
        >
          <Download size={15} /> ดาวน์โหลด / พิมพ์ PDF
        </button>
      </header>

      <main className="max-w-3xl mx-auto p-3 sm:p-6">
        <div id={DOC_ID} className="bg-white rounded-2xl shadow-sm border border-neutral-200 p-5 sm:p-8">
          <QuoteDocument
            org={q.org}
            title="ใบเสนอราคา"
            code={q.code}
            dateLabel={dateLabel}
            customerName={q.customerName}
            customerAddress={q.customerAddress}
            customerTaxId={q.customerTaxId}
            items={q.items}
            subtotal={q.subtotal}
            discount={q.discount}
            vat={q.vat}
            total={q.total}
            note={q.note}
            format={fmtMoney}
            showSignature
          />
        </div>

        <button
          type="button"
          onClick={onDownload}
          className="mt-4 w-full inline-flex items-center justify-center gap-2 rounded-xl bg-indigo-600 h-12 text-sm font-bold text-white hover:bg-indigo-700 transition"
        >
          <Download size={16} /> ดาวน์โหลด / พิมพ์ใบเสนอราคา (PDF)
        </button>

        <div className="mt-4 text-center text-[10px] text-neutral-300">JNAC · CoreBiz Center</div>
      </main>
    </div>
  );
}
