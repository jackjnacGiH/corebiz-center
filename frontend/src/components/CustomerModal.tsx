import { useState, type FormEvent } from 'react';
import { User, Mail, Phone, Briefcase, Hash, Award, Loader2 } from 'lucide-react';
import type { Customer } from '../lib/database.types';
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

export interface CustomerFormData {
    code: string;
    name: string;
    customer_type: CustomerType;
    tier: 'general' | 'silver' | 'gold' | 'vip';
    email: string;
    phone: string;
    tax_id: string;
    notes: string;
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

function build(c: Customer | null | undefined): CustomerFormData {
    return {
        code: c?.code ?? '',
        name: c?.name ?? '',
        customer_type: normalizeType(c?.customer_type),
        tier: (c?.tier as CustomerFormData['tier']) ?? 'general',
        email: c?.email ?? '',
        phone: c?.phone ?? '',
        tax_id: c?.tax_id ?? '',
        notes: c?.notes ?? '',
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
    const [err, setErr] = useState<string | null>(null);
    const isNew = !editing;

    async function handleSubmit(e: FormEvent) {
        e.preventDefault();
        setErr(null);
        setSaving(true);
        try {
            await onSave(form);
            onClose();
        } catch (e2) {
            setErr((e2 as Error).message);
        } finally {
            setSaving(false);
        }
    }

    return (
        <Dialog open={isOpen} onOpenChange={(o) => !o && onClose()}>
            <DialogContent className="sm:max-w-xl p-0 gap-0 max-h-[90vh] flex flex-col">
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
                                    value={form.phone}
                                    onChange={(e) => setForm({ ...form, phone: e.target.value })}
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
