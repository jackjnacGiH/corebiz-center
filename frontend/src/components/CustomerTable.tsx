import { memo, useMemo } from 'react';
import {
    Briefcase,
    Building2,
    Edit2,
    HelpCircle,
    Mail,
    Phone,
    Smartphone,
    Store,
    User,
    UserCircle,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { Customer, CustomerBranch } from '@/lib/database.types';
import { useLanguage } from '@/i18n';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
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
    vip: 'bg-purple-50 text-purple-700 border-purple-200',
    gold: 'bg-amber-50 text-amber-800 border-amber-300',
    silver: 'bg-slate-100 text-slate-700 border-slate-300',
    general: 'bg-neutral-100 text-neutral-700 border-neutral-200',
};

type CustomerTypeKey = 'company' | 'shop' | 'individual' | 'unspecified';

const TYPE_META: Record<CustomerTypeKey, { label: string; icon: LucideIcon; iconClass: string }> = {
    company: { label: 'นิติบุคคล', icon: Briefcase, iconClass: 'text-blue-600' },
    shop: { label: 'ร้านค้า', icon: Store, iconClass: 'text-amber-600' },
    individual: { label: 'บุคคล', icon: User, iconClass: 'text-emerald-600' },
    unspecified: { label: 'ไม่ระบุ', icon: HelpCircle, iconClass: 'text-neutral-400' },
};

function typeMeta(type: string | null | undefined) {
    return type && type in TYPE_META
        ? TYPE_META[type as CustomerTypeKey]
        : TYPE_META.unspecified;
}

interface CustomerTableProps {
    customers: Customer[];
    loading: boolean;
    hasFilteredResults: boolean;
    branchesByCustomer: ReadonlyMap<string, CustomerBranch[]>;
    selected: ReadonlySet<string>;
    onTogglePage: (customerIds: string[], checked: boolean) => void;
    onToggleCustomer: (customerId: string, checked: boolean) => void;
    onEdit: (customer: Customer) => void;
    onOpenProfile: (customerId: string) => void;
}

/**
 * The customer rows are intentionally isolated behind React.memo. Opening the
 * add/edit modal changes state in the parent CRM page, but must not reconcile
 * the visible customer rows again unless their own data or selection changes.
 */
