/**
 * Import customers CSV — mirrors ImportInventoryModal but for the
 * `customers` table. 3 stages: pick → preview → run.
 *
 * Match key: customers.code. Rows without a code always insert; rows
 * with a code UPSERT against the existing customer with that code.
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
import { customersApi } from '../lib/api';
import {
    parseCustomersCsv,
    buildCustomersCsv,
    downloadCsv,
    type CustomerImportPreview,
} from '../lib/customerCsv';
import type { Customer } from '../lib/database.types';
import { Button } from '@/components/ui/button';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

interface ImportCustomersModalProps {
    isOpen: boolean;
    onClose: () => void;
    onImported: () => void;
    existingCustomers: Customer[];
}

type Stage = 'pick' | 'preview' | 'running' | 'done';

interface RowResult {
    line: number;
    code: string;
    name: string;
    action: 'inserted' | 'updated' | 'failed';
    error?: string;
}

export default function ImportCustomersModal({
    isOpen,
    onClose,
    onImported,
    existingCustomers,
}: ImportCustomersModalProps) {
    const [stage, setStage] = useState<Stage>('pick');
    const [fileName, setFileName] = useState<string | null>(null);
    const [preview, setPreview] = useState<CustomerImportPreview | null>(null);
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
            const result = parseCustomersCsv(text, existingCustomers);
            setPreview(result);
            setStage('preview');
        } catch (err) {
            setParseError((err as Error).message);
        }
    }

    function downloadTemplate() {
        // One example row if any customers exist, otherwise headers only.
        const example = existingCustomers[0]
            ? buildCustomersCsv([existingCustomers[0]])
            : buildCustomersCsv([]);
        downloadCsv('customers-template.csv', example);
    }

    async function runImport() {
        if (!preview) return;
        setStage('running');
        setResults([]);
        setProgress({ done: 0, total: preview.valid.length });

        // Bulk upsert in chunks (conflict on `code`) — fast + idempotent, so a
        // re-run just fills in whatever is missing without duplicating.
        const localResults: RowResult[] = [];
        const CHUNK = 500;
        try {
            for (let i = 0; i < preview.valid.length; i += CHUNK) {
                const slice = preview.valid.slice(i, i + CHUNK);
                await customersApi.bulkUpsert(slice.map((r) => r.customer));
                for (const r of slice) {
                    localResults.push({
                        line: r.line,
                        code: r.code,
                        name: r.customer.name,
                        action: r.code && preview.updates.has(r.code) ? 'updated' : 'inserted',
                    });
                }
                setProgress({
                    done: Math.min(preview.valid.length, i + slice.length),
                    total: preview.valid.length,
                });
                setResults([...localResults]);
            }
        } catch (err) {
            localResults.push({
                line: 0,
                code: '',
                name: '— เกิดข้อผิดพลาดระหว่างนำเข้า —',
                action: 'failed',
                error: (err as Error).message,
            });
            setResults([...localResults]);
        }

        setStage('done');
        onImported();
    }

    return (
        <Dialog open={isOpen} onOpenChange={handleDialogChange}>
            <DialogContent className="sm:max-w-2xl p-0 gap-0 max-h-[90vh] flex flex-col">
                <DialogHeader className="px-6 py-5 border-b border-neutral-200 bg-neutral-50">
                    <div className="flex items-center gap-4">
                        <div className="w-11 h-11 rounded-lg bg-indigo-500 grid place-items-center flex-shrink-0">
                            <Upload size={20} className="text-white" />
                        </div>
                        <div className="min-w-0">
                            <DialogTitle className="text-lg font-bold text-neutral-900">
                                Import ลูกค้าจาก CSV
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
                            errorCount={preview?.errors.length ?? 0}
                        />
                    )}
                </div>

                <div className="px-6 py-4 border-t border-neutral-200 bg-neutral-50 flex items-center justify-between gap-2">
                    <div className="text-xs text-neutral-500">
                        {stage === 'preview' && preview && (
                            <span>
                                <strong className="text-emerald-700">
                                    {preview.inserts.size + preview.codelessInserts}
                                </strong>{' '}
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
                <div className="text-sm font-semibold text-neutral-900">รูปแบบไฟล์</div>
                <ul className="text-xs text-neutral-600 leading-relaxed list-disc list-inside space-y-0.5">
                    <li>คอลัมน์ที่จำเป็น: <code className="text-indigo-700">name</code></li>
                    <li>ติดต่อ: <code>contact_name</code>, <code>phone</code>, <code>mobile</code>, <code>fax</code>, <code>email</code></li>
                    <li><code>customer_type</code>: <code>company</code> / <code>shop</code> / <code>individual</code> / <code>unspecified</code></li>
                    <li><code>tier</code>: <code>general</code> / <code>silver</code> / <code>gold</code> / <code>vip</code></li>
                    <li><code>tags</code> ใช้ <code>|</code> คั่นหลายค่า (เช่น <code>VIP|wholesale</code>)</li>
                    <li>
                        ที่อยู่บิล: <code>billing_line</code>, <code>billing_subdistrict</code>, <code>billing_district</code>, <code>billing_province</code>, <code>billing_postcode</code>
                    </li>
                    <li>
                        ที่อยู่จัดส่ง: <code>shipping_line</code>, <code>shipping_subdistrict</code>, <code>shipping_district</code>, <code>shipping_province</code>, <code>shipping_postcode</code>
                    </li>
                    <li>ถ้ามี <code>code</code> ตรงกับลูกค้าเดิม → จะปรับปรุง; ถ้าไม่มี → จะสร้างใหม่</li>
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

function PreviewStage({ preview }: { preview: CustomerImportPreview }) {
    const withWarnings = useMemo(
        () => preview.valid.filter((r) => r.warnings.length > 0),
        [preview.valid],
    );
    const insertCount = preview.inserts.size + preview.codelessInserts;
    return (
        <div className="space-y-4">
            <div className="grid grid-cols-3 gap-3">
                <SummaryTile label="สร้างใหม่" value={insertCount} tone="emerald" />
                <SummaryTile label="ปรับปรุง" value={preview.updates.size} tone="amber" />
                <SummaryTile label="ข้าม (error)" value={preview.errors.length} tone="red" />
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
                                {e.code && <span className="font-mono ml-1">({e.code})</span>}:{' '}
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
                                <li key={`${r.line}-${i}`}>
                                    <span className="font-mono">row {r.line}</span>: {w}
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
                                <th className="px-3 py-1.5 text-left font-semibold">code</th>
                                <th className="px-3 py-1.5 text-left font-semibold">ชื่อ</th>
                                <th className="px-3 py-1.5 text-left font-semibold">tier</th>
                                <th className="px-3 py-1.5 text-left font-semibold">email/phone</th>
                                <th className="px-3 py-1.5 text-center font-semibold">action</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-neutral-100">
                            {preview.valid.slice(0, 10).map((r) => {
                                const isUpdate = r.code && preview.updates.has(r.code);
                                return (
                                    <tr key={r.line} className="hover:bg-neutral-50">
                                        <td className="px-3 py-1.5 font-mono text-indigo-700">
                                            {r.code || <span className="text-neutral-400">—</span>}
                                        </td>
                                        <td className="px-3 py-1.5 text-neutral-900 truncate max-w-[200px]">
                                            {r.customer.name}
                                        </td>
                                        <td className="px-3 py-1.5 text-neutral-700 uppercase">
                                            {r.customer.tier}
                                        </td>
                                        <td className="px-3 py-1.5 text-neutral-500 truncate max-w-[180px]">
                                            {r.customer.email ?? r.customer.phone ?? '—'}
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
    errorCount,
}: {
    stage: Stage;
    progress: { done: number; total: number };
    results: RowResult[];
    errorCount: number;
}) {
    const inserted = results.filter((r) => r.action === 'inserted').length;
    const updated = results.filter((r) => r.action === 'updated').length;
    const failed = results.filter((r) => r.action === 'failed').length;
    const pct = progress.total === 0 ? 0 : Math.round((progress.done / progress.total) * 100);

    return (
        <div className="space-y-4">
            <div>
                <div className="flex items-center justify-between text-xs text-neutral-600 mb-1.5">
                    <span>
                        {progress.done} / {progress.total} รายการ
                    </span>
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

            {stage === 'done' && (
                <div className="grid grid-cols-3 gap-3">
                    <SummaryTile label="สร้างใหม่" value={inserted} tone="emerald" />
                    <SummaryTile label="ปรับปรุง" value={updated} tone="amber" />
                    <SummaryTile label="ล้มเหลว" value={failed + errorCount} tone="red" />
                </div>
            )}

            {results.length > 0 && (
                <div className="rounded-lg border border-neutral-200 bg-white overflow-hidden">
                    <div className="max-h-72 overflow-y-auto">
                        <table className="w-full text-xs">
                            <tbody className="divide-y divide-neutral-100">
                                {results.map((r) => (
                                    <tr key={`${r.line}-${r.code || r.name}`}>
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
                                        <td className="px-3 py-1.5 font-mono text-neutral-700 w-24">
                                            {r.code || '—'}
                                        </td>
                                        <td className="px-3 py-1.5 text-neutral-700 truncate max-w-[200px]">
                                            {r.name}
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
