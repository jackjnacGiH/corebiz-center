import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Loader2, Download, FileText, AlertCircle } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { formatThaiAddress } from '../components/CustomerPickerModal';
import {
  QuotationPreview,
  downloadQuotation,
  type QuoteData,
} from '../components/QuotationPDF';

/**
 * PublicQuote — public (no-login) quote viewer.
 *
 * A customer who never registered through the website can't open the
 * `/account` portal link, so when the system creates a quote from chat it
 * sends THIS link instead: `/q/:token`. The token is an unguessable
 * `quotes.public_token` (same secret-link model as the survey page). It calls
 * the anon-callable `get_quote_by_token` RPC, renders the quote, and lets the
 * customer download the PDF — without any account.
 */
export default function PublicQuote() {
  const { token } = useParams<{ token: string }>();
  const [state, setState] = useState<'loading' | 'ready' | 'notfound' | 'error'>('loading');
  const [data, setData] = useState<QuoteData | null>(null);
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

  // ---- Ready: header + PDF preview --------------------------------------
  return (
    <div className="min-h-screen bg-neutral-100 flex flex-col">
      {/* Top bar */}
      <header className="bg-white border-b border-neutral-200 px-4 py-3 flex items-center gap-3 sticky top-0 z-10">
        <div className="w-9 h-9 rounded-lg bg-indigo-600 text-white grid place-items-center flex-shrink-0">
          <FileText size={18} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-bold text-sm text-neutral-800 truncate">
            ใบเสนอราคา {data.code}
          </div>
          <div className="text-xs text-neutral-400 truncate">
            {data.customer_name || 'JNAC Thailand'}
          </div>
        </div>
        <button
          type="button"
          onClick={() => void downloadQuotation(data)}
          className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3.5 h-9 text-sm font-semibold text-white hover:bg-indigo-700 transition flex-shrink-0"
        >
          <Download size={15} /> ดาวน์โหลด PDF
        </button>
      </header>

      {/* PDF preview — fills the rest of the viewport */}
      <main className="flex-1 min-h-0">
        <QuotationPreview data={data} />
      </main>
    </div>
  );
}
