import { useEffect, useMemo, useState } from 'react';
import {
    Users,
    Mail,
    Phone,
    Search,
    UserPlus,
    Edit2,
    Briefcase,
    User,
    RefreshCw,
} from 'lucide-react';
import { customersApi } from '../lib/api';
import type { Customer } from '../lib/database.types';
import { useLanguage } from '../i18n';
import { useRealtimeTable } from '../lib/useRealtimeTable';
import CustomerModal, { type CustomerFormData } from '../components/CustomerModal';
import PageHeader from '../components/PageHeader';
import StatTile from '../components/StatTile';
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

export default function CRM() {
    const { t } = useLanguage();
    const [customers, setCustomers] = useState<Customer[]>([]);
    const [loading, setLoading] = useState(true);
    const [err, setErr] = useState<string | null>(null);
    const [search, setSearch] = useState('');
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editing, setEditing] = useState<Customer | null>(null);

    async function load() {
        setLoading(true);
        setErr(null);
        try {
            setCustomers(await customersApi.list());
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

    async function handleSave(data: CustomerFormData) {
        const payload = {
            code: data.code || null,
            name: data.name,
            customer_type: data.customer_type,
            tier: data.tier,
            email: data.email || null,
            phone: data.phone || null,
            tax_id: data.tax_id || null,
            notes: data.notes || null,
        };
        if (editing) {
            await customersApi.update(editing.id, payload);
        } else {
            await customersApi.create(payload);
        }
        await load();
    }

    const filtered = useMemo(() => {
        if (!search) return customers;
        const s = search.toLowerCase();
        return customers.filter(
            (c) =>
                c.name.toLowerCase().includes(s) ||
                (c.email?.toLowerCase().includes(s) ?? false) ||
                (c.phone?.includes(s) ?? false) ||
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
                        <div className="relative">
                            <Search
                                size={14}
                                className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400 pointer-events-none"
                            />
                            <Input
                                type="text"
                                placeholder={t.crm.searchPlaceholder}
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                                className="pl-9 w-64"
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

            {err && (
                <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                    ✗ {err}
                </div>
            )}

            <Card className="gap-0 py-0 overflow-hidden">
                <CardContent className="px-0 overflow-x-auto">
                    <Table>
                        <TableHeader>
                            <TableRow className="bg-neutral-50 hover:bg-neutral-50">
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
                                        colSpan={7}
                                        className="text-center text-sm text-neutral-500 py-12"
                                    >
                                        {t.common.loading}
                                    </TableCell>
                                </TableRow>
                            )}
                            {!loading && filtered.length === 0 && (
                                <TableRow>
                                    <TableCell
                                        colSpan={7}
                                        className="text-center text-sm text-neutral-500 py-12"
                                    >
                                        {t.common.noData}
                                    </TableCell>
                                </TableRow>
                            )}
                            {!loading &&
                                filtered.map((c) => (
                                    <TableRow key={c.id}>
                                        <TableCell className="px-5 font-mono text-sm text-indigo-600 align-top pt-4">
                                            {c.code ?? '—'}
                                        </TableCell>
                                        <TableCell>
                                            <div className="font-semibold text-neutral-900">
                                                {c.name}
                                            </div>
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
                                            </div>
                                        </TableCell>
                                        <TableCell className="text-center align-top pt-4">
                                            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium border bg-white border-neutral-200 text-neutral-700">
                                                {c.customer_type === 'company' ? (
                                                    <>
                                                        <Briefcase
                                                            size={11}
                                                            className="text-blue-600"
                                                        />
                                                        บริษัท
                                                    </>
                                                ) : (
                                                    <>
                                                        <User
                                                            size={11}
                                                            className="text-emerald-600"
                                                        />
                                                        บุคคล
                                                    </>
                                                )}
                                            </span>
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

            <CustomerModal
                isOpen={isModalOpen}
                onClose={() => setIsModalOpen(false)}
                onSave={handleSave}
                editing={editing}
            />
        </div>
    );
}
