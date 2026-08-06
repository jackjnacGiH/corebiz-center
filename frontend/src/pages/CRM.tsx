import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    Users,
    Search,
    UserPlus,
    Briefcase,
    User,
    RefreshCw,
    Upload,
    FileDown,
    Trash2,
    Target,
    Bell,
    HeartHandshake,
    ShoppingCart,
    Smile,
    Gift,
    Crown,
    Megaphone,
    LayoutDashboard,
    CalendarClock,
    ChevronLeft,
    ChevronRight,
} from 'lucide-react';
import { customersApi, customerBranchesApi } from '../lib/api';
import { supabase } from '../lib/supabase';
import { useAuth } from '@/lib/AuthProvider';
import { isAdminOrOwner } from '@/lib/permissions';
import type { Customer, CustomerBranch, Json } from '../lib/database.types';
import { useLanguage } from '../i18n';
import { useRealtimeTable } from '../lib/useRealtimeTable';
import CustomerModal, { type CustomerFormData } from '../components/CustomerModal';
import ImportCustomersModal from '../components/ImportCustomersModal';
import PageHeader from '../components/PageHeader';
import StatTile from '../components/StatTile';
import CustomerSegments from '../components/CustomerSegments';
import CustomerProfile from '../components/CustomerProfile';
import CustomerReorder from '../components/CustomerReorder';
import CustomerWinback from '../components/CustomerWinback';
import CustomerQuoteFollowup from '../components/CustomerQuoteFollowup';
import CustomerSurvey from '../components/CustomerSurvey';
import CustomerReferral from '../components/CustomerReferral';
import TierBenefits from '../components/TierBenefits';
import CustomerCampaign from '../components/CustomerCampaign';
import CrmDashboard from '../components/CrmDashboard';
import CustomerSchedule from '../components/CustomerSchedule';
import CustomerTable from '../components/CustomerTable';
import { buildCustomersCsv, downloadCsv } from '../lib/customerCsv';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

const CUSTOMER_PAGE_SIZE = 100;
const REALTIME_RELOAD_DELAY_MS = 150;

// Session-lived cache so re-entering CRM shows data instantly (then revalidates
// in the background). Survives route changes; reset on full reload.
let customersCache: Customer[] | null = null;
let branchesCache: CustomerBranch[] | null = null;

/** Portal tax-id link request awaiting Owner/Admin approval (RPC row). */
interface PendingLink {
    contact_id: string;
    requested_at: string;
    contact_name: string | null;
    contact_phone: string | null;
    login_email: string | null;
    claimed_company: string | null;
    claimed_address: string | null;
    customer_id: string;
    customer_code: string | null;
    customer_name: string;
    customer_tier: string;
}

