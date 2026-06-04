import { FileText, X, MapPin, User, Phone } from 'lucide-react';
import type { Customer } from '../lib/database.types';
import type { CustomerBenefit } from '../lib/api';
import { formatThaiAddress } from './CustomerPickerModal';

export interface PreviewLine {
  id: string;
  name: string;
  sku: string;
  qty: number;
  unit: number;
  lineDisc: number;
  total: number;
  mto: boolean;
}

/**
 * Live "ตัวอย่างใบเสนอราคา" preview docked on the left of the screen while the
 * cart (right) stays editable. Reflects the current customer + cart + member
 * discount exactly as the saved quote will compute. Read-only document view;
 * editing happens in the cart. A free-text note feeds the saved quote.
 */
export default function QuotePreviewPanel({
  open, customer, benefit, lines, subtotal, memberDisc, net, vat, total,
  note, onNote, format, onClose,
}: {
  open: boolean;
  customer: Customer | null;
  benefit: CustomerBenefit | null;
  lines: PreviewLine[];
  subtotal: number;
  memberDisc: number;
  net: number;
  vat: number;
  total: number;
  note: string;
  onNote: (s: string) => void;
  format: (n: number) => string;
  onClose: () => void;
}) {
  if (!open || !customer) return null;
  const addr = formatThaiAddress((customer as unknown as { billing_address?: unknown }).billing_address)
    || formatThaiAddress((customer as unknown as { shipping_address?: unknown }).shipping_address);
  const discPct = benefit ? Number(benefit.discount_percent) || 0 : 0;

  return (
    <div className="fixed left-0 top-0 bottom-0 z-[1100] w-full max-w-[420px] bg-white shadow-2xl border-r border-neutral-200 flex flex-col">
      {/* Header */}
      <div className="px-4 py-3 border-b border-neutral-200 bg-neutral-50 flex items-center gap-2 flex-shrink-0">
        <FileText size={16} className="text-indigo-500" />
        <div className="flex-1">
          <div className="text-sm font-bold text-neutral-900">ตัวอย่างใบเสนอราคา</div>
          <div className="text-[10px] text-neutral-500">ปรับรายการในตะกร้าด้านขวา ตัวอย่างจะอัปเดตทันที</div>
        </div>
        <button type="button" onClick={onClose} className="text-neutral-400 hover:text-neutral-700 p-1" title="ซ่อนตัวอย่าง"><X size={16} /></button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4 text-neutral-800">
        {/* Bill-to */}
        <div className="rounded-lg border border-neutral-200 p-3">
          <div className="text-[10px] uppercase tracking-wider text-neutral-400 font-semibold mb-1">เสนอราคาให้</div>
          <div className="text-sm font-bold text-neutral-900">{customer.name}</div>
          <div className="text-[11px] text-neutral-500 font-mono">{customer.code ?? '—'}{customer.tax_id ? ` · เลขภาษี ${customer.tax_id}` : ''}</div>
          <div className="mt-1.5 space-y-0.5 text-[11px] text-neutral-600">
            {customer.contact_name && <div className="inline-flex items-center gap-1"><User size={11} className="text-neutral-400" /> {customer.contact_name}</div>}
            {(customer.phone || customer.mobile) && <div className="inline-flex items-center gap-1"><Phone size={11} className="text-neutral-400" /> {[customer.phone, customer.mobile].filter(Boolean).join(' · ')}</div>}
            {addr && <div className="flex items-start gap-1"><MapPin size={11} className="text-neutral-400 mt-0.5 flex-shrink-0" /> <span>{addr}</span></div>}
          </div>
        </div>

        {/* Items */}
        <div className="rounded-lg border border-neutral-200 overflow-hidden">
          <table className="w-full text-[11px]">
            <thead className="bg-neutral-50 text-neutral-500">
              <tr>
                <th className="text-left font-semibold px-2 py-1.5">รายการ</th>
                <th className="text-right font-semibold px-1 py-1.5">จำนวน</th>
                <th className="text-right font-semibold px-2 py-1.5">รวม</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {lines.map((l, i) => (
                <tr key={l.id + i}>
                  <td className="px-2 py-1.5 align-top">
                    <div className="text-neutral-800 leading-snug">{l.name}</div>
                    <div className="text-[10px] text-neutral-400 font-mono">{l.sku} · {format(l.unit)}/ชิ้น{l.lineDisc > 0 ? ` · ลด ${format(l.lineDisc)}` : ''}</div>
                  </td>
                  <td className="px-1 py-1.5 text-right tabular-nums align-top">{l.qty}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums align-top font-semibold whitespace-nowrap">{format(l.total)}</td>
                </tr>
              ))}
              {lines.length === 0 && (
                <tr><td colSpan={3} className="px-2 py-4 text-center text-neutral-400">ยังไม่มีรายการ</td></tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Totals */}
        <div className="rounded-lg border border-neutral-200 p-3 space-y-1 text-[12px]">
          <Row label="ยอดรวมสินค้า" value={format(subtotal)} />
          {memberDisc > 0 && <Row label={`ส่วนลดสมาชิก${benefit ? ` (${benefit.tier_label} ${discPct}%)` : ''}`} value={'− ' + format(memberDisc)} cls="text-rose-600" />}
          <Row label="ยอดหลังหักส่วนลด" value={format(net)} />
          <Row label="ภาษีมูลค่าเพิ่ม 7%" value={format(vat)} />
          <div className="border-t border-neutral-200 mt-1 pt-1.5 flex items-center justify-between">
            <span className="text-sm font-bold text-neutral-900">ยอดสุทธิ</span>
            <span className="text-base font-extrabold text-indigo-700 tabular-nums">{format(total)}</span>
          </div>
        </div>

        {/* Editable note */}
        <div>
          <div className="text-[11px] font-semibold text-neutral-600 mb-1">หมายเหตุ (จะแสดงในใบเสนอราคา)</div>
          <textarea
            value={note} onChange={(e) => onNote(e.target.value)} rows={3}
            placeholder="เช่น เงื่อนไขการชำระเงิน, กำหนดส่ง, ส่วนลดพิเศษที่ตกลงกัน…"
            className="w-full rounded-md border border-neutral-200 px-2.5 py-2 text-[12px] outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 resize-none"
          />
        </div>

        <p className="text-[10px] text-neutral-400 leading-snug">
          นี่คือตัวอย่างก่อนบันทึก · กด "สร้างใบเสนอราคา" ที่ตะกร้าด้านขวาเพื่อออกเลขที่จริง แล้วหน้านี้จะปิดให้อัตโนมัติ
        </p>
      </div>
    </div>
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
