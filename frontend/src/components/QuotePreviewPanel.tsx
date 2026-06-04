import { X } from 'lucide-react';
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

interface OrgInfo {
  business_name?: string | null;
  address?: string | null;
  tax_id?: string | null;
  phone?: string | null;
  email?: string | null;
  website?: string | null;
}

/**
 * Centered, wide live "ตัวอย่างใบเสนอราคา" preview styled like the real
 * quotation document (company header from org_settings + bill-to + numbered
 * line items + totals). The wrapper is pointer-events-none so the cart on the
 * right stays editable while this floats over the screen; updates live.
 */
export default function QuotePreviewPanel({
  open, org, customer, benefit, lines, subtotal, memberDisc, net, vat, total,
  note, onNote, format, onClose,
}: {
  open: boolean;
  org: OrgInfo | null;
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
  const custAddr = formatThaiAddress((customer as unknown as { billing_address?: unknown }).billing_address)
    || formatThaiAddress((customer as unknown as { shipping_address?: unknown }).shipping_address);
  const discPct = benefit ? Number(benefit.discount_percent) || 0 : 0;
  const today = new Date().toLocaleDateString('th-TH', { day: '2-digit', month: '2-digit', year: 'numeric' });

  return (
    <div className="fixed inset-0 z-[1100] flex items-center justify-center p-3 sm:p-6 pointer-events-none">
      <div className="pointer-events-auto w-[94vw] max-w-4xl max-h-[92vh] bg-white rounded-2xl shadow-2xl flex flex-col overflow-hidden ring-1 ring-black/5">
        {/* Title bar */}
        <div className="px-4 py-2.5 border-b border-neutral-200 bg-neutral-50 flex items-center gap-2 flex-shrink-0">
          <div className="flex-1 text-sm font-bold text-neutral-800">ตัวอย่างใบเสนอราคา <span className="text-[11px] font-normal text-neutral-400">· ปรับรายการในตะกร้าด้านขวาได้เลย อัปเดตทันที</span></div>
          <button type="button" onClick={onClose} className="text-neutral-400 hover:text-neutral-700 p-1"><X size={18} /></button>
        </div>

        {/* Document body */}
        <div className="flex-1 overflow-y-auto p-5 sm:p-7 text-neutral-800">
          {/* ── Company header (seller) ─────────────────────────── */}
          <div className="flex items-start justify-between gap-6 border-b-2 border-indigo-500 pb-4">
            <div className="min-w-0">
              <div className="text-xl font-extrabold text-[#1e74c4] leading-tight">{org?.business_name ?? 'บริษัท เจ แนค (ประเทศไทย) จำกัด'} <span className="text-[11px] font-medium text-neutral-400">(สำนักงานใหญ่)</span></div>
              <div className="mt-1.5 text-[11px] text-neutral-600 leading-relaxed space-y-0.5">
                {org?.address && <div>{org.address}</div>}
                {org?.tax_id && <div>เลขประจำตัวผู้เสียภาษี {org.tax_id}</div>}
                {org?.phone && <div>โทร. {org.phone}</div>}
                {(org?.website || org?.email) && <div>{org?.website}{org?.website && org?.email ? ' · ' : ''}{org?.email && `Email: ${org.email}`}</div>}
              </div>
            </div>
            <div className="text-right flex-shrink-0">
              <div className="text-2xl font-extrabold text-neutral-800">ใบเสนอราคา</div>
              <div className="mt-2 text-[11px] text-neutral-600 space-y-0.5">
                <div className="flex justify-between gap-4"><span className="text-neutral-400">เลขที่</span><span className="font-medium">(ออกเมื่อบันทึก)</span></div>
                <div className="flex justify-between gap-4"><span className="text-neutral-400">วันที่</span><span className="font-medium">{today}</span></div>
                {customer.contact_name && <div className="flex justify-between gap-4"><span className="text-neutral-400">ผู้ติดต่อ</span><span className="font-medium">{customer.contact_name}</span></div>}
                {(customer.phone || customer.mobile) && <div className="flex justify-between gap-4"><span className="text-neutral-400">เบอร์โทร</span><span className="font-medium">{customer.mobile || customer.phone}</span></div>}
              </div>
            </div>
          </div>

          {/* ── Bill-to (customer) ───────────────────────────────── */}
          <div className="mt-4 rounded-lg bg-neutral-50 border border-neutral-200 p-3">
            <div className="text-[10px] uppercase tracking-wider text-neutral-400 font-semibold mb-1">ลูกค้า</div>
            <div className="text-sm font-bold text-neutral-900">{customer.name}</div>
            <div className="text-[11px] text-neutral-600 mt-0.5 leading-relaxed">
              {custAddr && <div>{custAddr}</div>}
              {customer.tax_id && <div>เลขประจำตัวผู้เสียภาษี {customer.tax_id}</div>}
            </div>
          </div>

          {/* ── Items ────────────────────────────────────────────── */}
          <div className="mt-4 rounded-lg border border-neutral-200 overflow-hidden">
            <table className="w-full text-[12px]">
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
                {lines.map((l, i) => (
                  <tr key={l.id + i} className="align-top">
                    <td className="px-2 py-2 text-center text-neutral-400 tabular-nums">{i + 1}</td>
                    <td className="px-2 py-2">
                      <div className="text-neutral-800 leading-snug">{l.name}</div>
                      <div className="text-[10px] text-neutral-400 font-mono">{l.sku}{l.lineDisc > 0 ? ` · ลดสมาชิก ${format(l.lineDisc)}` : ''}</div>
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums">{l.qty}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{format(l.unit)}</td>
                    <td className="px-3 py-2 text-right tabular-nums font-semibold whitespace-nowrap">{format(l.total)}</td>
                  </tr>
                ))}
                {lines.length === 0 && (
                  <tr><td colSpan={5} className="px-2 py-5 text-center text-neutral-400">ยังไม่มีรายการ</td></tr>
                )}
              </tbody>
            </table>
          </div>

          {/* ── Totals + note ────────────────────────────────────── */}
          <div className="mt-4 flex flex-col sm:flex-row gap-4">
            <div className="flex-1 order-2 sm:order-1">
              <div className="text-[11px] font-semibold text-neutral-600 mb-1">หมายเหตุ (จะแสดงในใบเสนอราคา)</div>
              <textarea
                value={note} onChange={(e) => onNote(e.target.value)} rows={4}
                placeholder="เช่น เงื่อนไขการชำระเงิน, กำหนดส่ง, ส่วนลดพิเศษที่ตกลงกัน…"
                className="w-full rounded-md border border-neutral-200 px-2.5 py-2 text-[12px] outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 resize-none"
              />
            </div>
            <div className="w-full sm:w-72 order-1 sm:order-2 rounded-lg border border-neutral-200 p-3 space-y-1.5 text-[12px] h-fit">
              <Row label="ยอดรวมสินค้า" value={format(subtotal)} />
              {memberDisc > 0 && <Row label={`ส่วนลดสมาชิก${benefit ? ` (${benefit.tier_label} ${discPct}%)` : ''}`} value={'− ' + format(memberDisc)} cls="text-rose-600" />}
              <Row label="ยอดหลังหักส่วนลด" value={format(net)} />
              <Row label="ภาษีมูลค่าเพิ่ม 7%" value={format(vat)} />
              <div className="border-t border-neutral-200 mt-1 pt-2 flex items-center justify-between">
                <span className="text-sm font-bold text-neutral-900">ยอดสุทธิ</span>
                <span className="text-lg font-extrabold text-indigo-700 tabular-nums">{format(total)}</span>
              </div>
            </div>
          </div>

          <p className="mt-4 text-[10px] text-neutral-400 leading-snug">
            นี่คือตัวอย่างก่อนบันทึก · กด "สร้างใบเสนอราคา" ที่ตะกร้าด้านขวาเพื่อออกเลขที่จริง แล้วหน้านี้จะปิดให้อัตโนมัติ
          </p>
        </div>
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
