/**
 * Import CSV modal — 3 stages:
 *   1. PICK   — user drops/picks a .csv file
 *   2. PREVIEW— parsed rows shown with insert/update/error counts;
 *               user confirms or goes back
 *   3. RUN    — bulk insert/update with a progress counter and per-row
 *               result list; modal stays open until user dismisses
 *
 * Bulk write strategy:
 *   For each valid row we run productsApi.create / .update + a single
 *   inventoryApi.upsert. That's ~2 round-trips per row — fine for 100s
 *   of products. (A proper RPC batch could replace this if needed.)
 */
import { useMemo, useRef, useState, type ChangeEvent } from 'react';
import {
    Upload,
    FileDown,
    Loader2,
    AlertTriangle,
    CheckCircle2,
    X,
    ArrowLeft,
} from 'lucide-react';
import { productsApi, inventoryApi, warehousesApi, type ProductWithInventory } from '../lib/api';
import {
    parseInventoryCsv,
    buildInventoryCsv,
    downloadCsv,
    type ImportPreview,
    type ParsedRow,
} from '../lib/inventoryCsv';
import type { Category } from '../lib/database.types';
import { Button } from '@/components/ui/button';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

interface ImportInventoryModalProps {
    isOpen: boolean;
    onClose: () => void;
    onImported: () => void;
    existingProducts: ProductWithInventory[];
    categories: Category[];
}

type Stage = 'pick' | 'preview' | 'running' | 'done';

interface RowResult {
    sku: string;
    line: number;
    action: 'inserted' | 'updated' | 'failed';
    error?: string;
}

