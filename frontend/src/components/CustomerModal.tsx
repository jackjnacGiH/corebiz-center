import { useEffect, useState, type FormEvent } from 'react';
import {
    User,
    UserCircle,
    Mail,
    Phone,
    Smartphone,
    Printer,
    Briefcase,
    Hash,
    Award,
    Loader2,
    MapPin,
    Truck,
    Search,
    Copy,
    Building2,
    Plus,
    Trash2,
} from 'lucide-react';
import type { Customer, CustomerBranch } from '../lib/database.types';
import { customerBranchesApi } from '../lib/api';
import { lookupZipcode, type ThaiAddressEntry } from '../lib/thaiAddress';
import { Button } from '@/components/ui/button';
import {
    Dialog,
    DialogContent,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export type CustomerType = 'company' | 'shop' | 'individual' | 'unspecified';

export interface AddressData {
    /** บ้านเลขที่ + อาคาร + ถนน (free-form first line) */
    line: string;
    subdistrict: string;
    district: string;
    province: string;
    postcode: string;
}

export interface BranchFormItem {
    /** Stable React key — uuid-ish for new rows, real id for persisted ones. */
    _key: string;
    /** undefined for new branches (will be INSERT); string for existing ones (UPDATE). */
    id?: string;
    branch_code: string;
    branch_name: string;
    address: AddressData;
}

export interface CustomerFormData {
    code: string;
    name: string;
    /** Human contact at the customer (relevant for company/shop). */
    contact_name: string;
    customer_type: CustomerType;
    tier: 'general' | 'silver' | 'gold' | 'vip';
    email: string;
    /** Office / general line. */
    phone: string;
    /** Mobile / direct number. */
    mobile: string;
    fax: string;
    tax_id: string;
    notes: string;
    billing_address: AddressData;
    /** When `same_as_billing` is true, this is ignored at save time. */
    shipping_address: AddressData;
    same_as_billing: boolean;
    /**
     * "ลูกค้านี้มีสำนักงาน/สาขา". When false at save time, all existing
     * branches are deleted from DB.
     */
    has_branches: boolean;
    branches: BranchFormItem[];
}

interface Props {
    isOpen: boolean;
    onClose: () => void;
    onSave: (data: CustomerFormData) => Promise<void> | void;
    editing?: Customer | null;
}

const ALLOWED_TYPES = new Set<CustomerType>(['company', 'shop', 'individual', 'unspecified']);

function normalizeType(v: string | null | undefined): CustomerType {
    if (v && ALLOWED_TYPES.has(v as CustomerType)) return v as CustomerType;
    return 'unspecified';
}

const EMPTY_ADDR: AddressData = {
    line: '',
    subdistrict: '',
    district: '',
    province: '',
    postcode: '',
};

/** Coerce arbitrary JSON value coming from the DB into our `AddressData` shape. */
function parseAddress(v: unknown): AddressData {
    if (!v || typeof v !== 'object') return { ...EMPTY_ADDR };
    const o = v as Record<string, unknown>;
    return {
        line: typeof o.line === 'string' ? o.line : '',
        subdistrict: typeof o.subdistrict === 'string' ? o.subdistrict : '',
        district: typeof o.district === 'string' ? o.district : '',
        province: typeof o.province === 'string' ? o.province : '',
        postcode: typeof o.postcode === 'string' ? o.postcode : '',
    };
}

function isAddrEmpty(a: AddressData): boolean {
    return !a.line && !a.subdistrict && !a.district && !a.province && !a.postcode;
}

/** Deep-ish equality for address blocks. */
function addrEquals(a: AddressData, b: AddressData): boolean {
    return (
        a.line === b.line &&
        a.subdistrict === b.subdistrict &&
        a.district === b.district &&
        a.province === b.province &&
        a.postcode === b.postcode
    );
}

function makeKey(): string {
    // Stable enough for React reconciliation — avoids collisions across renders.
    return typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `b-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function newBranch(): BranchFormItem {
    return {
        _key: makeKey(),
        id: undefined,
        branch_code: '',
        branch_name: '',
        address: { ...EMPTY_ADDR },
    };
}

function branchFromRow(b: CustomerBranch): BranchFormItem {
    return {
        _key: b.id,
        id: b.id,
        branch_code: b.branch_code,
        branch_name: b.branch_name,
        address: parseAddress(b.address),
    };
}

function build(c: Customer | null | undefined): CustomerFormData {
    const billing = parseAddress(c?.billing_address);
    const shipping = parseAddress(c?.shipping_address);
    const sameAsBilling =
        !c || isAddrEmpty(shipping) || addrEquals(billing, shipping);
    return {
        code: c?.code ?? '',
        name: c?.name ?? '',
        contact_name: c?.contact_name ?? '',
        customer_type: normalizeType(c?.customer_type),
        tier: (c?.tier as CustomerFormData['tier']) ?? 'general',
        email: c?.email ?? '',
        phone: c?.phone ?? '',
        mobile: c?.mobile ?? '',
        fax: c?.fax ?? '',
        tax_id: c?.tax_id ?? '',
        notes: c?.notes ?? '',
        billing_address: billing,
        shipping_address: sameAsBilling ? { ...billing } : shipping,
        same_as_billing: sameAsBilling,
        has_branches: false,         // toggled on once branches load (if any)
        branches: [],
    };
}

const selectClass =
    'w-full h-9 rounded-md border border-neutral-200 bg-white px-3 text-sm text-neutral-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100';

export default function CustomerModal(props: Props) {
    if (!props.isOpen) return null;
    return <Form key={props.editing?.id ?? 'new'} {...props} />;
}

function Form({ isOpen, onClose, onSave, editing }: Props) {
    const [form, setForm] = useState<CustomerFormData>(() => build(editing));
    const [saving, setSaving] = useState(false);
    const [loadingBranches, setLoadingBranches] = useState(false);
    const [err, setErr] = useState<string | null>(null);
    const isNew = !editing;

    // Load existing branches once the modal opens on an existing customer.
    // For a fresh customer there's nothing to load (no id yet).
    useEffect(() => {
        if (!editing?.id) return;
        let cancelled = false;
        setLoadingBranches(true);
        customerBranchesApi
            .listForCustomer(editing.id)
            .then((rows) => {
                if (cancelled) return;
                if (rows.length > 0) {
                    setForm((prev) => ({
                        ...prev,
                        has_branches: true,
                        branches: rows.map(branchFromRow),
                    }));
                }
            })
            .catch((e) => {
                if (!cancelled) setErr(`โหลดข้อมูลสาขาไม่สำเร็จ — ${(e as Error).message}`);
            })
            .finally(() => {
                if (!cancelled) setLoadingBranches(false);
            });
        return () => {
            cancelled = true;
        };
    }, [editing?.id]);

    function updateBranch(idx: number, patch: Partial<BranchFormItem>) {
        setForm((prev) => {
            const next = [...prev.branches];
            next[idx] = { ...next[idx], ...patch };
            return { ...prev, branches: next };
        });
    }

    function addBranch() {
        setForm((prev) => ({
            ...prev,
            has_branches: true,
            branches: [...prev.branches, newBranch()],
        }));
    }

    function removeBranch(idx: number) {
        setForm((prev) => {
            const next = prev.branches.filter((_, i) => i !== idx);
            return { ...prev, branches: next };
        });
    }

    async function handleSubmit(e: FormEvent) {
        e.preventDefault();
        setErr(null);
        setSaving(true);
        try {
            // If same_as_billing is on, mirror billing into shipping right
            // before save so the row written to DB is consistent.
            const payload: CustomerFormData = form.same_as_billing
                ? { ...form, shipping_address: { ...form.billing_address } }
                : form;
            await onSave(payload);
            onClose();
        } catch (e2) {
            setErr((e2 as Error).message);
        } finally {
            setSaving(false);
        }
    }

    return (
        <Dialog open={isOpen} onOpenChange={(o) => !o && onClose()}>
            <DialogContent className="sm:max-w-3xl p-0 gap-0 max-h-[92vh] flex flex-col">
                {/* Header */}
                <DialogHeader className="px-6 py-5 border-b border-neutral-200 bg-neutral-50">
                    <div className="flex items-center gap-4">
                        <div className="w-11 h-11 rounded-lg bg-indigo-500 grid place-items-center flex-shrink-0">
                            <User size={20} className="text-white" />
                        </div>
                        <div className="min-w-0">
                            <DialogTitle className="text-lg font-bold text-neutral-900">
                                {isNew ? 'เพิ่มลูกค้าใหม่' : 'แก้ไขข้อมูลลูกค้า'}
                            </DialogTitle>
                            <p className="text-[11px] text-neutral-500 mt-0.5 uppercase tracking-wider font-semibold font-mono">
                                {isNew ? 'New Customer' : (editing?.code ?? 'Customer')}
                            </p>
                        </div>
                    </div>
                </DialogHeader>

                {/* Body */}
                <form
                    onSubmit={handleSubmit}
                    className="flex flex-col overflow-hidden flex-1"
                >
                    <div className="px-6 py-5 space-y-5 overflow-y-auto">
                        {err && (
                            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                                ✗ {err}
                            </div>
                        )}

                        <div className="grid grid-cols-3 gap-3">
                            <div className="space-y-2">
                                <Label htmlFor="cust-code" className="flex items-center gap-1.5 text-xs font-semibold text-neutral-700 uppercase tracking-wider">
                                    <Hash size={12} /> รหัสลูกค้า
                                </Label>
                                <Input
                                    id="cust-code"
                                    type="text"
                                    placeholder="CUS-001"
                                    value={form.code}
                                    onChange={(e) => setForm({ ...form, code: e.target.value })}
                                />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="cust-type" className="flex items-center gap-1.5 text-xs font-semibold text-neutral-700 uppercase tracking-wider">
                                    <Briefcase size={12} /> ประเภท
                                </Label>
                                <select
                                    id="cust-type"
                                    className={selectClass}
                                    value={form.customer_type}
                                    onChange={(e) =>
                                        setForm({
                                            ...form,
                                            customer_type: e.target.value as CustomerFormData['customer_type'],
                                        })
                                    }
                                >
                                    <option value="company">นิติบุคคล</option>
                                    <option value="shop">ร้านค้า</option>
                                    <option value="individual">บุคคล</option>
                                    <option value="unspecified">ไม่ระบุ</option>
                                </select>
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="cust-tier" className="flex items-center gap-1.5 text-xs font-semibold text-neutral-700 uppercase tracking-wider">
                                    <Award size={12} /> ระดับ
                                </Label>
                                <select
                                    id="cust-tier"
                                    className={selectClass}
                                    value={form.tier}
                                    onChange={(e) =>
                                        setForm({
                                            ...form,
                                            tier: e.target.value as CustomerFormData['tier'],
                                        })
                                    }
                                >
                                    <option value="general">General</option>
                                    <option value="silver">Silver</option>
                                    <option value="gold">Gold</option>
                                    <option value="vip">VIP</option>
                                </select>
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-2">
                                <Label htmlFor="cust-name" className="text-xs font-semibold text-neutral-700 uppercase tracking-wider">
                                    ชื่อลูกค้า *
                                </Label>
                                <Input
                                    id="cust-name"
                                    type="text"
                                    required
                                    placeholder="ชื่อบริษัท / ชื่อบุคคล"
                                    value={form.name}
                                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                                />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="cust-contact" className="flex items-center gap-1.5 text-xs font-semibold text-neutral-700 uppercase tracking-wider">
                                    <UserCircle size={12} /> ชื่อผู้ติดต่อ
                                </Label>
                                <Input
                                    id="cust-contact"
                                    type="text"
                                    placeholder="คุณสมชาย ใจดี"
                                    value={form.contact_name}
                                    onChange={(e) => setForm({ ...form, contact_name: e.target.value })}
                                />
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-2">
                                <Label htmlFor="cust-email" className="flex items-center gap-1.5 text-xs font-semibold text-neutral-700 uppercase tracking-wider">
                                    <Mail size={12} /> Email
                                </Label>
                                <Input
                                    id="cust-email"
                                    type="email"
                                    value={form.email}
                                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                                />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="cust-phone" className="flex items-center gap-1.5 text-xs font-semibold text-neutral-700 uppercase tracking-wider">
                                    <Phone size={12} /> โทรศัพท์
                                </Label>
                                <Input
                                    id="cust-phone"
                                    type="tel"
                                    placeholder="02-123-4567"
                                    value={form.phone}
                                    onChange={(e) => setForm({ ...form, phone: e.target.value })}
                                />
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-2">
                                <Label htmlFor="cust-mobile" className="flex items-center gap-1.5 text-xs font-semibold text-neutral-700 uppercase tracking-wider">
                                    <Smartphone size={12} /> มือถือ
                                </Label>
                                <Input
                                    id="cust-mobile"
                                    type="tel"
                                    placeholder="081-234-5678"
                                    value={form.mobile}
                                    onChange={(e) => setForm({ ...form, mobile: e.target.value })}
                                />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="cust-fax" className="flex items-center gap-1.5 text-xs font-semibold text-neutral-700 uppercase tracking-wider">
                                    <Printer size={12} /> Fax
                                </Label>
                                <Input
                                    id="cust-fax"
                                    type="tel"
                                    placeholder="02-123-4568"
                                    value={form.fax}
                                    onChange={(e) => setForm({ ...form, fax: e.target.value })}
                                />
                            </div>
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="cust-tax" className="text-xs font-semibold text-neutral-700 uppercase tracking-wider">
                                เลขประจำตัวผู้เสียภาษี
                            </Label>
                            <Input
                                id="cust-tax"
                                type="text"
                                value={form.tax_id}
                                onChange={(e) => setForm({ ...form, tax_id: e.target.value })}
                            />
                        </div>

                        {/* ── Billing address ──────────────────────────── */}
                        <AddressSection
                            id="bill"
                            icon={<MapPin size={14} className="text-indigo-600" />}
                            title="ที่อยู่สำหรับใบกำกับภาษี"
                            value={form.billing_address}
                            onChange={(addr) => setForm({ ...form, billing_address: addr })}
                        />

                        {/* ── Shipping address ─────────────────────────── */}
                        <div className="space-y-3">
                            <label className="flex items-center gap-2 text-sm text-neutral-700 select-none cursor-pointer">
                                <input
                                    type="checkbox"
                                    className="h-4 w-4 rounded border-neutral-300 text-indigo-600 focus:ring-indigo-500"
                                    checked={form.same_as_billing}
                                    onChange={(e) =>
                                        setForm({
                                            ...form,
                                            same_as_billing: e.target.checked,
                                            // When toggled on, snapshot billing → shipping so the
                                            // user immediately sees what will be saved.
                                            shipping_address: e.target.checked
                                                ? { ...form.billing_address }
                                                : form.shipping_address,
                                        })
                                    }
                                />
                                <Copy size={13} className="text-neutral-400" />
                                <span className="font-medium">ใช้ที่อยู่จัดส่งเดียวกับใบกำกับภาษี</span>
                            </label>

                            {!form.same_as_billing && (
                                <AddressSection
                                    id="ship"
                                    icon={<Truck size={14} className="text-emerald-600" />}
                                    title="ที่อยู่สำหรับจัดส่ง"
                                    value={form.shipping_address}
                                    onChange={(addr) => setForm({ ...form, shipping_address: addr })}
                                />
                            )}
                        </div>

                        {/* ── Branches (สำนักงาน/สาขา) ─────────────────── */}
                        <div className="space-y-3">
                            <label className="flex items-center gap-2 text-sm text-neutral-700 select-none cursor-pointer">
                                <input
                                    type="checkbox"
                                    className="h-4 w-4 rounded border-neutral-300 text-indigo-600 focus:ring-indigo-500"
                                    checked={form.has_branches}
                                    onChange={(e) =>
                                        setForm({
                                            ...form,
                                            has_branches: e.target.checked,
                                            // Toggling on with no branches yet → seed one empty card
                                            // so the user has something to fill in. Toggling off
                                            // doesn't wipe the list immediately — the user can
                                            // toggle back on without losing data; the save step is
                                            // what honors `has_branches=false` (deletes all).
                                            branches:
                                                e.target.checked && form.branches.length === 0
                                                    ? [newBranch()]
                                                    : form.branches,
                                        })
                                    }
                                />
                                <Building2 size={13} className="text-emerald-600" />
                                <span className="font-medium">ลูกค้านี้มีสำนักงาน/สาขาเพิ่มเติม</span>
                                {loadingBranches && (
                                    <Loader2 size={12} className="animate-spin text-neutral-400" />
                                )}
                            </label>

                            {form.has_branches && (
                                <div className="space-y-3">
                                    {form.branches.map((b, idx) => (
                                        <div
                                            key={b._key}
                                            className="rounded-lg border border-emerald-200 bg-emerald-50/30 p-4 space-y-3"
                                        >
                                            <div className="flex items-center justify-between gap-2">
                                                <div className="flex items-center gap-2 text-sm font-semibold text-neutral-900">
                                                    <Building2 size={14} className="text-emerald-600" />
                                                    สาขา {idx + 1}
                                                    {b.branch_name && (
                                                        <span className="text-neutral-500 font-normal">— {b.branch_name}</span>
                                                    )}
                                                </div>
                                                <button
                                                    type="button"
                                                    onClick={() => removeBranch(idx)}
                                                    title="ลบสาขานี้"
                                                    className="text-neutral-400 hover:text-red-600 transition p-1 -m-1"
                                                >
                                                    <Trash2 size={14} />
                                                </button>
                                            </div>

                                            <div className="grid grid-cols-12 gap-3">
                                                <div className="col-span-12 sm:col-span-4 space-y-1.5">
                                                    <Label htmlFor={`br-${idx}-code`} className="text-xs font-semibold text-neutral-600 uppercase tracking-wider">
                                                        รหัสสาขา *
                                                    </Label>
                                                    <Input
                                                        id={`br-${idx}-code`}
                                                        type="text"
                                                        placeholder="00001"
                                                        value={b.branch_code}
                                                        onChange={(e) =>
                                                            updateBranch(idx, { branch_code: e.target.value })
                                                        }
                                                        required={form.has_branches}
                                                    />
                                                </div>
                                                <div className="col-span-12 sm:col-span-8 space-y-1.5">
                                                    <Label htmlFor={`br-${idx}-name`} className="text-xs font-semibold text-neutral-600 uppercase tracking-wider">
                                                        ชื่อสาขา *
                                                    </Label>
                                                    <Input
                                                        id={`br-${idx}-name`}
                                                        type="text"
                                                        placeholder="สาขาสีลม"
                                                        value={b.branch_name}
                                                        onChange={(e) =>
                                                            updateBranch(idx, { branch_name: e.target.value })
                                                        }
                                                        required={form.has_branches}
                                                    />
                                                </div>
                                            </div>

                                            <AddressSection
                                                id={`br-${idx}`}
                                                icon={<MapPin size={14} className="text-emerald-600" />}
                                                title="ที่อยู่สาขา"
                                                value={b.address}
                                                onChange={(addr) => updateBranch(idx, { address: addr })}
                                            />
                                        </div>
                                    ))}

                                    <button
                                        type="button"
                                        onClick={addBranch}
                                        className="inline-flex items-center gap-2 h-9 px-3 rounded-md border border-dashed border-emerald-300 bg-white hover:bg-emerald-50 text-sm font-medium text-emerald-700 transition"
                                    >
                                        <Plus size={14} /> เพิ่มสาขา
                                    </button>
                                </div>
                            )}
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="cust-notes" className="text-xs font-semibold text-neutral-700 uppercase tracking-wider">
                                หมายเหตุ
                            </Label>
                            <textarea
                                id="cust-notes"
                                rows={3}
                                value={form.notes}
                                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                                className="w-full rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 resize-none"
                            />
                        </div>
                    </div>

                    <DialogFooter className="px-6 py-4 border-t border-neutral-200 bg-neutral-50 gap-2">
                        <Button
                            type="button"
                            variant="outline"
                            onClick={onClose}
                            disabled={saving}
                        >
                            ยกเลิก
                        </Button>
                        <Button
                            type="submit"
                            disabled={saving}
                            className="gap-2 bg-indigo-500 hover:bg-indigo-600"
                        >
                            {saving && <Loader2 size={14} className="animate-spin" />}
                            {saving
                                ? 'กำลังบันทึก...'
                                : isNew
                                  ? 'เพิ่มลูกค้า'
                                  : 'บันทึก'}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}

// ─── AddressSection ────────────────────────────────────────────────────────

interface AddressSectionProps {
    id: string;
    icon: React.ReactNode;
    title: string;
    value: AddressData;
    onChange: (v: AddressData) => void;
}

function AddressSection({ id, icon, title, value, onChange }: AddressSectionProps) {
    const [options, setOptions] = useState<ThaiAddressEntry[]>([]);
    const [searching, setSearching] = useState(false);
    const [notFound, setNotFound] = useState(false);

    async function runLookup(zip: string) {
        const clean = zip.trim();
        if (!/^\d{5}$/.test(clean)) {
            setOptions([]);
            setNotFound(false);
            return;
        }
        setSearching(true);
        setNotFound(false);
        try {
            const matches = await lookupZipcode(clean);
            if (matches.length === 0) {
                setOptions([]);
                setNotFound(true);
            } else if (matches.length === 1) {
                const m = matches[0];
                onChange({
                    ...value,
                    postcode: clean,
                    subdistrict: m.subdistrict,
                    district: m.district,
                    province: m.province,
                });
                setOptions([]);
            } else {
                // Same zip → same district + province; user picks subdistrict.
                const m = matches[0];
                onChange({
                    ...value,
                    postcode: clean,
                    subdistrict: '',
                    district: m.district,
                    province: m.province,
                });
                setOptions(matches);
            }
        } finally {
            setSearching(false);
        }
    }

    function pickSubdistrict(s: string) {
        onChange({ ...value, subdistrict: s });
        setOptions([]);
    }

    return (
        <div className="rounded-lg border border-neutral-200 bg-neutral-50/50 p-4 space-y-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-neutral-900">
                {icon} {title}
            </div>

            {/* Address line — full width */}
            <div className="space-y-1.5">
                <Label htmlFor={`${id}-line`} className="text-xs font-semibold text-neutral-600 uppercase tracking-wider">
                    บ้านเลขที่ / อาคาร / ถนน
                </Label>
                <Input
                    id={`${id}-line`}
                    type="text"
                    placeholder="เช่น 123/45 อาคารเอบีซี ชั้น 5 ถนนสุขุมวิท"
                    value={value.line}
                    onChange={(e) => onChange({ ...value, line: e.target.value })}
                />
            </div>

            {/* Postcode + lookup */}
            <div className="grid grid-cols-12 gap-3">
                <div className="col-span-5 sm:col-span-4 space-y-1.5">
                    <Label htmlFor={`${id}-postcode`} className="text-xs font-semibold text-neutral-600 uppercase tracking-wider">
                        รหัสไปรษณีย์
                    </Label>
                    <div className="flex gap-1.5">
                        <Input
                            id={`${id}-postcode`}
                            type="text"
                            inputMode="numeric"
                            maxLength={5}
                            placeholder="10330"
                            value={value.postcode}
                            onChange={(e) => {
                                const v = e.target.value.replace(/\D/g, '').slice(0, 5);
                                onChange({ ...value, postcode: v });
                                setNotFound(false);
                                if (v.length === 5) void runLookup(v);
                            }}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                    e.preventDefault();
                                    void runLookup(value.postcode);
                                }
                            }}
                            onBlur={() => void runLookup(value.postcode)}
                            className="flex-1"
                        />
                        <button
                            type="button"
                            onClick={() => void runLookup(value.postcode)}
                            disabled={searching}
                            className="h-9 w-9 grid place-items-center rounded-md border border-neutral-200 bg-white hover:bg-neutral-50 disabled:opacity-50 flex-shrink-0"
                            title="ค้นหารหัสไปรษณีย์"
                        >
                            {searching ? (
                                <Loader2 size={14} className="animate-spin text-neutral-500" />
                            ) : (
                                <Search size={14} className="text-neutral-500" />
                            )}
                        </button>
                    </div>
                    {notFound && (
                        <p className="text-[11px] text-amber-700">
                            ไม่พบรหัสไปรษณีย์นี้ — กรอกที่อยู่ด้วยตนเอง
                        </p>
                    )}
                </div>
                <div className="col-span-7 sm:col-span-8 space-y-1.5">
                    <Label htmlFor={`${id}-province`} className="text-xs font-semibold text-neutral-600 uppercase tracking-wider">
                        จังหวัด
                    </Label>
                    <Input
                        id={`${id}-province`}
                        type="text"
                        placeholder="กรุงเทพมหานคร"
                        value={value.province}
                        onChange={(e) => onChange({ ...value, province: e.target.value })}
                    />
                </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                    <Label htmlFor={`${id}-district`} className="text-xs font-semibold text-neutral-600 uppercase tracking-wider">
                        อำเภอ / เขต
                    </Label>
                    <Input
                        id={`${id}-district`}
                        type="text"
                        placeholder="ปทุมวัน"
                        value={value.district}
                        onChange={(e) => onChange({ ...value, district: e.target.value })}
                    />
                </div>
                <div className="space-y-1.5">
                    <Label htmlFor={`${id}-subdistrict`} className="text-xs font-semibold text-neutral-600 uppercase tracking-wider">
                        ตำบล / แขวง
                    </Label>
                    {options.length > 1 ? (
                        <select
                            id={`${id}-subdistrict`}
                            className={selectClass}
                            value={value.subdistrict}
                            onChange={(e) => pickSubdistrict(e.target.value)}
                        >
                            <option value="">— เลือกตำบล/แขวง —</option>
                            {options.map((o) => (
                                <option key={o.subdistrict} value={o.subdistrict}>
                                    {o.subdistrict}
                                </option>
                            ))}
                        </select>
                    ) : (
                        <Input
                            id={`${id}-subdistrict`}
                            type="text"
                            placeholder="ลุมพินี"
                            value={value.subdistrict}
                            onChange={(e) => onChange({ ...value, subdistrict: e.target.value })}
                        />
                    )}
                </div>
            </div>
        </div>
    );
}
