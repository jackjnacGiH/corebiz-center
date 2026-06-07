/**
 * QuoteDetailModal — admin view of a single quote with action buttons.
 *
 * Lets the operator:
 *   - inspect the customer + line items + totals
 *   - approve the quote, which converts it into an Order (status='pending')
 *     and links the two via quotes.converted_to_order_id
 *   - reject the quote (status='rejected') without deleting it
 *
 * The approve flow lives in quoteRecordApi.approveAsOrder — see the
 * comment there for the multi-step write sequence.
 */
import { useEffect, useState } from 'react';
import {
    FileText,
    CheckCircle2,
    XCircle,
    Loader2,
    AlertCircle,
} from 'lucide-react';
import { quoteRecordApi, orgSettingsApi, productsApi, tierApi, type QuoteListItem, type QuoteItem, type ProductWithInventory } from '../lib/api';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Pencil } from 'lucide-react';
import { cn } from '@/lib/utils';
import QuoteDocument, { type OrgInfo, formatThaiAddress } from './QuoteDocument';
import EditableQuoteItems, { type EditLine } from './EditableQuoteItems';

interface Props {
    isOpen: boolean;
    quoteId: string | null;
    onClose: () => void;
    /** Called after an approve / reject so the parent can refresh its list. */
    onChange?: () => void;
}

const STATUS_STYLES: Record<string, string> = {
    draft:    'bg-amber-50    text-amber-700   border-amber-200',
    sent:     'bg-blue-50     text-blue-700    border-blue-200',
    accepted: 'bg-emerald-50  text-emerald-700 border-emerald-200',
    rejected: 'bg-red-50      text-red-700     border-red-200',
    expired:  'bg-neutral-100 text-neutral-700 border-neutral-200',
};

const STATUS_LABELS: Record<string, string> = {
    draft:    'รอดำเนินการ',
    sent:     'ส่งให้ลูกค้าแล้ว',
    accepted: 'อนุมัติ → คำสั่งซื้อ',
    rejected: 'ปฏิเสธ',
    expired:  'หมดอายุ',
};

function formatTHB(v: number | string): string {
    return new Intl.NumberFormat('th-TH', {
        style: 'currency',
        currency: 'THB',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    }).format(Number(v));
}