export default memo(function CustomerTable({
    customers,
    loading,
    hasFilteredResults,
    branchesByCustomer,
    selected,
    onTogglePage,
    onToggleCustomer,
    onEdit,
    onOpenProfile,
}: CustomerTableProps) {
    const { t } = useLanguage();
    const pageIds = useMemo(() => customers.map((customer) => customer.id), [customers]);
    const selectedOnPage = pageIds.reduce(
        (count, customerId) => count + (selected.has(customerId) ? 1 : 0),
        0,
    );
    const allPageSelected = pageIds.length > 0 && selectedOnPage === pageIds.length;

    return (
        <Card data-crm-list-mode="paged-100" className="gap-0 py-0 overflow-hidden">
            <CardContent className="px-0 overflow-x-auto">
                <Table>
                    <TableHeader>
                        <TableRow className="bg-neutral-50 hover:bg-neutral-50">
                            <TableHead className="w-10 px-3">
                                <input
                                    type="checkbox"
                                    checked={allPageSelected}
                                    disabled={pageIds.length === 0}
                                    ref={(element) => {
                                        if (element) {
                                            element.indeterminate =
                                                selectedOnPage > 0 && !allPageSelected;
                                        }
                                    }}
                                    onChange={(event) =>
                                        onTogglePage(pageIds, event.target.checked)
                                    }
                                    aria-label={t.common.selectPage}
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
                        {!loading && !hasFilteredResults && (
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
                            customers.map((customer) => {
                                const meta = typeMeta(customer.customer_type);
                                const TypeIcon = meta.icon;

                                return (
                                    <TableRow
                                        key={customer.id}
                                        className={cn(
                                            selected.has(customer.id) && 'bg-indigo-50/50',
                                        )}
                                    >
                                        <TableCell className="w-10 px-3 align-top pt-4">
                                            <input
                                                type="checkbox"
                                                checked={selected.has(customer.id)}
                                                onChange={(event) =>
                                                    onToggleCustomer(
                                                        customer.id,
                                                        event.target.checked,
                                                    )
                                                }
                                                aria-label={`${t.common.selectCustomer} ${customer.name}`}
                                                className="w-3.5 h-3.5 rounded border-neutral-300 accent-indigo-600"
                                            />
                                        </TableCell>
                                        <TableCell className="px-5 font-mono text-sm align-top pt-4">
                                            <button
                                                type="button"
                                                onClick={() => onEdit(customer)}
                                                className="text-indigo-600 hover:text-indigo-700 hover:underline focus:outline-none focus:underline cursor-pointer text-left"
                                                title="คลิกเพื่อแก้ไขข้อมูลลูกค้า"
                                            >
                                                {customer.code ?? '—'}
                                            </button>
                                            {(branchesByCustomer.get(customer.id) ?? []).map(
                                                (branch) => (
                                                    <div
                                                        key={branch.id}
                                                        className="flex items-center gap-1 text-[11px] text-emerald-700 mt-1 font-normal"
                                                        title={branch.branch_name}
                                                    >
                                                        <Building2
                                                            size={10}
                                                            className="text-emerald-600 flex-shrink-0"
                                                        />
                                                        <span className="tabular-nums">
                                                            {branch.branch_code}
                                                        </span>
                                                        <span className="text-neutral-500 truncate">
                                                            — {branch.branch_name}
                                                        </span>
                                                    </div>
                                                ),
                                            )}
                                        </TableCell>
                                        <TableCell>
                                            <button
                                                type="button"
                                                onClick={() => onEdit(customer)}
                                                className="font-semibold text-neutral-900 hover:text-indigo-600 hover:underline focus:outline-none focus:text-indigo-600 cursor-pointer text-left"
                                                title="คลิกเพื่อแก้ไขข้อมูลลูกค้า"
                                            >
                                                {customer.name}
                                            </button>
                                            {customer.contact_name && (
                                                <div className="flex items-center gap-1.5 mt-0.5 text-xs text-neutral-600">
                                                    <UserCircle
                                                        size={12}
                                                        className="text-neutral-400"
                                                    />
                                                    {customer.contact_name}
                                                </div>
                                            )}
                                            <div className="flex flex-col gap-1 mt-1 text-xs text-neutral-500">
                                                {customer.email && (
                                                    <span className="flex items-center gap-1.5">
                                                        <Mail
                                                            size={12}
                                                            className="text-neutral-400"
                                                        />
                                                        {customer.email}
                                                    </span>
                                                )}
                                                {customer.phone && (
                                                    <span className="flex items-center gap-1.5 tabular-nums">
                                                        <Phone
                                                            size={12}
                                                            className="text-neutral-400"
                                                        />
                                                        {customer.phone}
                                                    </span>
                                                )}
                                                {customer.mobile && (
                                                    <span className="flex items-center gap-1.5 tabular-nums">
                                                        <Smartphone
                                                            size={12}
                                                            className="text-neutral-400"
                                                        />
                                                        {customer.mobile}
                                                    </span>
                                                )}
                                            </div>
                                        </TableCell>
                                        <TableCell className="text-center align-top pt-4">
                                            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium border bg-white border-neutral-200 text-neutral-700">
                                                <TypeIcon size={11} className={meta.iconClass} />
                                                {meta.label}
                                            </span>
                                        </TableCell>
                                        <TableCell className="text-center align-top pt-4">
                                            <span
                                                className={cn(
                                                    'inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold uppercase tracking-wider border',
                                                    TIER_STYLES[customer.tier] ??
                                                        TIER_STYLES.general,
                                                )}
                                            >
                                                {t.crm.tier[
                                                    customer.tier as keyof typeof t.crm.tier
                                                ] ?? customer.tier}
                                            </span>
                                        </TableCell>
                                        <TableCell className="text-right align-top pt-4">
                                            <span className="font-bold text-emerald-700 text-base tabular-nums">
                                                ฿{Number(customer.total_spent).toLocaleString()}
                                            </span>
                                        </TableCell>
                                        <TableCell className="text-center align-top pt-4 text-sm text-neutral-700 tabular-nums">
                                            {customer.total_orders}
                                        </TableCell>
                                        <TableCell className="px-5 text-center align-top pt-4">
                                            <div className="inline-flex items-center gap-1.5">
                                                <Button
                                                    size="sm"
                                                    variant="outline"
                                                    onClick={() =>
                                                        onOpenProfile(customer.id)
                                                    }
                                                    title="ดูโปรไฟล์ 360°"
                                                    className="h-8 gap-1 hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-700"
                                                >
                                                    <UserCircle size={13} /> โปรไฟล์
                                                </Button>
                                                <Button
                                                    size="sm"
                                                    variant="outline"
                                                    onClick={() => onEdit(customer)}
                                                    className="h-8 gap-1 hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-700"
                                                >
                                                    <Edit2 size={13} /> {t.common.edit}
                                                </Button>
                                            </div>
                                        </TableCell>
                                    </TableRow>
                                );
                            })}
                    </TableBody>
                </Table>
            </CardContent>
        </Card>
    );
});
