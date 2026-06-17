import { useMemo, useState } from 'react';
import { Plus, X, Search, Loader2, Save, Trash2, Truck, PencilLine } from 'lucide-react';
import { getEffectivePrice, type ProductWithInventory } from '../lib/api';

export interface EditLine {
  product_id?: string | null;
  sku: string;
  product_name: string;
  quantity: number;
  unit_price: number;
  discount: number;
  /** Product unit label (ชิ้น / แพ็ค / …) shown after the quantity. */
  unit?: string | null;
}

/**
 * Editable line-item table for a quote / sales order: change qty + unit price,
 * remove a line, or add a product (searchable).
 *
 * The discount is a SINGLE bill-foot field (not per line) so each row shows its
 * full price and the discount is clearly visible at the bottom. Two ways to set
 * it:
 *   1. Tick "ใช้ส่วนลดสมาชิกระดับ …" → the tier discount % is applied and
 *      auto-recomputed whenever the items / quantities change.
 *   2. Untick it → type the discount yourself, choosing % or บาท.
 *
 * Live totals. Save returns the lines + the resolved bill-foot discount (บาท)
 * to the parent (which persists + recomputes server-side identically).
 */
export default function EditableQuoteItems({
  initial, initialDiscount = 0, memberPct = 0, memberLabel,
  products, format, onSave, onCancel, busy,
}: {
  initial: EditLine[];
  initialDiscount?: number;
  /** The customer's tier discount %, e.g. 5. 0 = no member discount available. */
  memberPct?: number;
  /** Tier label for the checkbox, e.g. "วีไอพี". */
  memberLabel?: string;
  products: ProductWithInventory[];
  format: (n: number) => string;
  onSave: (lines: EditLine[], discount: number) => void;
  onCancel: () => void;
  busy?: boolean;
}) {
  const [lines, setLines] = useState<EditLine[]>(initial);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [q, setQ] = useState('');

  const subtotal = lines.reduce((a, l) => a + l.unit_price * l.quantity, 0);

  // Does the incoming discount look like the member-tier discount? If so we
  // default the checkbox on, so editing items keeps the % in sync.
  const initialSubtotal = useMemo(
    () => initial.reduce((a, l) => a + l.unit_price * l.quantity, 0),
    [initial],
  );
  const looksLikeMember =
    memberPct > 0 && initialDiscount > 0 &&
    Math.abs(initialDiscount - Math.round(initialSubtotal * memberPct) / 100) < 1;

  const [useMember, setUseMember] = useState<boolean>(looksLikeMember);
  const [mode, setMode] = useState<'percent' | 'baht'>('baht');
  const [manualValue, setManualValue] = useState<number>(looksLikeMember ? 0 : initialDiscount);

  // Resolve the effective bill-foot discount (บาท), clamped to [0, subtotal].
  const memberDiscount = memberPct > 0 ? Math.round(subtotal * memberPct) / 100 : 0;
  const manualDiscount = mode === 'percent'
    ? Math.round(subtotal * (manualValue || 0)) / 100
    : (manualValue || 0);
  const discount = Math.min(subtotal, Math.max(0, useMember ? memberDiscount : manualDiscount));

  const net = subtotal - discount;
  const vat = Math.round(net * 0.07 * 100) / 100;
  const total = net + vat;

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
      quantity: 1, unit_price: getEffectivePrice(p), discount: 0, unit: p.unit ?? null,
    }]);
    setPickerOpen(false);
    setQ('');
  }
  // Free-text line not tied to any product (special item). No stock / Inventory.
  function addCustomLine() {
    setLines((ls) => [...ls, {
      product_id: null, sku: '', product_name: '',
      quantity: 1, unit_price: 0, discount: 0, unit: null,
    }]);
  }
  // Shipping fee — always kept as the LAST line, only one. Editable price.
  function addShippingLine() {
    setLines((ls) => [
      ...ls.filter((l) => l.sku !== 'SHIPPING'),
      { product_id: null, sku: 'SHIPPING', product_name: 'ค่าจัดส่งสินค้า', quantity: 1, unit_price: 100, discount: 0, unit: null },
    ]);
  }

  return (
    <div className="rounded-lg border border-indigo-200 bg-indigo-50/30 p-3 space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-xs font-bold text-indigo-900">แก้ไขรายการสินค้า</div>
        <div className="text-[11px] text-neutral-500">{lines.length} รายการ</div>
      </div>

      <div className="rounded-lg border border-neutral-200 bg-white overflow-x-auto">
        <table className="w-full min-w-[480px] text-[12px]">
          <thead className="bg-neutral-100 text-neutral-600">
            <tr>
              <th className="text-center font-semibold px-2 py-1.5 w-7">#</th>
              <th className="text-left font-semibold px-2 py-1.5">สินค้า</th>
              <th className="text-center font-semibold px-1 py-1.5 w-32">จำนวน</th>
              <th className="text-right font-semibold px-2 py-1.5 w-28">หน่วยละ</th>
              <th className="text-right font-semibold px-2 py-1.5 w-28">รวม</th>
              <th className="w-8" />
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {lines.map((l, i) => (
              <tr key={i} className="align-top">
                <td className="px-2 py-1.5 text-center text-neutral-400">{i + 1}</td>
                <td className="px-2 py-1.5">
                  {l.product_id == null ? (
                    <>
                      <input
                        value={l.product_name}
                        onChange={(e) => patch(i, { product_name: e.target.value })}
                        placeholder={l.sku === 'SHIPPING' ? 'ค่าจัดส่งสินค้า' : 'ชื่อรายการ (พิมพ์เอง)'}
                        className="w-full rounded border border-neutral-200 px-1.5 py-1 text-[12px] outline-none focus:border-indigo-400"
                      />
                      <div className="text-[10px] text-amber-600 mt-0.5">
                        {l.sku === 'SHIPPING' ? 'ค่าจัดส่ง · ไม่นับสต๊อก' : 'รายการพิเศษ · ไม่นับสต๊อก'}
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="text-neutral-800 leading-snug">{l.product_name}</div>
                      <div className="text-[10px] text-neutral-400 font-mono">{l.sku}</div>
                    </>
                  )}
                </td>
                <td className="px-1 py-1.5">
                  <div className="flex items-center justify-center gap-1.5">
                    <div className="inline-flex items-center rounded border border-neutral-200 overflow-hidden">
                      <button type="button" onClick={() => patch(i, { quantity: Math.max(1, l.quantity - 1) })} className="px-1.5 text-neutral-500 hover:bg-neutral-50">−</button>
                      <input type="number" min={1} step={1} value={l.quantity} onChange={(e) => patch(i, { quantity: Math.max(1, Math.floor(Number(e.target.value)) || 1) })} className="w-10 text-center outline-none py-1 tabular-nums" />
                      <button type="button" onClick={() => patch(i, { quantity: l.quantity + 1 })} className="px-1.5 text-neutral-500 hover:bg-neutral-50">+</button>
                    </div>
                    {l.unit ? <span className="text-[11px] text-neutral-400 whitespace-nowrap">{l.unit}</span> : null}
                  </div>
                </td>
                <td className="px-2 py-1.5">
                  <input type="number" min={0} step={0.01} value={l.unit_price} onChange={(e) => patch(i, { unit_price: Math.max(0, Number(e.target.value) || 0) })} className="w-full text-right rounded border border-neutral-200 px-1.5 py-1 outline-none focus:border-indigo-400 tabular-nums" />
                </td>
                <td className="px-2 py-1.5 text-right tabular-nums font-semibold whitespace-nowrap">{format(l.unit_price * l.quantity)}</td>
                <td className="px-1 py-1.5 text-center">
                  <button type="button" onClick={() => remove(i)} className="text-neutral-300 hover:text-red-600"><Trash2 size={14} /></button>
                </td>
              </tr>
            ))}
            {lines.length === 0 && (
              <tr><td colSpan={6} className="px-2 py-4 text-center text-neutral-400">ยังไม่มีรายการ — กดเพิ่มสินค้า</td></tr>
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
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => setPickerOpen(true)} className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md border border-dashed border-indigo-300 bg-white text-[12px] text-indigo-600 hover:bg-indigo-50">
              <Plus size={13} /> เพิ่มสินค้า
            </button>
            <button type="button" onClick={addCustomLine} className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md border border-dashed border-neutral-300 bg-white text-[12px] text-neutral-600 hover:bg-neutral-50">
              <PencilLine size={13} /> เพิ่มรายการพิเศษ (พิมพ์เอง)
            </button>
            <button type="button" onClick={addShippingLine} className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md border border-dashed border-emerald-300 bg-white text-[12px] text-emerald-700 hover:bg-emerald-50">
              <Truck size={13} /> เพิ่มค่าจัดส่ง
            </button>
          </div>
        )}
      </div>

      {/* Totals + actions */}
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div className="text-[12px] text-neutral-600 space-y-1.5">
          <div>ยอดรวมสินค้า: <b className="tabular-nums text-neutral-800">{format(subtotal)}</b></div>

          {/* Member-tier discount toggle */}
          {memberPct > 0 && (
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={useMember}
                onChange={(e) => setUseMember(e.target.checked)}
                className="h-3.5 w-3.5 rounded border-neutral-300 text-indigo-600 focus:ring-indigo-400"
              />
              <span>
                ใช้ส่วนลดสมาชิก{memberLabel ? `ระดับ ${memberLabel}` : ''} ({memberPct}%)
                <b className="tabular-nums text-rose-600 ml-1">− {format(memberDiscount)}</b>
              </span>
            </label>
          )}

          {/* Manual discount (when not using the member tier) */}
          {!useMember && (
            <div className="flex items-center gap-2">
              <span>ส่วนลด:</span>
              <input
                type="number" min={0} step={mode === 'percent' ? 0.01 : 1} value={manualValue}
                onChange={(e) => setManualValue(Math.max(0, Number(e.target.value) || 0))}
                className="w-24 text-right rounded border border-neutral-200 px-1.5 py-1 outline-none focus:border-indigo-400 tabular-nums"
              />
              <div className="inline-flex rounded-md border border-neutral-200 overflow-hidden text-[11px] font-semibold">
                <button type="button" onClick={() => setMode('baht')} className={mode === 'baht' ? 'px-2 py-1 bg-indigo-600 text-white' : 'px-2 py-1 text-neutral-500 hover:bg-neutral-50'}>บาท</button>
                <button type="button" onClick={() => setMode('percent')} className={mode === 'percent' ? 'px-2 py-1 bg-indigo-600 text-white' : 'px-2 py-1 text-neutral-500 hover:bg-neutral-50'}>%</button>
              </div>
              {mode === 'percent' && <span className="text-rose-600 tabular-nums">= − {format(manualDiscount)}</span>}
            </div>
          )}

          {discount > 0 && (
            <div>ยอดหลังหักส่วนลด: <b className="tabular-nums text-neutral-800">{format(net)}</b></div>
          )}
          <div>ภาษี 7%: <b className="tabular-nums text-neutral-800">{format(vat)}</b></div>
          <div className="text-sm">ยอดสุทธิ: <b className="tabular-nums text-indigo-700">{format(total)}</b></div>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={onCancel} disabled={busy} className="h-9 px-3 rounded-md border border-neutral-200 text-sm text-neutral-600 hover:bg-neutral-50 disabled:opacity-50">ยกเลิก</button>
          <button type="button" onClick={() => onSave(lines.filter((l) => l.product_name.trim() !== ''), discount)} disabled={busy} className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md bg-indigo-600 text-white text-sm font-bold hover:bg-indigo-700 disabled:opacity-50">
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} บันทึกรายการ
          </button>
        </div>
      </div>
    </div>
  );
}
