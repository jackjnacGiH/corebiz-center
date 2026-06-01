import { useEffect, useMemo, useState } from 'react';
import {
    Users,
    Mail,
    Phone,
    Smartphone,
    UserCircle,
    Search,
    UserPlus,
    Edit2,
    Briefcase,
    Building2,
    User,
    Store,
    HelpCircle,
    RefreshCw,
    Upload,
    FileDown,
    Trash2,
    Target,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { customersApi, customerBranchesApi } from '../lib/api';
import type { Customer, CustomerBranch, Json } from '../lib/database.types';
import { useLanguage } from '../i18n';
import { useRealtimeTable } from '../lib/useRealtimeTable';
import CustomerModal, { type CustomerFormData } from '../components/CustomerModal';
import ImportCustomersModal from '../components/ImportCustomersModal';
import PageHeader from '../components/PageHeader';
import StatTile from '../components/StatTile';
import CustomerSegments from '../components/CustomerSegments';
import { buildCustomersCsv, downloadCsv } from '../lib/customerCsv';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';

const TIER_STYLES: Record<string, string> = {
    vip:     'bg-purple-50 text-purple-700 border-purple-200',
    gold:    'bg-amber-50  text-amber-800  border-amber-300',
    silver:  'bg-slate-100 text-slate-700  border-slate-300',
    general: 'bg-neutral-100 text-neutral-700 border-neutral-200',
};

type CustomerTypeKey = 'company' | 'shop' | 'individual' | 'unspecified';

const TYPE_META: Record<CustomerTypeKey, { label: string; icon: LucideIcon; iconClass: string }> = {
    company:     { label: 'นิติบุคคล', icon: Briefcase,  iconClass: 'text-blue-600'    },
    shop:        { label: 'ร้านค้า',   icon: Store,      iconClass: 'text-amber-600'   },
    individual:  { label: 'บุคคล',     icon: User,       iconClass: 'text-emerald-600' },
    unspecified: { label: 'ไม่ระบุ',   icon: HelpCircle, iconClass: 'text-neutral-400' },
};

function typeMeta(t: string | null | undefined) {
    return t && t in TYPE_META ? TYPE_META[t as CustomerTypeKey] : TYPE_META.unspecified;
}

export default function CRM() {
    const { t } = useLanguage();
    const [customers, setCustomers] = useState<Customer[]>([]);
    const [branches, setBranches] = useState<CustomerBranch[]>([]);
    const [loading, setLoading] = useState(true);
    const [err, setErr] = useState<string | null>(null);
    const [search, setSearch] = useState('');
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editing, setEditing] = useState<Customer | null>(null);
    const [isImportOpen, setIsImportOpen] = useState(false);
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [bulkDeleting, setBulkDeleting] = useState(false);
    // Which view: the customer list, or the RFM segment breakdown.
    const [view, setView] = useState<'list' | 'rfm'>('list');

    async function load() {
        setLoading(true);
        setErr(null);
        try {
            // Fetch customers + branches in parallel. The branch list is small
            // (one row per branch, typically tens) so loading it eagerly is
            // cheaper than per-row lookups in the table.
            const [cs, bs] = await Promise.all([
                customersApi.list(),
                customerBranchesApi.listAll(),
            ]);
            setCustomers(cs);
            setBranches(bs);
        } catch (e) {
            setErr((e as Error).message);
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => {
        void load();
    }, []);
    useRealtimeTable('customers', () => void load());
    useRealtimeTable('customer_branches', () => void load());

    /** customer_id → its branches, already in display order. */
    const branchesByCustomer = useMemo(() => {
        const map = new Map<string, CustomerBranch[]>();
        for (const b of branches) {
            const list = map.get(b.customer_id);
            if (list) list.push(b);
            else map.set(b.customer_id, [b]);
        }
        return map;
    }, [branches]);

    async function handleSave(data: CustomerFormData) {
        // Empty address blocks → store NULL (not an empty object) so the
        // jsonb column stays clean and `SELECT … WHERE billing_address IS NULL`
        // keeps working.
        const billing = isAddrEmpty(data.billing_address) ? null : data.billing_address;
        const shipping = data.same_as_billing
            ? billing
            : isAddrEmpty(data.shipping_address)
                ? null
                : data.shipping_address;
        const payload = {
            code: data.code || null,
            name: data.name,
            contact_name: data.contact_name || null,
            customer_type: data.customer_type,
            tier: data.tier,
            email: data.email || null,
            phone: data.phone || null,
            mobile: data.mobile || null,
            fax: data.fax || null,
            tax_id: data.tax_id || null,
            notes: data.notes || null,
            // AddressData has a strict shape for the form; the DB column is `Json`
            // which expects an index signature. Cast at the boundary.
            billing_address: billing as Json | null,
            shipping_address: shipping as Json | null,
        };
        const saved = editing
            ? await customersApi.update(editing.id, payload)
            : await customersApi.create(payload);

        // Sync branches. When `has_branches` is off we still call sync with
        // an empty array — that path is what deletes orphaned branches if the
        // user toggled the section off after previously having some.
        const desiredBranches = data.has_branches
            ? data.branches
                  // Only branches with a code AND name are valid; drop empty stubs
                  // the user added but never filled in.
                  .filter((b) => b.branch_code.trim() && b.branch_name.trim())
                  .map((b, idx) => ({
                      id: b.id || undefined,
                      branch_code: b.branch_code.trim(),
                      branch_name: b.branch_name.trim(),
                      // Strict AddressData → Json crosses an index-signature
                      // boundary; go through `unknown` to satisfy TS.
                      address: (isAddrEmpty(b.address)
                          ? null
                          : (b.address as unknown as Json)) as Json | null,
                      sort_order: idx,
                  }))
            : [];
        await customerBranchesApi.syncForCustomer(saved.id, desiredBranches);

        await load();
    }

    function isAddrEmpty(a: { line: string; subdistrict: string; district: string; province: string; postcode: string }): boolean {
        return !a.line && !a.subdistrict && !a.district && !a.province && !a.postcode;
    }

    async function handleBulkDelete() {
        const ids = Array.from(selected);
        if (ids.length === 0) return;
        const items = customers.filter((c) => selected.has(c.id));
        const preview = items.slice(0, 3).map((c) => c.code ?? c.name).join(', ');
        const more = items.length > 3 ? ` และอีก ${items.length - 3} รายการ` : '';
        if (
            !window.confirm(
                `ต้องการลบ ${ids.length} รายการที่เลือกใช่ไหม?\n\n${preview}${more}\n\n` +
                    `⚠️ จะลบ ออเดอร์ / ใบเสนอราคา / แชท / สาขา / ประวัติพอยต์ ` +
                    `ของลูกค้าเหล่านี้ทั้งหมดด้วย\n\nการลบนี้ไม่สามารถยกเลิกได้`,
            )
        )
            return;

        setBulkDeleting(true);
        setErr(null);
        const results = await Promise.allSettled(ids.map((id) => customersApi.remove(id)));
        const failed = results.filter((r) => r.status === 'rejected').length;
        setSelected(new Set());
        await load();
        setBulkDeleting(false);
        if (failed > 0) {
            const firstErr = results.find((r) => r.status === 'rejected') as
                | PromiseRejectedResult
                | undefined;
            setErr(
                `ลบไม่สำเร็จ ${failed}/${ids.length} รายการ` +
                    (firstErr ? ` — ${(firstErr.reason as Error).message}` : ''),
            );
        }
    }

    const filtered = useMemo(() => {
        if (!search) return customers;
        const s = search.toLowerCase();
        return customers.filter(
            (c) =>
                c.name.toLowerCase().includes(s) ||
                (c.contact_name?.toLowerCase().includes(s) ?? false) ||
                (c.email?.toLowerCase().includes(s) ?? false) ||
                (c.phone?.includes(s) ?? false) ||
                (c.mobile?.includes(s) ?? false) ||
                (c.code?.toLowerCase().includes(s) ?? false),
        );
    }, [customers, search]);

    const stats = useMemo(() => {
        const company = customers.filter((c) => c.customer_type === 'company').length;
        const individual = customers.filter((c) => c.customer_type === 'individual').length;
        const vip = customers.filter((c) => c.tier === 'vip').length;
        return { total: customers.length, company, individual, vip };
    }, [customers]);

    return (
        <div className="animate-fade-in space-y-6">
            <PageHeader
                title={t.crm.title}
                subtitle={t.crm.subtitle}
                icon={<Users size={20} />}
                actions={
                    <>
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => load()}
                            disabled={loading}
                            className="gap-2"
                        >
                            <RefreshCw size={14} className={cn(loading && 'animate-spin')} />
                            Reload
                        </Button>
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setIsImportOpen(true)}
                            className="gap-2"
                            title="นำเข้าลูกค้าจาก CSV"
                        >
                            <Upload size={14} />
                            <span className="hidden md:inline">Import</span>
                        </Button>
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                                const list = filtered.length > 0 ? filtered : customers;
                                const stamp = new Date().toISOString().slice(0, 10);
                                downloadCsv(`customers-${stamp}.csv`, buildCustomersCsv(list));
                            }}
                            disabled={customers.length === 0}
                            className="gap-2"
                            title={
                                filtered.length !== customers.length
                                    ? `Export ${filtered.length} รายการที่กรอง`
                                    : `Export ทั้งหมด ${customers.length} รายการ`
                            }
                        >
                            <FileDown size={14} />
                            <span className="hidden md:inline">Export</span>
                        </Button>
                        <div className="relative w-full sm:w-auto">
                            <Search
                                size={14}
                                className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400 pointer-events-none"
                            />
                            <Input
                                type="text"
                                placeholder={t.crm.searchPlaceholder}
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                                className="pl-9 w-full sm:w-64"
                            />
                        </div>
                        <Button
                            size="sm"
                            onClick={() => {
                                setEditing(null);
                                setIsModalOpen(true);
                            }}
                            className="gap-2 bg-indigo-500 hover:bg-indigo-600"
                        >
                            <UserPlus size={14} />
                            <span className="hidden sm:inline">{t.crm.addCustomer}</span>
                        </Button>
                    </>
                }
            />

            {/* ── KPI ─────────────────────────────────────────────────── */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <StatTile
                    icon={<Users size={18} />}
                    label={t.crm.totalCustomers}
                    value={stats.total.toString()}
                    tone="indigo"
                />
                <StatTile
                    icon={<Briefcase size={18} />}
                    label={t.crm.companyCustomers}
                    value={stats.company.toString()}
                    tone="blue"
                />
                <StatTile
                    icon={<User size={18} />}
                    label={t.crm.individualCustomers}
                    value={stats.individual.toString()}
                    tone="emerald"
                />
                <StatTile
                    icon={<Users size={18} />}
                    label="VIP"
                    value={stats.vip.toString()}
                    tone="violet"
                />
            </div>

            {/* View toggle: customer list ↔ RFM segments */}
            <div className="inline-flex items-center gap-1 rounded-lg border border-neutral-200 bg-white p-1 self-start">
                <button
                    type="button"
                    onClick={() => setView('list')}
                    className={cn(
                        'inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-xs font-semibold transition',
                        view === 'list' ? 'bg-indigo-500 text-white shadow-sm' : 'text-neutral-600 hover:bg-neutral-100',
                    )}
                >
                    <Users size={14} /> รายชื่อลูกค้า
                </button>
                <button
                    type="button"
                    onClick={() => setView('rfm')}
                    className={cn(
                        'inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-xs font-semibold transition',
                        view === 'rfm' ? 'bg-indigo-500 text-white shadow-sm' : 'text-neutral-600 hover:bg-neutral-100',
                    )}
                >
                    <Target size={14} /> กลุ่มลูกค้า (RFM)
                </button>
            </div>

            {view === 'rfm' && <CustomerSegments />}

            {err && (
                <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                    ✗ {err}
                </div>
            )}

            {view === 'list' && (
            <>
            {/* Selection action bar */}
            <div className="flex flex-wrap items-center gap-3 text-xs text-neutral-500">
                <span>
                    แสดง <span className="text-neutral-900 font-medium">{filtered.length}</span> /{' '}
                    {customers.length} รายการ
                </span>
                {selected.size > 0 && (
                    <div className="flex items-center gap-3">
                        <span className="font-medium text-neutral-700">
                            เลือก <span className="text-indigo-700">{selected.size}</span> รายการ
                        </span>
                        <button
                            type="button"
                            onClick={() => void handleBulkDelete()}
                            disabled={bulkDeleting}
                            className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md border border-red-200 bg-red-50 text-red-700 text-xs font-semibold hover:bg-red-100 hover:border-red-300 transition disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {bulkDeleting ? (
                                <RefreshCw size={12} className="animate-spin" />
                            ) : (
                                <Trash2 size={12} />
                            )}
                            {bulkDeleting ? 'กำลังลบ...' : `ลบที่เลือก (${selected.size})`}
                        </button>
                        <button
                            type="button"
                            onClick={() => setSelected(new Set())}
                            disabled={bulkDeleting}
                            className="text-indigo-600 hover:text-indigo-700 font-medium disabled:opacity-50"
                        >
                            ยกเลิก
                        </button>
                    </div>
                )}
            </div>

            <Card className="gap-0 py-0 overflow-hidden">
                <CardContent className="px-0 overflow-x-auto">
                    <Table>
                        <TableHeader>
                            <TableRow className="bg-neutral-50 hover:bg-neutral-50">
                                <TableHead className="w-10 px-3">
                                    <input
                                        type="checkbox"
                                        checked={
                                            filtered.length > 0 &&
                                            selected.size === filtered.length
                                        }
                                        ref={(el) => {
                                            if (el) {
                                                el.indeterminate =
                                                    selected.size > 0 &&
                                                    selected.size < filtered.length;
                                            }
                                        }}
                                        onChange={(e) =>
                                            setSelected(
                                                e.target.checked
                                                    ? new Set(filtered.map((c) => c.id))
                                                    : new Set(),
                                            )
                                        }
                                        className="w-3.5 h-3.5 rounded border-neutral-300 accent-indigo-600"
                                    />
                                </TableHead>
                                <TableHead className="px-5 text-xs font-semibold text-neutral-600 uppercase tracking-wider">
                                    {t.crm.table.code}
                                </TableHead>
                                <TableHead className="text-xs font-semibold text-neutral-600 uppercase tracking-wider">
                                    {t.crm.table.contact}
                                </TableHead>
                                <TableHead className="text-center text-xs font-semibold text-neutral-600 uppercase tracking-wider">
                                    {t.crm.table.type}
                                </TableHead>
                                <TableHead className="text-center text-xs font-semibold text-neutral-600 uppercase tracking-wider">
                                    {t.crm.table.tier}
                                </TableHead>
                                <TableHead className="text-right text-xs font-semibold text-neutral-600 uppercase tracking-wider">
                                    {t.crm.table.totalSpent}
                                </TableHead>
                                <TableHead className="text-center text-xs font-semibold text-neutral-600 uppercase tracking-wider">
                                    Orders
                                </TableHead>
                                <TableHead className="px-5 text-center text-xs font-semibold text-neutral-600 uppercase tracking-wider">
                                    {t.common.actions}
                                </TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {loading && (
                                <TableRow>
                                    <TableCell
                                        colSpan={8}
                                        className="text-center text-sm text-neutral-500 py-12"
                                    >
                                        {t.common.loading}
                                    </TableCell>
                                </TableRow>
                            )}
                            {!loading && filtered.length === 0 && (
                                <TableRow>
                                    <TableCell
                                        colSpan={8}
                                        className="text-center text-sm text-neutral-500 py-12"
                                    >
                                        {t.common.noData}
                                    </TableCell>
                                </TableRow>
                            )}
                            {!loading &&
                                filtered.map((c) => (
                                    <TableRow
                                        key={c.id}
                                        className={cn(selected.has(c.id) && 'bg-indigo-50/50')}
                                    >
                                        <TableCell className="w-10 px-3 align-top pt-4">
                                            <input
                                                type="checkbox"
                                                checked={selected.has(c.id)}
                                                onChange={(e) => {
                                                    const next = new Set(selected);
                                                    if (e.target.checked) next.add(c.id);
                                                    else next.delete(c.id);
                                                    setSelected(next);
                                                }}
                                                className="w-3.5 h-3.5 rounded border-neutral-300 accent-indigo-600"
                                            />
                                        </TableCell>
                                        <TableCell className="px-5 font-mono text-sm align-top pt-4">
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    setEditing(c);
                                                    setIsModalOpen(true);
                                                }}
                                                className="text-indigo-600 hover:text-indigo-700 hover:underline focus:outline-none focus:underline cursor-pointer text-left"
                                                title="คลิกเพื่อแก้ไขข้อมูลลูกค้า"
                                            >
                                                {c.code ?? '—'}
                                            </button>
                                            {(branchesByCustomer.get(c.id) ?? []).map((b) => (
                                                <div
                                                    key={b.id}
                                                    className="flex items-center gap-1 text-[11px] text-emerald-700 mt-1 font-normal"
                                                    title={b.branch_name}
                                                >
                                                    <Building2 size={10} className="text-emerald-600 flex-shrink-0" />
                                                    <span className="tabular-nums">{b.branch_code}</span>
                                                    <span className="text-neutral-500 truncate">— {b.branch_name}</span>
                                                </div>
                                            ))}
                                        </TableCell>
                                        <TableCell>
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    setEditing(c);
                                                    setIsModalOpen(true);
                                                }}
                                                className="font-semibold text-neutral-900 hover:text-indigo-600 hover:underline focus:outline-none focus:text-indigo-600 cursor-pointer text-left"
                                                title="คลิกเพื่อแก้ไขข้อมูลลูกค้า"
                                            >
                                                {c.name}
                                            </button>
                                            {c.contact_name && (
                                                <div className="flex items-center gap-1.5 mt-0.5 text-xs text-neutral-600">
                                                    <UserCircle size={12} className="text-neutral-400" />
                                                    {c.contact_name}
                                                </div>
                                            )}
                                            <div className="flex flex-col gap-1 mt-1 text-xs text-neutral-500">
                                                {c.email && (
                                                    <span className="flex items-center gap-1.5">
                                                        <Mail
                                                            size={12}
                                                            className="text-neutral-400"
                                                        />
                                                        {c.email}
                                                    </span>
                                                )}
                                                {c.phone && (
                                                    <span className="flex items-center gap-1.5 tabular-nums">
                                                        <Phone
                                                            size={12}
                                                            className="text-neutral-400"
                                                        />
                                                        {c.phone}
                                                    </span>
                                                )}
                                                {c.mobile && (
                                                    <span className="flex items-center gap-1.5 tabular-nums">
                                                        <Smartphone
                                                            size={12}
                                                            className="text-neutral-400"
                                                        />
                                                        {c.mobile}
                                                    </span>
                                                )}
                                            </div>
                                        </TableCell>
                                        <TableCell className="text-center align-top pt-4">
                                            {(() => {
                                                const meta = typeMeta(c.customer_type);
                                                const Icon = meta.icon;
                                                return (
                                                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium border bg-white border-neutral-200 text-neutral-700">
                                                        <Icon size={11} className={meta.iconClass} />
                                                        {meta.label}
                                                    </span>
                                                );
                                            })()}
                                        </TableCell>
                                        <TableCell className="text-center align-top pt-4">
                                            <span
                                                className={cn(
                                                    'inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold uppercase tracking-wider border',
                                                    TIER_STYLES[c.tier] ?? TIER_STYLES.general,
                                                )}
                                            >
                                                {t.crm.tier[c.tier as keyof typeof t.crm.tier] ??
                                                    c.tier}
                                            </span>
                                        </TableCell>
                                        <TableCell className="text-right align-top pt-4">
                                            <span className="font-bold text-emerald-700 text-base tabular-nums">
                                                ฿{Number(c.total_spent).toLocaleString()}
                                            </span>
                                        </TableCell>
                                        <TableCell className="text-center align-top pt-4 text-sm text-neutral-700 tabular-nums">
                                            {c.total_orders}
                                        </TableCell>
                                        <TableCell className="px-5 text-center align-top pt-4">
                                            <Button
                                                size="sm"
                                                variant="outline"
                                                onClick={() => {
                                                    setEditing(c);
                                                    setIsModalOpen(true);
                                                }}
                                                className="h-8 gap-1 hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-700"
                                            >
                                                <Edit2 size={13} /> {t.common.edit}
                                            </Button>
                                        </TableCell>
                                    </TableRow>
                                ))}
                        </TableBody>
                    </Table>
                </CardContent>
            </Card>
            </>
            )}

            <CustomerModal
                isOpen={isModalOpen}
                onClose={() => setIsModalOpen(false)}
                onSave={handleSave}
                editing={editing}
            />

            <ImportCustomersModal
                isOpen={isImportOpen}
                onClose={() => setIsImportOpen(false)}
                onImported={() => void load()}
                existingCustomers={customers}
            />
        </div>
    );
}
