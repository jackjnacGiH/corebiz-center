import { useMemo, useState } from 'react';
import { Plus, X, Search, Loader2, Save, Trash2 } from 'lucide-react';
import { getEffectivePrice, type ProductWithInventory } from '../lib/api';

export interface EditLine {
  product_id?: string | null;
  sku: string;
  product_name: string;
  quantity: number;
  unit_price: number;
  discount: number;
}

/**
 * Editable line-item table for a quote / sales order: change qty, unit price,
 * per-line discount, remove a line, or add a product (searchable). Live totals.
 * Save returns the full line set to the parent (which persists + recomputes).
 */
export default function EditableQuoteItems({
  initial, products, format, onSave, onCancel, busy,
}: {
  initial: EditLine[];
  products: ProductWithInventory[];
  format: (n: number) => string;
  onSave: (lines: EditLine[]) => void;
  onCancel: () => void;
  busy?: boolean;
}) {
  const [lines, setLines] = useState<EditLine[]>(initial);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [q, setQ] = useState('');

  const filtered = useMemo(() => {
    const toks = q.toLowerCase().split(/\s+/).filter(Boolean);
    const base = products.filter((p) => p.status === 'active');
    if (!toks.length) return base.slice(0, 40);
    return base.filter((p) => {
      const hay = `${p.name_th} ${p.name_en ?? ''} ${p.sku} ${p.brand ?? ''}`.toLowerCase();
      return toks.every((t) => hay.includes(t));
    }).slice(0, 40);
  }, [products, q]);

  function patch(i: number, p: Partial<EditLine>) {
    setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...p } : l)));
  }
  function remove(i: number) {
    setLines((ls) => ls.filter((_, idx) => idx !== i));
  }
  function addProduct(p: ProductWithInventory) {
    setLines((ls) => [...ls, {
      product_id: p.id, sku: p.sku, product_name: p.name_th,
      quantity: 1, unit_price: getEffectivePrice(p), discount: 0,
    }]);
    setPickerOpen(false);
    setQ('');
  }

  const subtotal = lines.reduce((a, l) => a + l.unit_price * l.quantity - (l.discount || 0), 0);
  const vat = Math.round(subtotal * 0.07 * 100) / 100;
  const total = subtotal + vat;

  return (
    <div className="rounded-lg border border-indigo-200 bg-indigo-50/30 p-3 space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-xs font-bold text-indigo-900">แก้ไขรายการสินค้า</div>
        <div className="text-[11px] text-neutral-500">{lines.length} รายการ</div>
      </div>

      <div className="rounded-lg border border-neutral-200 bg-white overflow-hidden">
        <table className="w-full text-[12px]">
          <thead className="bg-neutral-100 text-neutral-600">
            <tr>
              <th className="text-center font-semibold px-2 py-1.5 w-7">#</th>
              <th className="text-left font-semibold px-2 py-1.5">สินค้า</th>
              <th className="text-center font-semibold px-1 py-1.5 w-24">จำนวน</th>
              <th className="text-right font-semibold px-2 py-1.5 w-24">หน่วยละ</th>
              <th className="text-right font-semibold px-2 py-1.5 w-24">ส่วนลด</th>
              <th className="text-right font-semibold px-2 py-1.5 w-24">รวม</th>
              <th className="w-8" />
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {lines.map((l, i) => (
              <tr key={i} className="align-top">
                <td className="px-2 py-1.5 text-center text-neutral-400">{i + 1}</td>
                <td className="px-2 py-1.5">
                  <div className="text-neutral-800 leading-snug">{l.product_name}</div>
                  <div className="text-[10px] text-neutral-400 font-mono">{l.sku}</div>
                </td>
                <td className="px-1 py-1.5">
                  <div className="inline-flex items-center rounded border border-neutral-200 overflow-hidden">
                    <button type="button" onClick={() => patch(i, { quantity: Math.max(1, l.quantity - 1) })} className="px-1.5 text-neutral-500 hover:bg-neutral-50">−</button>
                    <input type="number" min={1} value={l.quantity} onChange={(e) => patch(i, { quantity: Math.max(1, Number(e.target.value) || 1) })} className="w-10 text-center outline-none py-1 tabular-nums" />
                    <button type="button" onClick={() => patch(i, { quantity: l.quantity + 1 })} className="px-1.5 text-neutral-500 hover:bg-neutral-50">+</button>
                  </div>
                </td>
                <td className="px-2 py-1.5">
                  <input type="number" min={0} value={l.unit_price} onChange={(e) => patch(i, { unit_price: Math.max(0, Number(e.target.value) || 0) })} className="w-full text-right rounded border border-neutral-200 px-1.5 py-1 outline-none focus:border-indigo-400 tabular-nums" />
                </td>
                <td className="px-2 py-1.5">
                  <input type="number" min={0} value={l.discount} onChange={(e) => patch(i, { discount: Math.max(0, Number(e.target.value) || 0) })} className="w-full text-right rounded border border-neutral-200 px-1.5 py-1 outline-none focus:border-indigo-400 tabular-nums" />
                </td>
                <td className="px-2 py-1.5 text-right tabular-nums font-semibold whitespace-nowrap">{format(l.unit_price * l.quantity - (l.discount || 0))}</td>
                <td className="px-1 py-1.5 text-center">
                  <button type="button" onClick={() => remove(i)} className="text-neutral-300 hover:text-red-600"><Trash2 size={14} /></button>
                </td>
              </tr>
            ))}
            {lines.length === 0 && (
              <tr><td colSpan={7} className="px-2 py-4 text-center text-neutral-400">ยังไม่มีรายการ — กดเพิ่มสินค้า</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Add product */}
      <div className="relative">
        {pickerOpen ? (
          <div className="rounded-lg border border-neutral-200 bg-white overflow-hidden">
            <div className="p-1.5 border-b border-neutral-100 relative">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral-400" />
              <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="ค้นหาสินค้า ชื่อ / SKU..." className="w-full pl-8 pr-2 py-1.5 text-sm outline-none" />
              <button type="button" onClick={() => { setPickerOpen(false); setQ(''); }} className="absolute right-2 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-neutral-700"><X size={14} /></button>
            </div>
            <div className="max-h-52 overflow-y-auto">
              {filtered.length === 0 ? (
                <div className="p-3 text-center text-xs text-neutral-400">ไม่พบสินค้า</div>
              ) : filtered.map((p) => (
                <button key={p.id} type="button" onClick={() => addProduct(p)} className="w-full text-left px-3 py-1.5 hover:bg-indigo-50 border-b border-neutral-50 last:border-0 flex items-center justify-between gap-2">
                  <span className="min-w-0">
                    <span className="block text-sm text-neutral-800 truncate">{p.name_th}</span>
                    <span className="block text-[10px] text-neutral-400 font-mono">{p.sku}</span>
                  </span>
                  <span className="text-xs text-neutral-600 tabular-nums whitespace-nowrap">{format(getEffectivePrice(p))}</span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <button type="button" onClick={() => setPickerOpen(true)} className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md border border-dashed border-indigo-300 bg-white text-[12px] text-indigo-600 hover:bg-indigo-50">
            <Plus size={13} /> เพิ่มสินค้า
          </button>
        )}
      </div>

      {/* Totals + actions */}
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div className="text-[12px] text-neutral-600 space-y-0.5">
          <div>ยอดรวมสินค้า: <b className="tabular-nums text-neutral-800">{format(subtotal)}</b></div>
          <div>ภาษี 7%: <b className="tabular-nums text-neutral-800">{format(vat)}</b></div>
          <div className="text-sm">ยอดสุทธิ: <b className="tabular-nums text-indigo-700">{format(total)}</b></div>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={onCancel} disabled={busy} className="h-9 px-3 rounded-md border border-neutral-200 text-sm text-neutral-600 hover:bg-neutral-50 disabled:opacity-50">ยกเลิก</button>
          <button type="button" onClick={() => onSave(lines)} disabled={busy} className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md bg-indigo-600 text-white text-sm font-bold hover:bg-indigo-700 disabled:opacity-50">
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} บันทึกรายการ
          </button>
        </div>
      </div>
    </div>
  );
}