export default function QuoteDetailModal({ isOpen, quoteId, onClose, onChange }: Props) {
    const [quote, setQuote] = useState<QuoteListItem | null>(null);
    const [items, setItems] = useState<QuoteItem[]>([]);
    const [loading, setLoading] = useState(false);
    const [err, setErr] = useState<string | null>(null);
    const [approving, setApproving] = useState(false);
    const [rejecting, setRejecting] = useState(false);
    const [approvedCode, setApprovedCode] = useState<string | null>(null);
    const [org, setOrg] = useState<OrgInfo | null>(null);
    const [editing, setEditing] = useState(false);
    const [products, setProducts] = useState<ProductWithInventory[]>([]);
    const [savingItems, setSavingItems] = useState(false);
    const [memberPct, setMemberPct] = useState(0);
    const [memberLabel, setMemberLabel] = useState<string>('');

    useEffect(() => {
        if (!isOpen) { setEditing(false); return; }
        orgSettingsApi.get().then((o) => setOrg(o)).catch(() => setOrg(null));
    }, [isOpen]);

    async function enterEdit() {
        setErr(null);
        try {
            if (products.length === 0) setProducts(await productsApi.list());
            const custId = quote?.customer?.id;
            if (custId) {
                const b = await tierApi.customerBenefit(custId).catch(() => null);
                setMemberPct(b ? Number(b.discount_percent) || 0 : 0);
                setMemberLabel(b?.tier_label ?? '');
            } else {
                setMemberPct(0); setMemberLabel('');
            }
            setEditing(true);
        } catch (e) {
            setErr((e as Error).message);
        }
    }

    async function saveItems(lines: EditLine[], discount: number) {
        if (!quote) return;
        setSavingItems(true);
        setErr(null);
        try {
            await quoteRecordApi.updateItems(quote.id, lines.map((l) => ({
                product_id: l.product_id ?? undefined, sku: l.sku, product_name: l.product_name,
                quantity: l.quantity, unit_price: l.unit_price, unit: l.unit ?? null, discount: 0,
            })), discount);
            const fresh = await quoteRecordApi.getWithItems(quote.id);
            setQuote(fresh.quote);
            setItems(fresh.items);
            setEditing(false);
            onChange?.();
        } catch (e) {
            setErr((e as Error).message);
        } finally {
            setSavingItems(false);
        }
    }

    useEffect(() => {
        if (!isOpen || !quoteId) {
            setQuote(null);
            setItems([]);
            setApprovedCode(null);
            return;
        }
        setLoading(true);
        setErr(null);
        quoteRecordApi
            .getWithItems(quoteId)
            .then(({ quote, items }) => {
                setQuote(quote);
                setItems(items);
            })
            .catch((e) => setErr((e as Error).message))
            .finally(() => setLoading(false));
    }, [isOpen, quoteId]);

    // No second confirm dialog — opening this modal + reading the line items
    // + clicking the big green/red action button is already the deliberate
    // step. Browser-native window.confirm() on top of that felt like a
    // redundant extra click.
    async function handleApprove() {
        if (!quote) return;
        setApproving(true);
        setErr(null);
        try {
            const order = await quoteRecordApi.approveAsOrder(quote.id);
            setApprovedCode(order.code);
            onChange?.();
            // Refresh the modal so the new status renders
            const fresh = await quoteRecordApi.getWithItems(quote.id);
            setQuote(fresh.quote);
            setItems(fresh.items);
        } catch (e) {
            setErr((e as Error).message);
        } finally {
            setApproving(false);
        }
    }

    async function handleReject() {
        if (!quote) return;
        setRejecting(true);
        setErr(null);
        try {
            await quoteRecordApi.updateStatus(quote.id, 'rejected');
            onChange?.();
            const fresh = await quoteRecordApi.getWithItems(quote.id);
            setQuote(fresh.quote);
            setItems(fresh.items);
        } catch (e) {
            setErr((e as Error).message);
        } finally {
            setRejecting(false);
        }
    }

    const isActionable =
        quote && (quote.status === 'draft' || quote.status === 'sent');
    const isApproved = quote?.status === 'accepted';

    return (
        <Dialog open={isOpen} onOpenChange={(o) => !o && onClose()}>
            <DialogContent className="max-w-[calc(100vw-1.5rem)] sm:max-w-4xl p-0 gap-0 max-h-[92vh] flex flex-col">
                <DialogHeader className="px-6 py-5 border-b border-neutral-200 bg-neutral-50">
                    <div className="flex items-center gap-4">
                        <div className="w-11 h-11 rounded-lg bg-amber-500 grid place-items-center flex-shrink-0">
                            <FileText size={20} className="text-white" />
                        </div>
                        <div className="min-w-0 flex-1">
                            <DialogTitle className="text-base font-bold text-neutral-900 font-mono">
                                {quote?.code ?? 'Loading…'}
                            </DialogTitle>
                            <p className="text-[11px] text-neutral-500 mt-0.5 uppercase tracking-wider font-semibold">
                                ใบเสนอราคา (Quote)
                            </p>
                        </div>
                        {quote && (
                            <span
                                className={cn(
                                    'px-3 py-1.5 rounded-md text-xs font-bold border',
                                    STATUS_STYLES[quote.status] ?? STATUS_STYLES.draft,
                                )}
                            >
                                {STATUS_LABELS[quote.status] ?? quote.status}
                            </span>
                        )}
                    </div>
                </DialogHeader>

                <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
                    {loading && (
                        <div className="text-center py-12 text-neutral-500">
                            <Loader2 size={20} className="inline animate-spin mr-2" />
                            กำลังโหลด...
                        </div>
                    )}
                    {err && (
                        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 flex items-start gap-2">
                            <AlertCircle size={16} className="mt-0.5 flex-shrink-0" />
                            <div>{err}</div>
                        </div>
                    )}
                    {approvedCode && (
                        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700 flex items-start gap-2">
                            <CheckCircle2 size={16} className="mt-0.5 flex-shrink-0" />
                            <div>
                                ✓ อนุมัติแล้ว — สร้างคำสั่งซื้อใหม่
                                <span className="font-mono font-bold ml-1">
                                    {approvedCode}
                                </span>
                            </div>
                        </div>
                    )}

                    {quote && editing && (
                        <EditableQuoteItems
                            initial={items.map((it) => ({
                                product_id: it.product_id, sku: it.sku, product_name: it.product_name,
                                quantity: it.quantity, unit_price: Number(it.unit_price), discount: 0,
                                unit: (it as { unit?: string | null }).unit ?? null,
                            }))}
                            initialDiscount={Number(quote.discount) || items.reduce((s, it) => s + Number((it as { discount?: number }).discount ?? 0), 0)}
                            memberPct={memberPct}
                            memberLabel={memberLabel}
                            products={products}
                            format={formatTHB}
                            onSave={saveItems}
                            onCancel={() => setEditing(false)}
                            busy={savingItems}
                        />
                    )}

                    {quote && !editing && (
                        <QuoteDocument
                            org={org}
                            code={quote.code}
                            dateLabel={new Date(quote.created_at).toLocaleString('th-TH', {
                                year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
                            })}
                            customerName={quote.customer?.name ?? '— ลูกค้าทั่วไป —'}
                            customerAddress={formatThaiAddress(quote.customer?.billing_address)}
                            customerTaxId={quote.customer?.tax_id ?? null}
                            items={items.map((it) => ({
                                name: it.product_name, sku: it.sku, qty: it.quantity,
                                unit: Number(it.unit_price),
                                unitLabel: (it as { unit?: string | null }).unit ?? null,
                                lineDisc: Number((it as { discount?: number }).discount ?? 0),
                                total: Number(it.total),
                            }))}
                            subtotal={Number(quote.subtotal)}
                            discount={Number(quote.discount)}
                            net={Number(quote.subtotal) - Number(quote.discount)}
                            vat={Number(quote.vat)}
                            total={Number(quote.total)}
                            note={quote.notes}
                            format={formatTHB}
                        />
                    )}
                </div>

                {/* Action footer (hidden while editing items — the editor has its own buttons) */}
                {!editing && (
                <div className="px-6 py-4 border-t border-neutral-200 bg-neutral-50 flex flex-wrap gap-2 justify-end">
                    <Button type="button" variant="outline" onClick={onClose}>
                        ปิด
                    </Button>
                    {isActionable && (
                        <Button
                            type="button"
                            variant="outline"
                            onClick={() => void enterEdit()}
                            className="border-indigo-200 text-indigo-700 hover:bg-indigo-50 gap-1.5"
                        >
                            <Pencil size={14} /> แก้ไขรายการ
                        </Button>
                    )}
                    {isActionable && (
                        <>
                            <Button
                                type="button"
                                variant="outline"
                                onClick={handleReject}
                                disabled={approving || rejecting}
                                className="border-red-200 text-red-700 hover:bg-red-50 hover:text-red-800"
                            >
                                {rejecting ? (
                                    <Loader2 size={14} className="animate-spin mr-1" />
                                ) : (
                                    <XCircle size={14} className="mr-1" />
                                )}
                                ปฏิเสธ
                            </Button>
                            <Button
                                type="button"
                                onClick={handleApprove}
                                disabled={approving || rejecting}
                                className="bg-emerald-600 hover:bg-emerald-700 gap-1.5"
                            >
                                {approving ? (
                                    <Loader2 size={14} className="animate-spin" />
                                ) : (
                                    <CheckCircle2 size={14} />
                                )}
                                อนุมัติ → สร้างคำสั่งซื้อ
                            </Button>
                        </>
                    )}
                    {isApproved && quote?.converted_to_order_id && (
                        <span className="text-xs text-emerald-700 self-center">
                            ✓ อนุมัติแล้ว — ดูในรายการคำสั่งซื้อ
                        </span>
                    )}
                </div>
                )}
            </DialogContent>
        </Dialog>
    );
}
