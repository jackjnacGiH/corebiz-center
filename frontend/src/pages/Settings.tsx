import { useEffect, useState } from 'react';
import {
    Settings as SettingsIcon,
    User,
    Bell,
    Shield,
    Globe,
    Building2,
    Save,
    Mail,
    Phone,
    CheckCircle,
    AlertTriangle,
    Loader2,
} from 'lucide-react';
import { useAuth } from '../lib/AuthProvider';
import { supabase, DEFAULT_NOTIFICATION_PREFS, type NotificationPrefs } from '../lib/supabase';
import { orgSettingsApi } from '../lib/api';
import type { OrgSettings } from '../lib/database.types';
import { useLanguage, type Language } from '../i18n';
import PageHeader from '../components/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';

export default function Settings() {
    const { profile, refresh } = useAuth();
    const { language, setLanguage, t } = useLanguage();
    const [tab, setTab] = useState<'profile' | 'notifications' | 'security' | 'workspace'>(
        'profile',
    );

    // ── Profile form state ────────────────────────────────────────────
    const [fullName, setFullName] = useState(profile?.full_name ?? '');
    const [phone, setPhone] = useState(profile?.phone ?? '');
    const [savingProfile, setSavingProfile] = useState(false);
    const [profileErr, setProfileErr] = useState<string | null>(null);
    const [profileSavedAt, setProfileSavedAt] = useState<number | null>(null);

    // Keep form in sync when AuthProvider's profile becomes available
    // (first load) or refreshes after a save in another tab.
    useEffect(() => {
        setFullName(profile?.full_name ?? '');
        setPhone(profile?.phone ?? '');
    }, [profile?.id, profile?.full_name, profile?.phone]);

    async function handleSaveProfile() {
        if (!profile?.id) return;
        setSavingProfile(true);
        setProfileErr(null);
        setProfileSavedAt(null);
        try {
            const { error } = await supabase
                .from('profiles')
                .update({
                    full_name: fullName.trim() || null,
                    phone: phone.trim() || null,
                })
                .eq('id', profile.id);
            if (error) throw error;
            await refresh();
            setProfileSavedAt(Date.now());
        } catch (e) {
            setProfileErr((e as Error).message);
        } finally {
            setSavingProfile(false);
        }
    }

    const profileDirty =
        (fullName.trim() || null) !== (profile?.full_name ?? null) ||
        (phone.trim() || null) !== (profile?.phone ?? null);

    // ── Notification prefs ────────────────────────────────────────────
    const [prefs, setPrefs] = useState<NotificationPrefs>(
        profile?.notification_prefs ?? DEFAULT_NOTIFICATION_PREFS,
    );
    const [savingPrefs, setSavingPrefs] = useState(false);
    const [prefsErr, setPrefsErr] = useState<string | null>(null);

    useEffect(() => {
        if (profile?.notification_prefs) setPrefs(profile.notification_prefs);
    }, [profile?.notification_prefs]);

    async function togglePref(key: keyof NotificationPrefs) {
        if (!profile?.id) return;
        const previous = prefs;
        const next: NotificationPrefs = { ...prefs, [key]: !prefs[key] };
        setPrefs(next); // optimistic
        setSavingPrefs(true);
        setPrefsErr(null);
        try {
            const { error } = await supabase
                .from('profiles')
                .update({ notification_prefs: next as unknown as Record<string, boolean> })
                .eq('id', profile.id);
            if (error) throw error;
            await refresh();
        } catch (e) {
            setPrefs(previous); // rollback
            setPrefsErr((e as Error).message);
        } finally {
            setSavingPrefs(false);
        }
    }

    // ── Change password ───────────────────────────────────────────────
    const [curPwd, setCurPwd] = useState('');
    const [newPwd, setNewPwd] = useState('');
    const [confirmPwd, setConfirmPwd] = useState('');
    const [savingPwd, setSavingPwd] = useState(false);
    const [pwdErr, setPwdErr] = useState<string | null>(null);
    const [pwdSavedAt, setPwdSavedAt] = useState<number | null>(null);

    const isEmailProvider = profile?.provider === 'email';

    async function handleChangePassword() {
        setPwdErr(null);
        setPwdSavedAt(null);
        if (!isEmailProvider) {
            setPwdErr(
                `บัญชีนี้เข้าระบบด้วย ${profile?.provider ?? 'OAuth'} — เปลี่ยนรหัสจากผู้ให้บริการนั้นได้เลย`,
            );
            return;
        }
        if (newPwd.length < 6) {
            setPwdErr('รหัสผ่านใหม่ต้องมีอย่างน้อย 6 ตัวอักษร');
            return;
        }
        if (newPwd !== confirmPwd) {
            setPwdErr('รหัสผ่านใหม่และยืนยันไม่ตรงกัน');
            return;
        }
        if (!profile?.email) {
            setPwdErr('ไม่พบ email — ลองรีโหลดหน้า');
            return;
        }
        setSavingPwd(true);
        try {
            // 1. Verify current password by re-authing
            const { error: verifyErr } = await supabase.auth.signInWithPassword({
                email: profile.email,
                password: curPwd,
            });
            if (verifyErr) {
                throw new Error('รหัสผ่านปัจจุบันไม่ถูกต้อง');
            }
            // 2. Update to new password
            const { error: updateErr } = await supabase.auth.updateUser({
                password: newPwd,
            });
            if (updateErr) throw updateErr;
            setCurPwd('');
            setNewPwd('');
            setConfirmPwd('');
            setPwdSavedAt(Date.now());
        } catch (e) {
            setPwdErr((e as Error).message);
        } finally {
            setSavingPwd(false);
        }
    }

    // ── Workspace / org_settings ──────────────────────────────────────
    const [orgSettings, setOrgSettings] = useState<OrgSettings | null>(null);
    const [orgForm, setOrgForm] = useState({
        business_name: '',
        tax_id: '',
        address: '',
        phone: '',
        email: '',
        website: '',
    });
    const [orgLoading, setOrgLoading] = useState(true);
    const [savingOrg, setSavingOrg] = useState(false);
    const [orgErr, setOrgErr] = useState<string | null>(null);
    const [orgSavedAt, setOrgSavedAt] = useState<number | null>(null);

    useEffect(() => {
        let cancelled = false;
        orgSettingsApi
            .get()
            .then((s) => {
                if (cancelled) return;
                setOrgSettings(s);
                if (s) {
                    setOrgForm({
                        business_name: s.business_name ?? '',
                        tax_id: s.tax_id ?? '',
                        address: s.address ?? '',
                        phone: s.phone ?? '',
                        email: s.email ?? '',
                        website: s.website ?? '',
                    });
                }
            })
            .catch((e) => {
                if (!cancelled) setOrgErr((e as Error).message);
            })
            .finally(() => {
                if (!cancelled) setOrgLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, []);

    const orgDirty =
        orgSettings != null &&
        (orgForm.business_name.trim() !== (orgSettings.business_name ?? '') ||
            orgForm.tax_id.trim() !== (orgSettings.tax_id ?? '') ||
            orgForm.address.trim() !== (orgSettings.address ?? '') ||
            orgForm.phone.trim() !== (orgSettings.phone ?? '') ||
            orgForm.email.trim() !== (orgSettings.email ?? '') ||
            orgForm.website.trim() !== (orgSettings.website ?? ''));

    async function handleSaveOrg() {
        setSavingOrg(true);
        setOrgErr(null);
        setOrgSavedAt(null);
        try {
            const updated = await orgSettingsApi.update({
                business_name: orgForm.business_name.trim() || null,
                tax_id: orgForm.tax_id.trim() || null,
                address: orgForm.address.trim() || null,
                phone: orgForm.phone.trim() || null,
                email: orgForm.email.trim() || null,
                website: orgForm.website.trim() || null,
            });
            setOrgSettings(updated);
            setOrgSavedAt(Date.now());
        } catch (e) {
            setOrgErr((e as Error).message);
        } finally {
            setSavingOrg(false);
        }
    }

    return (
        <div className="animate-fade-in space-y-6">
            <PageHeader
                title={t.layout.systemSettings}
                subtitle="จัดการบัญชี การแจ้งเตือน ความปลอดภัย และการตั้งค่า workspace"
                icon={<SettingsIcon size={20} />}
            />

            <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)} className="space-y-5">
                <TabsList className="bg-neutral-100">
                    <TabsTrigger value="profile" className="gap-2">
                        <User size={14} /> โปรไฟล์
                    </TabsTrigger>
                    <TabsTrigger value="notifications" className="gap-2">
                        <Bell size={14} /> การแจ้งเตือน
                    </TabsTrigger>
                    <TabsTrigger value="security" className="gap-2">
                        <Shield size={14} /> ความปลอดภัย
                    </TabsTrigger>
                    <TabsTrigger value="workspace" className="gap-2">
                        <Building2 size={14} /> Workspace
                    </TabsTrigger>
                </TabsList>

                {/* ── Profile tab ─────────────────────────────────────── */}
                <TabsContent value="profile" className="space-y-4 mt-0">
                    <Card className="gap-5 py-6">
                        <CardHeader className="px-6">
                            <CardTitle className="text-base font-semibold text-neutral-900">
                                ข้อมูลโปรไฟล์
                            </CardTitle>
                            <p className="text-xs text-neutral-500 mt-1">
                                ข้อมูลที่แสดงในระบบและในรายงาน
                            </p>
                        </CardHeader>
                        <CardContent className="px-6 space-y-5">
                            {/* Avatar */}
                            <div className="flex items-center gap-4">
                                {profile?.avatar_url ? (
                                    <img
                                        src={profile.avatar_url}
                                        alt={profile.full_name ?? 'avatar'}
                                        className="w-16 h-16 rounded-full object-cover border border-neutral-200"
                                    />
                                ) : (
                                    <div className="w-16 h-16 rounded-full bg-neutral-900 text-white text-lg font-bold grid place-items-center">
                                        {(profile?.full_name ?? profile?.email ?? '?')
                                            .charAt(0)
                                            .toUpperCase()}
                                    </div>
                                )}
                                <div>
                                    <div className="text-sm font-semibold text-neutral-900">
                                        {profile?.full_name ?? '—'}
                                    </div>
                                    <div className="text-xs text-neutral-500">
                                        {profile?.email}
                                    </div>
                                    {profile?.provider && (
                                        <div className="text-[10px] uppercase tracking-wider text-neutral-400 mt-1">
                                            via {profile.provider}
                                        </div>
                                    )}
                                </div>
                            </div>

                            <Separator />

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <Label htmlFor="full-name">ชื่อ-นามสกุล</Label>
                                    <Input
                                        id="full-name"
                                        value={fullName}
                                        onChange={(e) => setFullName(e.target.value)}
                                        placeholder="กรอกชื่อ"
                                        disabled={savingProfile}
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="role">บทบาท</Label>
                                    <Input
                                        id="role"
                                        defaultValue={profile?.role ?? 'admin'}
                                        disabled
                                        className="bg-neutral-50"
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="email" className="flex items-center gap-1.5">
                                        <Mail size={12} /> Email
                                    </Label>
                                    <Input
                                        id="email"
                                        type="email"
                                        defaultValue={profile?.email ?? ''}
                                        disabled
                                        className="bg-neutral-50"
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="phone" className="flex items-center gap-1.5">
                                        <Phone size={12} /> โทรศัพท์
                                    </Label>
                                    <Input
                                        id="phone"
                                        type="tel"
                                        value={phone}
                                        onChange={(e) => setPhone(e.target.value)}
                                        placeholder="08x-xxx-xxxx"
                                        disabled={savingProfile}
                                    />
                                </div>
                            </div>

                            {profileErr && (
                                <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                                    <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />
                                    <span>{profileErr}</span>
                                </div>
                            )}

                            <div className="flex items-center justify-end gap-3 pt-2">
                                {profileSavedAt && !profileDirty && (
                                    <span className="inline-flex items-center gap-1 text-xs text-emerald-700">
                                        <CheckCircle size={12} />
                                        บันทึกเรียบร้อย
                                    </span>
                                )}
                                <Button
                                    type="button"
                                    onClick={() => void handleSaveProfile()}
                                    disabled={savingProfile || !profileDirty || !profile}
                                    className="gap-2 bg-indigo-500 hover:bg-indigo-600"
                                >
                                    {savingProfile ? (
                                        <Loader2 size={14} className="animate-spin" />
                                    ) : (
                                        <Save size={14} />
                                    )}
                                    {savingProfile ? 'กำลังบันทึก...' : 'บันทึก'}
                                </Button>
                            </div>
                        </CardContent>
                    </Card>

                    <Card className="gap-5 py-6">
                        <CardHeader className="px-6">
                            <CardTitle className="text-base font-semibold text-neutral-900 flex items-center gap-2">
                                <Globe size={14} className="text-indigo-600" />
                                ภาษา
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="px-6">
                            <div className="flex gap-2">
                                {(
                                    [
                                        { value: 'th' as Language, label: 'ภาษาไทย' },
                                        { value: 'en' as Language, label: 'English' },
                                    ]
                                ).map((opt) => (
                                    <button
                                        key={opt.value}
                                        type="button"
                                        onClick={() => setLanguage(opt.value)}
                                        className={cn(
                                            'px-4 py-2 rounded-lg border text-sm font-medium transition',
                                            language === opt.value
                                                ? 'border-indigo-200 bg-indigo-50 text-indigo-700'
                                                : 'border-neutral-200 bg-white text-neutral-700 hover:bg-neutral-50',
                                        )}
                                    >
                                        {opt.label}
                                    </button>
                                ))}
                            </div>
                        </CardContent>
                    </Card>
                </TabsContent>

                {/* ── Notifications tab ───────────────────────────────── */}
                <TabsContent value="notifications" className="space-y-4 mt-0">
                    <Card className="gap-5 py-6">
                        <CardHeader className="px-6">
                            <CardTitle className="text-base font-semibold text-neutral-900">
                                การแจ้งเตือน
                            </CardTitle>
                            <p className="text-xs text-neutral-500 mt-1">
                                เลือกประเภทการแจ้งเตือนที่ต้องการรับใน Notification panel
                                (รูประฆังมุมขวาบน) — ปิดแล้วจะไม่แสดงในรายการ
                            </p>
                        </CardHeader>
                        <CardContent className="px-6 space-y-1">
                            {([
                                {
                                    key: 'new_order' as const,
                                    title: 'คำสั่งซื้อใหม่',
                                    desc: 'แจ้งเตือนเมื่อมีออเดอร์เข้ามา',
                                },
                                {
                                    key: 'low_stock' as const,
                                    title: 'สต็อกต่ำ',
                                    desc: 'แจ้งเตือนเมื่อสินค้าใกล้หมดหรือหมดสต๊อก',
                                },
                                {
                                    key: 'new_customer' as const,
                                    title: 'ลูกค้าใหม่',
                                    desc: 'แจ้งเตือนเมื่อมีลูกค้าลงทะเบียน',
                                },
                                {
                                    key: 'weekly_report' as const,
                                    title: 'รายงานประจำสัปดาห์',
                                    desc: 'สรุปผลการดำเนินงาน และ system notifications',
                                },
                            ]).map((row) => (
                                <BoundToggleRow
                                    key={row.key}
                                    title={row.title}
                                    desc={row.desc}
                                    enabled={prefs[row.key]}
                                    onChange={() => void togglePref(row.key)}
                                    disabled={savingPrefs}
                                />
                            ))}
                            {prefsErr && (
                                <div className="mt-3 flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                                    <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />
                                    <span>{prefsErr}</span>
                                </div>
                            )}
                        </CardContent>
                    </Card>
                </TabsContent>

                {/* ── Security tab ────────────────────────────────────── */}
                <TabsContent value="security" className="space-y-4 mt-0">
                    <Card className="gap-5 py-6">
                        <CardHeader className="px-6">
                            <CardTitle className="text-base font-semibold text-neutral-900">
                                เปลี่ยนรหัสผ่าน
                            </CardTitle>
                            <p className="text-xs text-neutral-500 mt-1">
                                {isEmailProvider
                                    ? 'ระบบจะตรวจสอบรหัสผ่านปัจจุบันก่อนเปลี่ยน'
                                    : `บัญชีนี้เข้าระบบด้วย ${profile?.provider ?? 'OAuth'} — ไม่มีรหัสผ่านในระบบ เปลี่ยนผ่านผู้ให้บริการแทน`}
                            </p>
                        </CardHeader>
                        <CardContent className="px-6 space-y-4 max-w-md">
                            <div className="space-y-2">
                                <Label htmlFor="cur-pwd">รหัสผ่านปัจจุบัน</Label>
                                <Input
                                    id="cur-pwd"
                                    type="password"
                                    value={curPwd}
                                    onChange={(e) => setCurPwd(e.target.value)}
                                    disabled={!isEmailProvider || savingPwd}
                                    autoComplete="current-password"
                                />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="new-pwd">รหัสผ่านใหม่</Label>
                                <Input
                                    id="new-pwd"
                                    type="password"
                                    value={newPwd}
                                    onChange={(e) => setNewPwd(e.target.value)}
                                    disabled={!isEmailProvider || savingPwd}
                                    autoComplete="new-password"
                                />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="confirm-pwd">ยืนยันรหัสผ่านใหม่</Label>
                                <Input
                                    id="confirm-pwd"
                                    type="password"
                                    value={confirmPwd}
                                    onChange={(e) => setConfirmPwd(e.target.value)}
                                    disabled={!isEmailProvider || savingPwd}
                                    autoComplete="new-password"
                                />
                            </div>

                            {pwdErr && (
                                <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                                    <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />
                                    <span>{pwdErr}</span>
                                </div>
                            )}
                            {pwdSavedAt && (
                                <div className="flex items-start gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
                                    <CheckCircle size={14} className="mt-0.5 flex-shrink-0" />
                                    <span>เปลี่ยนรหัสผ่านเรียบร้อย</span>
                                </div>
                            )}

                            <Button
                                type="button"
                                onClick={() => void handleChangePassword()}
                                disabled={
                                    savingPwd ||
                                    !isEmailProvider ||
                                    !curPwd ||
                                    !newPwd ||
                                    !confirmPwd
                                }
                                className="gap-2 bg-indigo-500 hover:bg-indigo-600"
                            >
                                {savingPwd ? (
                                    <Loader2 size={14} className="animate-spin" />
                                ) : (
                                    <Save size={14} />
                                )}
                                {savingPwd ? 'กำลังอัปเดต...' : 'อัปเดตรหัสผ่าน'}
                            </Button>
                        </CardContent>
                    </Card>

                    <Card className="gap-5 py-6">
                        <CardHeader className="px-6">
                            <CardTitle className="text-base font-semibold text-neutral-900">
                                Two-Factor Authentication
                            </CardTitle>
                            <p className="text-xs text-neutral-500 mt-1">
                                เพิ่มความปลอดภัยอีกขั้นด้วย authenticator app (Google Authenticator, Authy)
                            </p>
                        </CardHeader>
                        <CardContent className="px-6 flex items-center justify-between">
                            <div>
                                <div className="text-sm font-medium text-neutral-900">
                                    ยังไม่ได้เปิดใช้งาน
                                </div>
                                <div className="text-xs text-neutral-500 mt-0.5">
                                    Coming soon — ต้องใช้ Supabase MFA TOTP flow
                                </div>
                            </div>
                            <Button variant="outline" disabled>
                                เปิดใช้งาน 2FA
                            </Button>
                        </CardContent>
                    </Card>
                </TabsContent>

                {/* ── Workspace tab ───────────────────────────────────── */}
                <TabsContent value="workspace" className="space-y-4 mt-0">
                    <Card className="gap-5 py-6">
                        <CardHeader className="px-6">
                            <CardTitle className="text-base font-semibold text-neutral-900">
                                ข้อมูลธุรกิจ
                            </CardTitle>
                            <p className="text-xs text-neutral-500 mt-1">
                                ใช้ในใบเสนอราคา / ใบกำกับภาษี / footer
                            </p>
                        </CardHeader>
                        <CardContent className="px-6 space-y-4">
                            {orgLoading ? (
                                <div className="text-sm text-neutral-500 py-4 flex items-center gap-2">
                                    <Loader2 size={14} className="animate-spin" /> กำลังโหลด...
                                </div>
                            ) : (
                                <>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        <div className="space-y-2">
                                            <Label htmlFor="biz-name">ชื่อธุรกิจ</Label>
                                            <Input
                                                id="biz-name"
                                                value={orgForm.business_name}
                                                onChange={(e) =>
                                                    setOrgForm({
                                                        ...orgForm,
                                                        business_name: e.target.value,
                                                    })
                                                }
                                                disabled={savingOrg}
                                            />
                                        </div>
                                        <div className="space-y-2">
                                            <Label htmlFor="biz-tax">เลขประจำตัวผู้เสียภาษี</Label>
                                            <Input
                                                id="biz-tax"
                                                value={orgForm.tax_id}
                                                onChange={(e) =>
                                                    setOrgForm({ ...orgForm, tax_id: e.target.value })
                                                }
                                                placeholder="0-0000-00000-00-0"
                                                disabled={savingOrg}
                                            />
                                        </div>
                                        <div className="space-y-2 md:col-span-2">
                                            <Label htmlFor="biz-address">ที่อยู่</Label>
                                            <textarea
                                                id="biz-address"
                                                rows={2}
                                                value={orgForm.address}
                                                onChange={(e) =>
                                                    setOrgForm({ ...orgForm, address: e.target.value })
                                                }
                                                disabled={savingOrg}
                                                className="w-full rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 resize-y"
                                            />
                                        </div>
                                        <div className="space-y-2">
                                            <Label htmlFor="biz-phone">เบอร์โทรธุรกิจ</Label>
                                            <Input
                                                id="biz-phone"
                                                type="tel"
                                                value={orgForm.phone}
                                                onChange={(e) =>
                                                    setOrgForm({ ...orgForm, phone: e.target.value })
                                                }
                                                disabled={savingOrg}
                                            />
                                        </div>
                                        <div className="space-y-2">
                                            <Label htmlFor="biz-email">Email ติดต่อ</Label>
                                            <Input
                                                id="biz-email"
                                                type="email"
                                                value={orgForm.email}
                                                onChange={(e) =>
                                                    setOrgForm({ ...orgForm, email: e.target.value })
                                                }
                                                disabled={savingOrg}
                                            />
                                        </div>
                                        <div className="space-y-2 md:col-span-2">
                                            <Label htmlFor="biz-website">เว็บไซต์</Label>
                                            <Input
                                                id="biz-website"
                                                type="url"
                                                value={orgForm.website}
                                                onChange={(e) =>
                                                    setOrgForm({ ...orgForm, website: e.target.value })
                                                }
                                                placeholder="https://www.corebiz.online"
                                                disabled={savingOrg}
                                            />
                                        </div>
                                        <div className="space-y-2">
                                            <Label htmlFor="biz-tz">Timezone</Label>
                                            <Input
                                                id="biz-tz"
                                                value={`${orgSettings?.timezone ?? 'Asia/Bangkok'} (GMT+7)`}
                                                disabled
                                                className="bg-neutral-50"
                                            />
                                        </div>
                                        <div className="space-y-2">
                                            <Label htmlFor="biz-currency">สกุลเงิน</Label>
                                            <Input
                                                id="biz-currency"
                                                value={`${orgSettings?.currency ?? 'THB'} (฿)`}
                                                disabled
                                                className="bg-neutral-50"
                                            />
                                        </div>
                                    </div>

                                    {orgErr && (
                                        <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                                            <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />
                                            <span>{orgErr}</span>
                                        </div>
                                    )}

                                    <div className="flex items-center justify-end gap-3 pt-2">
                                        {orgSavedAt && !orgDirty && (
                                            <span className="inline-flex items-center gap-1 text-xs text-emerald-700">
                                                <CheckCircle size={12} />
                                                บันทึกเรียบร้อย
                                            </span>
                                        )}
                                        <Button
                                            type="button"
                                            onClick={() => void handleSaveOrg()}
                                            disabled={savingOrg || !orgDirty}
                                            className="gap-2 bg-indigo-500 hover:bg-indigo-600"
                                        >
                                            {savingOrg ? (
                                                <Loader2 size={14} className="animate-spin" />
                                            ) : (
                                                <Save size={14} />
                                            )}
                                            {savingOrg ? 'กำลังบันทึก...' : 'บันทึก'}
                                        </Button>
                                    </div>
                                </>
                            )}
                        </CardContent>
                    </Card>
                </TabsContent>
            </Tabs>
        </div>
    );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

/**
 * Controlled toggle row — parent owns the state. Used by the Notifications
 * tab so the toggle reflects the saved DB value and persists on flip.
 */
function BoundToggleRow({
    title,
    desc,
    enabled,
    onChange,
    disabled = false,
}: {
    title: string;
    desc: string;
    enabled: boolean;
    onChange: () => void;
    disabled?: boolean;
}) {
    return (
        <div className="flex items-center justify-between py-3 border-b border-neutral-100 last:border-0">
            <div className="min-w-0 pr-4">
                <div className="text-sm font-medium text-neutral-900">{title}</div>
                <div className="text-xs text-neutral-500 mt-0.5">{desc}</div>
            </div>
            <button
                type="button"
                onClick={onChange}
                disabled={disabled}
                className={cn(
                    'relative inline-flex h-5 w-9 items-center rounded-full transition-colors flex-shrink-0 disabled:opacity-60 disabled:cursor-not-allowed',
                    enabled ? 'bg-indigo-500' : 'bg-neutral-300',
                )}
                role="switch"
                aria-checked={enabled}
            >
                <span
                    className={cn(
                        'inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform',
                        enabled ? 'translate-x-4' : 'translate-x-0.5',
                    )}
                />
            </button>
        </div>
    );
}