export default function CRM() {
    const { t } = useLanguage();
    const { profile } = useAuth();
    const canApprove = isAdminOrOwner(profile?.role);
    const [pendingLinks, setPendingLinks] = useState<PendingLink[]>([]);
    const [linkBusy, setLinkBusy] = useState<string | null>(null);
    const [customers, setCustomers] = useState<Customer[]>(() => customersCache ?? []);
    const [branches, setBranches] = useState<CustomerBranch[]>(() => branchesCache ?? []);
    const [loading, setLoading] = useState(customersCache === null);
    const [err, setErr] = useState<string | null>(null);
    const [search, setSearch] = useState('');
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editing, setEditing] = useState<Customer | null>(null);
    const [isImportOpen, setIsImportOpen] = useState(false);
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [bulkDeleting, setBulkDeleting] = useState(false);
    const [page, setPage] = useState(1);
    // Which CRM view is active.
    const [view, setView] = useState<'dashboard' | 'list' | 'rfm' | 'reorder' | 'winback' | 'quotes' | 'nps' | 'referral' | 'tier' | 'campaign' | 'schedule'>('list');
    // Customer id whose 360° profile drawer is open (null = closed).
    const [profileId, setProfileId] = useState<string | null>(null);
    const loadInFlightRef = useRef<Promise<void> | null>(null);
    const loadQueuedRef = useRef(false);
    const realtimeReloadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const load = useCallback(async () => {
        // All callers share one request cycle. If Realtime fires again while a
        // refresh is active, run at most one trailing refresh after it finishes.
        if (loadInFlightRef.current) {
            loadQueuedRef.current = true;
            return loadInFlightRef.current;
        }

        const cycle = (async () => {
            setErr(null);
            // Cold load → show spinner. Warm (cached) → keep showing cached data
            // while we revalidate silently in the background.
            if (customersCache === null) setLoading(true);

            try {
                do {
                    loadQueuedRef.current = false;
                    const [freshCustomers, freshBranches] = await Promise.all([
                        customersApi.list(),
                        customerBranchesApi.listAll(),
                    ]);
                    customersCache = freshCustomers;
                    branchesCache = freshBranches;
                    setCustomers(freshCustomers);
                    setBranches(freshBranches);
                } while (loadQueuedRef.current);
            } catch (error) {
                setErr((error as Error).message);
            } finally {
                setLoading(false);
            }
        })();

        loadInFlightRef.current = cycle;
        try {
            await cycle;
        } finally {
            if (loadInFlightRef.current === cycle) {
                loadInFlightRef.current = null;
            }
        }
    }, []);

    // Portal link requests awaiting approval (tax-id matched an existing customer).
    const loadPendingLinks = useCallback(async () => {
        const { data, error } = await (supabase.rpc as CallableFunction)('list_pending_customer_links');
        if (!error) setPendingLinks((data ?? []) as PendingLink[]);
    }, []);

    const scheduleRealtimeLoad = useCallback(() => {
        if (realtimeReloadTimerRef.current) {
            clearTimeout(realtimeReloadTimerRef.current);
        }
        realtimeReloadTimerRef.current = setTimeout(() => {
            realtimeReloadTimerRef.current = null;
            void load();
        }, REALTIME_RELOAD_DELAY_MS);
    }, [load]);

    async function decideLink(contactId: string, approve: boolean) {
        const fn = approve ? 'approve_customer_link' : 'reject_customer_link';
        const verb = approve ? 'อนุมัติ' : 'ปฏิเสธ';
        if (!window.confirm(`${verb}คำขอเชื่อมบัญชีนี้ใช่หรือไม่?${approve ? ' ลูกค้าจะเห็น Tier และประวัติทั้งหมดของบริษัททันที' : ''}`)) return;
        setLinkBusy(contactId);
        try {
            const { error } = await (supabase.rpc as CallableFunction)(fn, { p_contact_id: contactId });
            if (error) throw error;
            await loadPendingLinks();
        } catch (e) {
            window.alert(`${verb}ไม่สำเร็จ: ${(e as Error).message}`);
        } finally {
            setLinkBusy(null);
        }
    }

    useEffect(() => {
        void load();
        void loadPendingLinks();
    }, [load, loadPendingLinks]);

    useEffect(
        () => () => {
            if (realtimeReloadTimerRef.current) {
                clearTimeout(realtimeReloadTimerRef.current);
            }
        },
        [],
    );

    useRealtimeTable('customers', scheduleRealtimeLoad);
    useRealtimeTable('customer_branches', scheduleRealtimeLoad);
    useRealtimeTable('customer_contacts', loadPendingLinks);

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

    const pageCount = Math.max(1, Math.ceil(filtered.length / CUSTOMER_PAGE_SIZE));
    const currentPage = Math.min(page, pageCount);
    const visibleCustomers = useMemo(() => {
        const from = (currentPage - 1) * CUSTOMER_PAGE_SIZE;
        return filtered.slice(from, from + CUSTOMER_PAGE_SIZE);
    }, [currentPage, filtered]);
    const firstVisibleCustomer = filtered.length === 0
        ? 0
        : (currentPage - 1) * CUSTOMER_PAGE_SIZE + 1;
    const lastVisibleCustomer = Math.min(
        currentPage * CUSTOMER_PAGE_SIZE,
        filtered.length,
    );

    useEffect(() => {
        if (page > pageCount) setPage(pageCount);
    }, [page, pageCount]);

    const handleEditCustomer = useCallback((customer: Customer) => {
        setEditing(customer);
        setIsModalOpen(true);
    }, []);

    const handleOpenProfile = useCallback((customerId: string) => {
        setProfileId(customerId);
    }, []);

    const handleToggleCustomer = useCallback((customerId: string, checked: boolean) => {
        setSelected((current) => {
            const next = new Set(current);
            if (checked) next.add(customerId);
            else next.delete(customerId);
            return next;
        });
    }, []);

    const handleTogglePage = useCallback((customerIds: string[], checked: boolean) => {
        setSelected((current) => {
            const next = new Set(current);
            for (const customerId of customerIds) {
                if (checked) next.add(customerId);
                else next.delete(customerId);
            }
            return next;
        });
    }, []);

    return (
        <div className="animate-fade-in space-y-6">
            <PageHeader
                title={t.crm.title}
                subtitle={t.crm.subtitle}
                icon={<Users size={20} />}
                actions={
                    <>
                        <div className="relative w-full md:flex-1 order-first md:order-none">
                            <Search
                                size={14}
                                className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400 pointer-events-none"
                            />
                            <Input
                                type="text"
                                placeholder={t.crm.searchPlaceholder}
                                value={search}
                                onChange={(event) => {
                                    setSearch(event.target.value);
                                    setPage(1);
                                }}
                                className="pl-9 w-full"
                            />
                        </div>
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

            {/* ── Portal link requests awaiting Owner/Admin approval ──── */}
            {pendingLinks.length > 0 && (
                <Card className="border-amber-300 bg-amber-50/70">
                    <CardContent className="p-5">
                        <div className="flex items-center gap-2">
                            <Bell size={16} className="text-amber-600" />
                            <h3 className="font-bold text-amber-900 text-sm">
                                คำขอเชื่อมบัญชีลูกค้าจากหน้าร้าน — รออนุมัติ ({pendingLinks.length})
                            </h3>
                        </div>
                        <p className="mt-1 text-xs text-amber-800">
                            ลูกค้าลงทะเบียนด้วยเลขผู้เสียภาษีที่ตรงกับลูกค้าเดิมในระบบ
                            กรุณาติดต่อขอเอกสารยืนยัน (เช่น หนังสือรับรองบริษัท, ภพ.20)
                            ก่อนอนุมัติ — ลูกค้าจะยังไม่เห็น Tier/ประวัติของบริษัทจนกว่าจะอนุมัติ
                            {!canApprove && ' (กดอนุมัติ/ปฏิเสธได้เฉพาะ Owner และ Admin)'}
                        </p>
                        <div className="mt-3 space-y-2">
                            {pendingLinks.map((pl) => (
                                <div
                                    key={pl.contact_id}
                                    className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-amber-200 bg-white px-4 py-3"
                                >
                                    <div className="min-w-0 flex-1">
                                        <div className="text-sm font-semibold text-neutral-800">
                                            {pl.contact_name ?? '-'}
                                            <span className="ml-2 font-normal text-neutral-500">
                                                {pl.contact_phone ?? ''} · {pl.login_email ?? ''}
                                            </span>
                                        </div>
                                        <div className="mt-0.5 text-xs text-neutral-500">
                                            อ้างถึงบริษัท: <b>{pl.claimed_company ?? '-'}</b>
                                            {' '}→ ตรงกับลูกค้าในระบบ:{' '}
                                            <b className="text-neutral-700">{pl.customer_name}</b>
                                            {pl.customer_code ? ` (${pl.customer_code})` : ''} · Tier {pl.customer_tier}
                                            {' '}· ขอเมื่อ {new Date(pl.requested_at).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' })}
                                        </div>
                                    </div>
                                    <div className="flex gap-2">
                                        <Button
                                            size="sm"
                                            disabled={!canApprove || linkBusy === pl.contact_id}
                                            onClick={() => void decideLink(pl.contact_id, true)}
                                            className="h-8 bg-emerald-600 hover:bg-emerald-700"
                                        >
                                            อนุมัติ
                                        </Button>
                                        <Button
                                            size="sm"
                                            variant="outline"
                                            disabled={!canApprove || linkBusy === pl.contact_id}
                                            onClick={() => void decideLink(pl.contact_id, false)}
                                            className="h-8 border-rose-300 text-rose-600 hover:bg-rose-50"
                                        >
                                            ปฏิเสธ
                                        </Button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </CardContent>
                </Card>
            )}

            {/* View toggle: customer list ↔ RFM segments ↔ retention tools */}
            <div className="flex items-center gap-1 rounded-lg border border-neutral-200 bg-white p-1 self-start overflow-x-auto max-w-full [&>button]:shrink-0">
                <button
                    type="button"
                    onClick={() => setView('dashboard')}
                    className={cn(
                        'inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-xs font-semibold transition',
                        view === 'dashboard' ? 'bg-indigo-500 text-white shadow-sm' : 'text-neutral-600 hover:bg-neutral-100',
                    )}
                >
                    <LayoutDashboard size={14} /> แดชบอร์ด
                </button>
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
                <button
                    type="button"
                    onClick={() => setView('reorder')}
                    className={cn(
                        'inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-xs font-semibold transition',
                        view === 'reorder' ? 'bg-indigo-500 text-white shadow-sm' : 'text-neutral-600 hover:bg-neutral-100',
                    )}
                >
                    <Bell size={14} /> เตือนซื้อซ้ำ
                </button>
                <button
                    type="button"
                    onClick={() => setView('winback')}
                    className={cn(
                        'inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-xs font-semibold transition',
                        view === 'winback' ? 'bg-indigo-500 text-white shadow-sm' : 'text-neutral-600 hover:bg-neutral-100',
                    )}
                >
                    <HeartHandshake size={14} /> ดึงลูกค้ากลับ
                </button>
                <button
                    type="button"
                    onClick={() => setView('quotes')}
                    className={cn(
                        'inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-xs font-semibold transition',
                        view === 'quotes' ? 'bg-indigo-500 text-white shadow-sm' : 'text-neutral-600 hover:bg-neutral-100',
                    )}
                >
                    <ShoppingCart size={14} /> กู้ตะกร้า
                </button>
                <button
                    type="button"
                    onClick={() => setView('nps')}
                    className={cn(
                        'inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-xs font-semibold transition',
                        view === 'nps' ? 'bg-indigo-500 text-white shadow-sm' : 'text-neutral-600 hover:bg-neutral-100',
                    )}
                >
                    <Smile size={14} /> ความพึงพอใจ
                </button>
                <button
                    type="button"
                    onClick={() => setView('referral')}
                    className={cn(
                        'inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-xs font-semibold transition',
                        view === 'referral' ? 'bg-indigo-500 text-white shadow-sm' : 'text-neutral-600 hover:bg-neutral-100',
                    )}
                >
                    <Gift size={14} /> แนะนำเพื่อน
                </button>
                <button
                    type="button"
                    onClick={() => setView('tier')}
                    className={cn(
                        'inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-xs font-semibold transition',
                        view === 'tier' ? 'bg-indigo-500 text-white shadow-sm' : 'text-neutral-600 hover:bg-neutral-100',
                    )}
                >
                    <Crown size={14} /> สิทธิ์ Tier
                </button>
                <button
                    type="button"
                    onClick={() => setView('campaign')}
                    className={cn(
                        'inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-xs font-semibold transition',
                        view === 'campaign' ? 'bg-indigo-500 text-white shadow-sm' : 'text-neutral-600 hover:bg-neutral-100',
                    )}
                >
                    <Megaphone size={14} /> แคมเปญ
                </button>
                <button
                    type="button"
                    onClick={() => setView('schedule')}
                    className={cn(
                        'inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-xs font-semibold transition',
                        view === 'schedule' ? 'bg-indigo-500 text-white shadow-sm' : 'text-neutral-600 hover:bg-neutral-100',
                    )}
                >
                    <CalendarClock size={14} /> นัดส่ง
                </button>
            </div>

            {view === 'dashboard' && <CrmDashboard />}
            {view === 'rfm' && <CustomerSegments />}
            {view === 'reorder' && <CustomerReorder />}
            {view === 'winback' && <CustomerWinback />}
            {view === 'quotes' && <CustomerQuoteFollowup />}
            {view === 'nps' && <CustomerSurvey />}
            {view === 'referral' && <CustomerReferral />}
            {view === 'tier' && <TierBenefits />}
            {view === 'campaign' && <CustomerCampaign />}
            {view === 'schedule' && <CustomerSchedule />}

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
                    {t.common.found}{' '}
                    <span className="text-neutral-900 font-medium">{filtered.length}</span> /{' '}
                    {customers.length} {t.common.items}
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

            <CustomerTable
                customers={visibleCustomers}
                loading={loading}
                hasFilteredResults={filtered.length > 0}
                branchesByCustomer={branchesByCustomer}
                selected={selected}
                onTogglePage={handleTogglePage}
                onToggleCustomer={handleToggleCustomer}
                onEdit={handleEditCustomer}
                onOpenProfile={handleOpenProfile}
            />

            {!loading && filtered.length > 0 && (
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between text-xs text-neutral-500">
                    <span>
                        {t.common.showing} {firstVisibleCustomer.toLocaleString()}–{lastVisibleCustomer.toLocaleString()}{' '}
                        {t.common.of}{' '}
                        <span className="font-medium text-neutral-900">
                            {filtered.length.toLocaleString()}
                        </span>{' '}
                        {t.common.items}
                    </span>
                    <div className="flex items-center gap-2">
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => setPage((current) => Math.max(1, current - 1))}
                            disabled={currentPage === 1}
                            className="h-8 gap-1"
                        >
                            <ChevronLeft size={14} /> {t.common.previous}
                        </Button>
                        <span className="min-w-20 text-center tabular-nums text-neutral-700">
                            {t.common.page} {currentPage.toLocaleString()} / {pageCount.toLocaleString()}
                        </span>
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() =>
                                setPage((current) => Math.min(pageCount, current + 1))
                            }
                            disabled={currentPage === pageCount}
                            className="h-8 gap-1"
                        >
                            {t.common.next} <ChevronRight size={14} />
                        </Button>
                    </div>
                </div>
            )}
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

            {profileId && (
                <CustomerProfile customerId={profileId} onClose={() => setProfileId(null)} />
            )}
        </div>
    );
}