export default function ImportInventoryModal({
    isOpen,
    onClose,
    onImported,
    existingProducts,
    categories,
}: ImportInventoryModalProps) {
    const [stage, setStage] = useState<Stage>('pick');
    const [fileName, setFileName] = useState<string | null>(null);
    const [preview, setPreview] = useState<ImportPreview | null>(null);
    const [parseError, setParseError] = useState<string | null>(null);
    const [progress, setProgress] = useState({ done: 0, total: 0 });
    const [results, setResults] = useState<RowResult[]>([]);
    const fileInputRef = useRef<HTMLInputElement>(null);

    function reset() {
        setStage('pick');
        setFileName(null);
        setPreview(null);
        setParseError(null);
        setProgress({ done: 0, total: 0 });
        setResults([]);
        if (fileInputRef.current) fileInputRef.current.value = '';
    }

    function handleDialogChange(open: boolean) {
        if (!open) {
            // If the user closes mid-run, let the in-flight request finish but
            // hide the modal. We still call onImported so the table refreshes.
            if (stage === 'done' && results.length > 0) onImported();
            reset();
            onClose();
        }
    }

    async function handleFile(e: ChangeEvent<HTMLInputElement>) {
        const file = e.target.files?.[0];
        if (!file) return;
        setFileName(file.name);
        setParseError(null);
        try {
            const text = await file.text();
            const result = parseInventoryCsv(text, existingProducts, categories);
            setPreview(result);
            setStage('preview');
        } catch (err) {
            setParseError((err as Error).message);
        }
    }

    function downloadTemplate() {
        // Empty CSV with just headers, plus one example row so users can
        // see the expected format
        const example = existingProducts[0]
            ? buildInventoryCsv([existingProducts[0]])
            : buildInventoryCsv([]);
        downloadCsv('inventory-template.csv', example);
    }

    async function runImport() {
        if (!preview) return;
        const slugMap = new Map(categories.map((c) => [c.slug, c.id]));
        const skuToProduct = new Map(existingProducts.map((p) => [p.sku, p]));
        const defaultWh = await warehousesApi.getDefault().catch(() => null);

        setStage('running');
        setResults([]);
        setProgress({ done: 0, total: preview.valid.length });

        const localResults: RowResult[] = [];
        for (const row of preview.valid) {
            try {
                await commitRow(row, slugMap, skuToProduct, defaultWh?.id ?? null);
                localResults.push({
                    sku: row.sku,
                    line: row.line,
                    action: skuToProduct.has(row.sku) ? 'updated' : 'inserted',
                });
            } catch (err) {
                localResults.push({
                    sku: row.sku,
                    line: row.line,
                    action: 'failed',
                    error: (err as Error).message,
                });
            }
            setProgress((p) => ({ done: p.done + 1, total: p.total }));
            setResults([...localResults]);
        }

        setStage('done');
        onImported();
    }

    return (
        <Dialog open={isOpen} onOpenChange={handleDialogChange}>
            <DialogContent className="sm:max-w-2xl p-0 gap-0 max-h-[90vh] flex flex-col">
                {/* Header */}
                <DialogHeader className="px-6 py-5 border-b border-neutral-200 bg-neutral-50">
                    <div className="flex items-center gap-4">
                        <div className="w-11 h-11 rounded-lg bg-indigo-500 grid place-items-center flex-shrink-0">
                            <Upload size={20} className="text-white" />
                        </div>
                        <div className="min-w-0">
                            <DialogTitle className="text-lg font-bold text-neutral-900">
                                Import สินค้าจาก CSV
                            </DialogTitle>
                            <p className="text-[11px] text-neutral-500 mt-0.5 uppercase tracking-wider font-semibold">
                                {stage === 'pick'    && 'เลือกไฟล์ CSV'}
                                {stage === 'preview' && `${fileName} — ตรวจสอบก่อนนำเข้า`}
                                {stage === 'running' && 'กำลังนำเข้า...'}
                                {stage === 'done'    && 'นำเข้าเสร็จสิ้น'}
                            </p>
                        </div>
                    </div>
                </DialogHeader>

                {/* Body */}
                <div className="px-6 py-5 overflow-y-auto flex-1 space-y-4">
                    {parseError && (
                        <div className="flex items-start gap-2.5 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                            <AlertTriangle size={16} className="mt-0.5 flex-shrink-0" />
                            <span>{parseError}</span>
                        </div>
                    )}

                    {stage === 'pick' && (
                        <PickStage
                            fileInputRef={fileInputRef}
                            onPick={handleFile}
                            onDownloadTemplate={downloadTemplate}
                        />
                    )}

                    {stage === 'preview' && preview && (
                        <PreviewStage preview={preview} />
                    )}

                    {(stage === 'running' || stage === 'done') && (
                        <RunStage
                            stage={stage}
                            progress={progress}
                            results={results}
                            errors={preview?.errors ?? []}
                        />
                    )}
                </div>

                {/* Footer */}
                <div className="px-6 py-4 border-t border-neutral-200 bg-neutral-50 flex items-center justify-between gap-2">
                    <div className="text-xs text-neutral-500">
                        {stage === 'preview' && preview && (
                            <span>
                                <strong className="text-emerald-700">{preview.inserts.size}</strong>{' '}
                                ใหม่ ·{' '}
                                <strong className="text-amber-700">{preview.updates.size}</strong>{' '}
                                ปรับปรุง ·{' '}
                                <strong className="text-red-600">{preview.errors.length}</strong>{' '}
                                ข้าม
                            </span>
                        )}
                    </div>
                    <div className="flex items-center gap-2">
                        {stage === 'preview' && (
                            <Button variant="outline" onClick={reset} className="gap-1">
                                <ArrowLeft size={13} /> เลือกไฟล์ใหม่
                            </Button>
                        )}
                        {stage === 'preview' && preview && preview.valid.length > 0 && (
                            <Button
                                onClick={() => void runImport()}
                                className="gap-2 bg-indigo-500 hover:bg-indigo-600"
                            >
                                เริ่มนำเข้า ({preview.valid.length} รายการ)
                            </Button>
                        )}
                        {stage === 'running' && (
                            <Button disabled className="gap-2 bg-indigo-500">
                                <Loader2 size={14} className="animate-spin" /> กำลังนำเข้า...
                            </Button>
                        )}
                        {(stage === 'pick' || stage === 'done') && (
                            <Button variant="outline" onClick={() => handleDialogChange(false)}>
                                ปิด
                            </Button>
                        )}
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
}

// ─── Stage: PICK ─────────────────────────────────────────────────────────────

function PickStage({
    fileInputRef,
    onPick,
    onDownloadTemplate,
}: {
    fileInputRef: React.RefObject<HTMLInputElement | null>;
    onPick: (e: ChangeEvent<HTMLInputElement>) => void;
    onDownloadTemplate: () => void;
}) {
    return (
        <div className="space-y-4">
            <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="w-full aspect-[3/1] rounded-lg border-2 border-dashed border-neutral-300 hover:border-indigo-400 hover:bg-indigo-50 transition flex flex-col items-center justify-center gap-2 text-neutral-500 hover:text-indigo-700"
            >
                <Upload size={28} />
                <span className="text-sm font-semibold">คลิกเพื่อเลือกไฟล์ CSV</span>
                <span className="text-xs">รองรับ UTF-8 · ส่วนหัวต้องตรงกับ template</span>
            </button>
            <input
                ref={fileInputRef}
                type="file"
                accept=".csv,text/csv"
                onChange={onPick}
                className="hidden"
            />

            <div className="rounded-lg border border-neutral-200 bg-white p-4 space-y-2">
                <div className="text-sm font-semibold text-neutral-900">
                    รูปแบบไฟล์
                </div>
                <ul className="text-xs text-neutral-600 leading-relaxed list-disc list-inside space-y-0.5">
                    <li>คอลัมน์ที่จำเป็น: <code className="text-indigo-700">sku, name_th</code></li>
                    <li><code>feature_tags</code> และ <code>images</code> ใช้ <code>|</code> คั่นหลายค่า</li>
                    <li><code>category_slug</code> ต้องตรงกับ slug ของหมวดในระบบ</li>
                    <li>SKU ที่ตรงกับสินค้าเดิม → จะปรับปรุง; SKU ใหม่ → จะสร้างใหม่</li>
                </ul>
                <button
                    type="button"
                    onClick={onDownloadTemplate}
                    className="inline-flex items-center gap-1.5 text-xs font-semibold text-indigo-700 hover:underline mt-1"
                >
                    <FileDown size={12} /> ดาวน์โหลด template (CSV)
                </button>
            </div>
        </div>
    );
}

// ─── Stage: PREVIEW ──────────────────────────────────────────────────────────

function PreviewStage({ preview }: { preview: ImportPreview }) {
    const withWarnings = useMemo(
        () => preview.valid.filter((r) => r.warnings.length > 0),
        [preview.valid],
    );
    return (
        <div className="space-y-4">
            <div className="grid grid-cols-3 gap-3">
                <SummaryTile
                    label="สร้างใหม่"
                    value={preview.inserts.size}
                    tone="emerald"
                />
                <SummaryTile
                    label="ปรับปรุง"
                    value={preview.updates.size}
                    tone="amber"
                />
                <SummaryTile
                    label="ข้าม (error)"
                    value={preview.errors.length}
                    tone="red"
                />
            </div>

            {preview.errors.length > 0 && (
                <div className="rounded-lg border border-red-200 bg-red-50 p-3 space-y-1.5">
                    <div className="text-[10px] uppercase tracking-wider font-bold text-red-700 flex items-center gap-1.5">
                        <X size={12} /> ข้าม {preview.errors.length} แถว
                    </div>
                    <ul className="text-xs text-red-700 max-h-32 overflow-y-auto space-y-0.5">
                        {preview.errors.slice(0, 20).map((e, i) => (
                            <li key={i}>
                                <span className="font-mono">row {e.line}</span>
                                {e.sku && <span className="font-mono ml-1">({e.sku})</span>}:{' '}
                                {e.message}
                            </li>
                        ))}
                        {preview.errors.length > 20 && (
                            <li className="text-red-600 italic">
                                ...อีก {preview.errors.length - 20} แถว
                            </li>
                        )}
                    </ul>
                </div>
            )}

            {withWarnings.length > 0 && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 space-y-1.5">
                    <div className="text-[10px] uppercase tracking-wider font-bold text-amber-800 flex items-center gap-1.5">
                        <AlertTriangle size={12} /> คำเตือน {withWarnings.length} แถว (จะนำเข้า)
                    </div>
                    <ul className="text-xs text-amber-800 max-h-32 overflow-y-auto space-y-0.5">
                        {withWarnings.slice(0, 20).map((r) =>
                            r.warnings.map((w, i) => (
                                <li key={`${r.sku}-${i}`}>
                                    <span className="font-mono">{r.sku}</span>: {w}
                                </li>
                            )),
                        )}
                    </ul>
                </div>
            )}

            {preview.valid.length > 0 && (
                <div className="rounded-lg border border-neutral-200 bg-white overflow-hidden">
                    <div className="px-3 py-2 bg-neutral-50 border-b border-neutral-200 text-[10px] uppercase tracking-wider font-bold text-neutral-700">
                        Preview ({preview.valid.length} รายการ — แสดง 10 รายการแรก)
                    </div>
                    <table className="w-full text-xs">
                        <thead className="bg-neutral-50 text-neutral-600">
                            <tr>
                                <th className="px-3 py-1.5 text-left font-semibold">SKU</th>
                                <th className="px-3 py-1.5 text-left font-semibold">ชื่อ</th>
                                <th className="px-3 py-1.5 text-right font-semibold">ราคา</th>
                                <th className="px-3 py-1.5 text-right font-semibold">จำนวน</th>
                                <th className="px-3 py-1.5 text-center font-semibold">action</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-neutral-100">
                            {preview.valid.slice(0, 10).map((r) => {
                                const isUpdate = preview.updates.has(r.sku);
                                return (
                                    <tr key={r.sku} className="hover:bg-neutral-50">
                                        <td className="px-3 py-1.5 font-mono text-indigo-700">
                                            {r.sku}
                                        </td>
                                        <td className="px-3 py-1.5 text-neutral-900 truncate max-w-[200px]">
                                            {r.product.name_th}
                                        </td>
                                        <td className="px-3 py-1.5 text-right tabular-nums">
                                            {Number(r.product.price ?? 0).toLocaleString('th-TH')}
                                        </td>
                                        <td className="px-3 py-1.5 text-right tabular-nums">
                                            {r.initial_quantity}
                                        </td>
                                        <td className="px-3 py-1.5 text-center">
                                            <span
                                                className={cn(
                                                    'inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold',
                                                    isUpdate
                                                        ? 'bg-amber-100 text-amber-800'
                                                        : 'bg-emerald-100 text-emerald-800',
                                                )}
                                            >
                                                {isUpdate ? 'ปรับปรุง' : 'สร้างใหม่'}
                                            </span>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}

function SummaryTile({
    label,
    value,
    tone,
}: {
    label: string;
    value: number;
    tone: 'emerald' | 'amber' | 'red';
}) {
    const toneClass = {
        emerald: 'border-emerald-200 bg-emerald-50 text-emerald-800',
        amber: 'border-amber-200 bg-amber-50 text-amber-800',
        red: 'border-red-200 bg-red-50 text-red-700',
    }[tone];
    return (
        <div className={cn('rounded-lg border p-3', toneClass)}>
            <div className="text-[10px] uppercase tracking-wider font-bold">{label}</div>
            <div className="text-2xl font-bold tabular-nums mt-0.5">{value}</div>
        </div>
    );
}

// ─── Stage: RUN / DONE ───────────────────────────────────────────────────────

function RunStage({
    stage,
    progress,
    results,
    errors,
}: {
    stage: Stage;
    progress: { done: number; total: number };
    results: RowResult[];
    errors: ImportPreview['errors'];
}) {
    const inserted = results.filter((r) => r.action === 'inserted').length;
    const updated = results.filter((r) => r.action === 'updated').length;
    const failed = results.filter((r) => r.action === 'failed').length;
    const pct = progress.total === 0 ? 0 : Math.round((progress.done / progress.total) * 100);

    return (
        <div className="space-y-4">
            {/* Progress bar */}
            <div>
                <div className="flex items-center justify-between text-xs text-neutral-600 mb-1.5">
                    <span>{progress.done} / {progress.total} รายการ</span>
                    <span className="tabular-nums">{pct}%</span>
                </div>
                <div className="h-2 rounded-full bg-neutral-200 overflow-hidden">
                    <div
                        className={cn(
                            'h-full transition-all',
                            stage === 'done' ? 'bg-emerald-500' : 'bg-indigo-500',
                        )}
                        style={{ width: `${pct}%` }}
                    />
                </div>
            </div>

            {/* Summary tiles when done */}
            {stage === 'done' && (
                <div className="grid grid-cols-3 gap-3">
                    <SummaryTile label="สร้างใหม่" value={inserted} tone="emerald" />
                    <SummaryTile label="ปรับปรุง" value={updated} tone="amber" />
                    <SummaryTile label="ล้มเหลว" value={failed + errors.length} tone="red" />
                </div>
            )}

            {/* Result list */}
            {results.length > 0 && (
                <div className="rounded-lg border border-neutral-200 bg-white overflow-hidden">
                    <div className="max-h-72 overflow-y-auto">
                        <table className="w-full text-xs">
                            <tbody className="divide-y divide-neutral-100">
                                {results.map((r) => (
                                    <tr key={`${r.sku}-${r.line}`}>
                                        <td className="px-3 py-1.5 w-6">
                                            {r.action === 'failed' ? (
                                                <X size={12} className="text-red-600" />
                                            ) : (
                                                <CheckCircle2
                                                    size={12}
                                                    className={
                                                        r.action === 'inserted'
                                                            ? 'text-emerald-600'
                                                            : 'text-amber-600'
                                                    }
                                                />
                                            )}
                                        </td>
                                        <td className="px-3 py-1.5 font-mono text-neutral-700">
                                            {r.sku}
                                        </td>
                                        <td className="px-3 py-1.5 text-neutral-600">
                                            {r.action === 'failed'
                                                ? r.error
                                                : r.action === 'inserted'
                                                  ? 'สร้างใหม่'
                                                  : 'ปรับปรุง'}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}
        </div>
    );
}

// ─── Commit a single row ─────────────────────────────────────────────────────

async function commitRow(
    row: ParsedRow,
    slugMap: Map<string, string>,
    skuToProduct: Map<string, ProductWithInventory>,
    defaultWarehouseId: string | null,
): Promise<void> {
    const productPayload = {
        ...row.product,
        category_id: row.category_slug ? slugMap.get(row.category_slug) ?? null : null,
    };

    const existing = skuToProduct.get(row.sku);
    let productId: string;

    if (existing) {
        const updated = await productsApi.update(existing.id, productPayload);
        productId = updated.id;
        // Sync inventory in the existing default-warehouse row if present,
        // otherwise upsert a fresh one.
        const inv0 = existing.inventory[0];
        if (inv0) {
            await inventoryApi.adjustQuantity(inv0.id, row.initial_quantity);
        } else if (defaultWarehouseId) {
            await inventoryApi.upsert({
                product_id: productId,
                warehouse_id: defaultWarehouseId,
                quantity: row.initial_quantity,
                reorder_level: row.reorder_level,
            });
        }
    } else {
        const created = await productsApi.create(productPayload);
        productId = created.id;
        if (defaultWarehouseId) {
            await inventoryApi.upsert({
                product_id: productId,
                warehouse_id: defaultWarehouseId,
                quantity: row.initial_quantity,
                reorder_level: row.reorder_level,
            });
        }
    }
}
