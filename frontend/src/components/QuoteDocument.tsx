import { formatThaiAddress } from './CustomerPickerModal';

export interface OrgInfo {
  business_name?: string | null;
  address?: string | null;
  tax_id?: string | null;
  phone?: string | null;
  email?: string | null;
  website?: string | null;
  logo_url?: string | null;
}

export interface QuoteDocItem {
  name: string;
  sku: string;
  qty: number;
  unit: number;
  /** Product unit label (ชิ้น / แพ็ค / …) shown after the quantity. */
  unitLabel?: string | null;
  lineDisc?: number;
  total: number;
}

/** Quantities: thousands separator, no decimals (e.g. 1,250). */
function formatQty(n: number): string {
  return new Intl.NumberFormat('th-TH', { maximumFractionDigits: 0 }).format(n);
}

/**
 * Shared quotation document layout (JNAC company header + bill-to + numbered
 * line items + totals + note). Used by both the live cart preview and the
 * order-management quote detail so they render identically. Pure presentation.
 */
export default function QuoteDocument({
  org, title = 'ใบเสนอราคา', code, dateLabel, customerName, customerAddress, customerTaxId,
  contactName, contactPhone, items, subtotal, discount = 0, discountLabel,
  net, vat, total, note, editableNote, format,
}: {
  org: OrgInfo | null;
  title?: string;
  code?: string | null;
  dateLabel: string;
  customerName: string;
  customerAddress?: string | null;
  customerTaxId?: string | null;
  contactName?: string | null;
  contactPhone?: string | null;
  items: QuoteDocItem[];
  subtotal: number;
  discount?: number;
  discountLabel?: string;
  net?: number;
  vat: number;
  total: number;
  note?: string | null;
  editableNote?: { value: string; onChange: (s: string) => void };
  format: (n: number) => string;
}) {
  return (
    <div className="text-neutral-800">
      {/* ── Company header (seller) ─────────────────────────── */}
      <div className="flex items-start justify-between gap-6 border-b-2 border-[#1696F4] pb-4">
        <div className="flex items-start gap-3 min-w-0">
          {org?.logo_url ? (
            <img src={org.logo_url} alt="โลโก้" className="w-12 h-12 flex-shrink-0 object-contain" />
          ) : (
            <JnacLogo className="w-12 h-12 flex-shrink-0" />
          )}
          <div className="min-w-0">
          <div className="text-xl font-extrabold text-[#1696F4] leading-tight">
            {org?.business_name ?? 'บริษัท เจ แนค (ประเทศไทย) จำกัด'} <span className="text-[11px] font-medium text-neutral-400">(สำนักงานใหญ่)</span>
          </div>
          <div className="mt-1.5 text-[11px] text-neutral-600 leading-relaxed space-y-0.5">
            {org?.address && <div>{org.address}</div>}
            {org?.tax_id && <div>เลขประจำตัวผู้เสียภาษี {org.tax_id}</div>}
            {org?.phone && <div>โทร. {org.phone}</div>}
            {(org?.website || org?.email) && <div>{org?.website}{org?.website && org?.email ? ' · ' : ''}{org?.email && `Email: ${org.email}`}</div>}
          </div>
          </div>
        </div>
        <div className="text-right flex-shrink-0">
          <div className="text-2xl font-extrabold text-neutral-800">{title}</div>
          <div className="mt-2 text-[11px] text-neutral-600 space-y-0.5 min-w-[160px]">
            <div className="flex justify-between gap-4"><span className="text-neutral-400">เลขที่</span><span className="font-mono font-medium">{code ?? '(ออกเมื่อบันทึก)'}</span></div>
            <div className="flex justify-between gap-4"><span className="text-neutral-400">วันที่</span><span className="font-medium">{dateLabel}</span></div>
            {contactName && <div className="flex justify-between gap-4"><span className="text-neutral-400">ผู้ติดต่อ</span><span className="font-medium">{contactName}</span></div>}
            {contactPhone && <div className="flex justify-between gap-4"><span className="text-neutral-400">เบอร์โทร</span><span className="font-medium">{contactPhone}</span></div>}
          </div>
        </div>
      </div>

      {/* ── Bill-to (customer) ───────────────────────────────── */}
      <div className="mt-4 rounded-lg bg-neutral-50 border border-neutral-200 p-3">
        <div className="text-[10px] uppercase tracking-wider text-neutral-400 font-semibold mb-1">ลูกค้า</div>
        <div className="text-sm font-bold text-neutral-900">{customerName}</div>
        <div className="text-[11px] text-neutral-600 mt-0.5 leading-relaxed">
          {customerAddress && <div>{customerAddress}</div>}
          {customerTaxId && <div>เลขประจำตัวผู้เสียภาษี {customerTaxId}</div>}
        </div>
      </div>

      {/* ── Items ────────────────────────────────────────────── */}
      <div className="mt-4 rounded-lg border border-neutral-200 overflow-x-auto">
        <table className="w-full min-w-[520px] text-[12px]">
          <thead className="bg-neutral-100 text-neutral-600">
            <tr>
              <th className="text-center font-semibold px-2 py-2 w-9">#</th>
              <th className="text-left font-semibold px-2 py-2">รายการ</th>
              <th className="text-right font-semibold px-2 py-2 w-16">จำนวน</th>
              <th className="text-right font-semibold px-2 py-2 w-24">หน่วยละ</th>
              <th className="text-right font-semibold px-3 py-2 w-28">รวม</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {items.map((l, i) => (
              <tr key={i} className="align-top">
                <td className="px-2 py-2 text-center text-neutral-400 tabular-nums">{i + 1}</td>
                <td className="px-2 py-2">
                  <div className="text-neutral-800 leading-snug">{l.name}</div>
                  <div className="text-[10px] text-neutral-400 font-mono">{l.sku}{(l.lineDisc ?? 0) > 0 ? ` · ลด ${format(l.lineDisc as number)}` : ''}</div>
                </td>
                <td className="px-2 py-2 text-right tabular-nums whitespace-nowrap">
                  {formatQty(l.qty)}{l.unitLabel ? <span className="text-neutral-400"> {l.unitLabel}</span> : ''}
                </td>
                <td className="px-2 py-2 text-right tabular-nums">{format(l.unit)}</td>
                <td className="px-3 py-2 text-right tabular-nums font-semibold whitespace-nowrap">{format(l.total)}</td>
              </tr>
            ))}
            {items.length === 0 && (
              <tr><td colSpan={5} className="px-2 py-5 text-center text-neutral-400">ยังไม่มีรายการ</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* ── Totals + note ────────────────────────────────────── */}
      <div className="mt-4 flex flex-col sm:flex-row gap-4">
        <div className="flex-1 order-2 sm:order-1">
          <div className="text-[11px] font-semibold text-neutral-600 mb-1">หมายเหตุ{editableNote ? ' (จะแสดงในใบเสนอราคา)' : ''}</div>
          {editableNote ? (
            <textarea
              value={editableNote.value} onChange={(e) => editableNote.onChange(e.target.value)} rows={4}
              placeholder="เช่น เงื่อนไขการชำระเงิน, กำหนดส่ง, ส่วนลดพิเศษที่ตกลงกัน…"
              className="w-full rounded-md border border-neutral-200 px-2.5 py-2 text-[12px] outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 resize-none"
            />
          ) : note ? (
            <div className="rounded-md bg-amber-50 border border-amber-100 px-2.5 py-2 text-[12px] text-amber-800 leading-relaxed whitespace-pre-line">{note}</div>
          ) : (
            <div className="text-[11px] text-neutral-300">—</div>
          )}
        </div>
        <div className="w-full sm:w-72 order-1 sm:order-2 rounded-lg border border-neutral-200 p-3 space-y-1.5 text-[12px] h-fit">
          <Row label="ยอดรวมสินค้า" value={format(subtotal)} />
          {discount > 0 && <Row label={discountLabel ?? 'ส่วนลด'} value={'− ' + format(discount)} cls="text-rose-600" />}
          {discount > 0 && net !== undefined && <Row label="ยอดหลังหักส่วนลด" value={format(net)} />}
          <Row label="ภาษีมูลค่าเพิ่ม 7%" value={format(vat)} />
          <div className="border-t border-neutral-200 mt-1 pt-2 flex items-center justify-between">
            <span className="text-sm font-bold text-neutral-900">ยอดสุทธิ</span>
            <span className="text-lg font-extrabold text-indigo-700 tabular-nums">{format(total)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

export { formatThaiAddress };

/** JNAC mark — bright-blue circular swoosh (recreated as SVG). */
export function JnacLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 100 100" className={className} fill="none" xmlns="http://www.w3.org/2000/svg" aria-label="JNAC">
      <path d="M44 11 A39.5 39.5 0 0 1 71 85" stroke="#1696F4" strokeWidth="13" strokeLinecap="round" />
      <path d="M56 89 A39.5 39.5 0 0 1 29 15" stroke="#1696F4" strokeWidth="13" strokeLinecap="round" />
    </svg>
  );
}

function Row({ label, value, cls }: { label: string; value: string; cls?: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className={`text-neutral-500 ${cls ?? ''}`}>{label}</span>
      <span className={`tabular-nums font-medium ${cls ?? 'text-neutral-800'}`}>{value}</span>
    </div>
  );
}
