import { X } from 'lucide-react';
import type { Customer } from '../lib/database.types';
import type { CustomerBenefit } from '../lib/api';
import QuoteDocument, { type OrgInfo, formatThaiAddress } from './QuoteDocument';

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
 * Centered, wide live "ตัวอย่างใบเสนอราคา" preview. Renders the shared
 * QuoteDocument so it matches the order-management quote view exactly. The
 * wrapper is pointer-events-none so the cart on the right stays editable.
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
        <div className="px-4 py-2.5 border-b border-neutral-200 bg-neutral-50 flex items-center gap-2 flex-shrink-0">
          <div className="flex-1 text-sm font-bold text-neutral-800">ตัวอย่างใบเสนอราคา <span className="text-[11px] font-normal text-neutral-400">· ปรับรายการในตะกร้าด้านขวาได้เลย อัปเดตทันที</span></div>
          <button type="button" onClick={onClose} className="text-neutral-400 hover:text-neutral-700 p-1"><X size={18} /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 sm:p-7">
          <QuoteDocument
            org={org}
            code={null}
            dateLabel={today}
            customerName={customer.name}
            customerAddress={custAddr}
            customerTaxId={customer.tax_id}
            contactName={customer.contact_name}
            contactPhone={customer.mobile || customer.phone}
            items={lines}
            subtotal={subtotal}
            discount={memberDisc}
            discountLabel={benefit ? `ส่วนลดสมาชิก (${benefit.tier_label} ${discPct}%)` : 'ส่วนลดสมาชิก'}
            net={net}
            vat={vat}
            total={total}
            editableNote={{ value: note, onChange: onNote }}
            format={format}
          />
          <p className="mt-4 text-[10px] text-neutral-400 leading-snug">
            นี่คือตัวอย่างก่อนบันทึก · กด "สร้างใบเสนอราคา" ที่ตะกร้าด้านขวาเพื่อออกเลขที่จริง แล้วหน้านี้จะปิดให้อัตโนมัติ
          </p>
        </div>
      </div>
    </div>
  );
}
