import { useEffect, useRef, useState } from 'react';
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
    Key,
    Trash2,
    Eye,
    EyeOff,
    ExternalLink,
} from 'lucide-react';
import { useAuth } from '../lib/AuthProvider';
import { supabase, DEFAULT_NOTIFICATION_PREFS, type NotificationPrefs } from '../lib/supabase';
import { orgSettingsApi, apiSecretsApi, lineChannelsApi, type LineChannel } from '../lib/api';
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
    const [tab, setTab] = useState<
        'profile' | 'notifications' | 'security' | 'workspace' | 'integrations'
    >('profile');

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
                    <TabsTrigger value="integrations" className="gap-2">
                        <Key size={14} /> Integrations
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

                {/* ── Integrations tab — API keys ─────────────────────── */}
                <TabsContent value="integrations" className="space-y-4 mt-0">
                    <IntegrationsTab />
                </TabsContent>
            </Tabs>
        </div>
    );
}

// ─── Integrations tab ─────────────────────────────────────────────────────────
// API keys live in vault.secrets, written through the `set_api_secret` RPC.
// Values never come back to the browser in plain text — `previewSecret`
// returns a masked "AIza••••••••XYZW" string that's safe to display.

interface SecretSpec {
    /** Name as stored in vault.secrets — must match what the Edge Function reads. */
    name: string;
    /** Thai label shown in the UI. */
    label: string;
    /** One-line description of what the key is for. */
    desc: string;
    /** Where to get the key (link shown next to the field). */
    docs?: { url: string; label: string };
    /** Placeholder text inside the input. */
    placeholder?: string;
}

const SECRETS: SecretSpec[] = [
    {
        name: 'GEMINI_API_KEY',
        label: 'Google Gemini API Key',
        desc: 'LLM ที่ใช้ตอบลูกค้าใน Openclaw RAG (free tier 1,500 req/วัน)',
        docs: { url: 'https://aistudio.google.com/app/apikey', label: 'รับ Gemini key' },
        placeholder: 'AIza...',
    },
    {
        name: 'PHAYA_API_KEY',
        label: 'Phaya.io API Key (Embedding หลัก)',
        desc: 'Embedding ภาษาไทย — ใช้สำหรับ search ใน knowledge base',
        docs: { url: 'https://phaya.io', label: 'รับ Phaya key' },
        placeholder: 'phaya_...',
    },
    {
        name: 'OPENAI_API_KEY',
        label: 'OpenAI API Key (Embedding fallback)',
        desc: 'ใช้สำรองตอน Phaya หมด credit (text-embedding-3-small)',
        docs: { url: 'https://platform.openai.com/api-keys', label: 'รับ OpenAI key' },
        placeholder: 'sk-...',
    },
];

function IntegrationsTab() {
    return (
        <div className="space-y-4">
            <Card className="gap-5 py-6">
                <CardHeader className="px-6">
                    <CardTitle className="text-base font-semibold text-neutral-900">
                        API Keys
                    </CardTitle>
                    <p className="text-xs text-neutral-500 mt-1">
                        Key ทั้งหมดเก็บใน Supabase Vault (เข้ารหัส) — แสดงเป็นรูป
                        <code className="mx-1 px-1.5 py-0.5 bg-neutral-100 rounded text-[10px]">AIza••••••••XYZW</code>
                        เพื่อความปลอดภัย ไม่ส่งค่าเต็มกลับมาให้ฝั่ง browser
                    </p>
                </CardHeader>
                <CardContent className="px-6 space-y-4">
                    {SECRETS.map((s) => (
                        <SecretRow key={s.name} spec={s} />
                    ))}
                </CardContent>
            </Card>

            <LineChannelsCard />
        </div>
    );
}

// ─── LINE Channels card ──────────────────────────────────────────────────────
// Lets the admin add multiple LINE OA credentials (test + production) and
// toggle which one is active. The line-webhook Edge Function reads the
// active channel; admins can swap accounts without redeploying code.

function LineChannelsCard() {
    const [channels, setChannels] = useState<LineChannel[]>([]);
    const [loading, setLoading] = useState(true);
    const [err, setErr] = useState<string | null>(null);
    const [showForm, setShowForm] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);

    const webhookUrl = `${(import.meta.env.VITE_SUPABASE_URL as string) ?? ''}/functions/v1/line-webhook`;

    async function load() {
        setLoading(true);
        setErr(null);
        try {
            setChannels(await lineChannelsApi.list());
        } catch (e) {
            setErr((e as Error).message);
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => { void load(); }, []);

    async function handleActivate(id: string) {
        try { await lineChannelsApi.activate(id); await load(); }
        catch (e) { alert((e as Error).message); }
    }
    async function handleDeactivateAll() {
        if (!confirm('ปิดทุกช่อง LINE? Webhook จะหยุดทำงาน')) return;
        try { await lineChannelsApi.deactivateAll(); await load(); }
        catch (e) { alert((e as Error).message); }
    }
    async function handleDelete(id: string) {
        if (!confirm('ลบช่อง LINE นี้?')) return;
        try { await lineChannelsApi.remove(id); await load(); }
        catch (e) { alert((e as Error).message); }
    }

    return (
        <Card className="gap-5 py-6">
            <CardHeader className="px-6">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div>
                        <CardTitle className="text-base font-semibold text-neutral-900">
                            LINE Channels
                        </CardTitle>
                        <p className="text-xs text-neutral-500 mt-1">
                            ตั้งค่า LINE Official Account สำหรับรับ-ส่งข้อความผ่าน Inbox
                            (เปิดได้ทีละ 1 ช่อง — สลับระหว่าง test และ production ได้ทันที)
                        </p>
                    </div>
                    <Button
                        size="sm"
                        onClick={() => { setEditingId(null); setShowForm(true); }}
                        className="gap-2 bg-indigo-600 hover:bg-indigo-700"
                    >
                        <Key size={13} /> เพิ่ม Channel
                    </Button>
                </div>
            </CardHeader>
            <CardContent className="px-6 space-y-4">
                {/* Webhook URL — paste into LINE Developers Console */}
                <WebhookUrlBox url={webhookUrl} />
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs text-amber-800">
                    ขั้นตอน: LINE Developers Console → Channel → Messaging API → Webhook URL → paste แล้วเปิด <b>Use webhook</b>
                </div>

                {err && (
                    <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded p-2">
                        <AlertTriangle size={12} className="inline mr-1" /> {err}
                    </div>
                )}
                {loading && (
                    <div className="text-xs text-neutral-500 text-center py-4">
                        <Loader2 size={14} className="inline animate-spin mr-1" /> โหลด...
                    </div>
                )}
                {!loading && channels.length === 0 && !showForm && (
                    <div className="text-xs text-neutral-400 text-center py-8 border border-dashed border-neutral-200 rounded-lg">
                        ยังไม่มี LINE Channel — คลิก "เพิ่ม Channel" ด้านบนเพื่อเริ่มต้น
                    </div>
                )}

                {channels.map((c) => (
                    <LineChannelRow
                        key={c.id}
                        channel={c}
                        editing={editingId === c.id}
                        onStartEdit={() => { setEditingId(c.id); setShowForm(false); }}
                        onCancelEdit={() => setEditingId(null)}
                        onSaved={async () => { setEditingId(null); await load(); }}
                        onActivate={() => handleActivate(c.id)}
                        onDelete={() => handleDelete(c.id)}
                    />
                ))}

                {showForm && (
                    <LineChannelForm
                        onSaved={async () => { setShowForm(false); await load(); }}
                        onCancel={() => setShowForm(false)}
                    />
                )}

                {channels.some((c) => c.is_active) && (
                    <div className="pt-2 text-right">
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={handleDeactivateAll}
                            className="text-xs h-7 text-neutral-500"
                        >
                            ปิดทุกช่อง (หยุด webhook ทั้งหมด)
                        </Button>
                    </div>
                )}
            </CardContent>
        </Card>
    );
}

/**
 * Webhook URL display with a reliable copy button:
 *   - Read-only input so a tap selects all text (mobile-friendly)
 *   - Copy button uses navigator.clipboard with a document.execCommand
 *     fallback for browsers/contexts where the async API is blocked
 *     (older iOS Safari, http-only embeds, etc.)
 *   - Visual feedback: button label flips to "คัดลอกแล้ว ✓" for 1.5s
 */
function WebhookUrlBox({ url }: { url: string }) {
    const [copied, setCopied] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);

    async function handleCopy() {
        let ok = false;
        try {
            if (navigator.clipboard?.writeText) {
                await navigator.clipboard.writeText(url);
                ok = true;
            }
        } catch {
            // fall through to legacy fallback
        }
        if (!ok && inputRef.current) {
            // Fallback for older browsers / non-secure contexts
            inputRef.current.focus();
            inputRef.current.select();
            try { ok = document.execCommand('copy'); } catch { ok = false; }
        }
        if (ok) {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
        } else {
            alert('คัดลอกอัตโนมัติไม่สำเร็จ — กรุณาเลือก URL ในช่องแล้วกด Ctrl+C');
        }
    }

    return (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs space-y-2">
            <div className="font-semibold text-amber-900 flex items-center gap-1.5">
                <ExternalLink size={12} /> Webhook URL — ใส่ใน LINE Developers Console
            </div>
            <div className="flex gap-2 items-center">
                <input
                    ref={inputRef}
                    readOnly
                    value={url}
                    onFocus={(e) => e.currentTarget.select()}
                    onClick={(e) => e.currentTarget.select()}
                    className="flex-1 text-[11px] font-mono bg-white border border-amber-200 rounded px-2 py-1.5 break-all outline-none focus:border-amber-400 focus:ring-1 focus:ring-amber-200 cursor-text"
                />
                <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={handleCopy}
                    className={cn(
                        'text-xs h-7 min-w-[90px] transition',
                        copied && 'bg-emerald-50 border-emerald-300 text-emerald-700',
                    )}
                >
                    {copied ? '✓ คัดลอกแล้ว' : 'คัดลอก'}
                </Button>
            </div>
        </div>
    );
}

function LineChannelRow({
    channel, editing, onStartEdit, onCancelEdit, onSaved, onActivate, onDelete,
}: {
    channel: LineChannel;
    editing: boolean;
    onStartEdit: () => void;
    onCancelEdit: () => void;
    onSaved: () => Promise<void> | void;
    onActivate: () => void;
    onDelete: () => void;
}) {
    if (editing) {
        return (
            <LineChannelForm
                channel={channel}
                onSaved={onSaved}
                onCancel={onCancelEdit}
            />
        );
    }
    return (
        <div className={cn(
            'rounded-lg border p-4 flex items-start gap-3',
            channel.is_active
                ? 'border-emerald-300 bg-emerald-50/50'
                : 'border-neutral-200 bg-white',
        )}>
            <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <div className="font-semibold text-neutral-900 text-sm">{channel.name}</div>
                    {channel.is_active && (
                        <span className="inline-flex items-center gap-1 text-[9px] font-bold uppercase px-1.5 py-0.5 rounded bg-emerald-500 text-white">
                            <CheckCircle size={9} /> ACTIVE
                        </span>
                    )}
                    {channel.channel_id && (
                        <span className="text-[10px] font-mono text-neutral-500">
                            ID: {channel.channel_id}
                        </span>
                    )}
                </div>
                <div className="text-[11px] text-neutral-500 font-mono">
                    Token: {channel.channel_access_token.slice(0, 8)}••••{channel.channel_access_token.slice(-4)}
                </div>
                {channel.notes && (
                    <div className="text-xs text-neutral-600 mt-1">{channel.notes}</div>
                )}
            </div>
            <div className="flex gap-1 flex-shrink-0">
                {!channel.is_active && (
                    <Button size="sm" onClick={onActivate} className="bg-emerald-600 hover:bg-emerald-700 h-8 text-xs">
                        ใช้ channel นี้
                    </Button>
                )}
                <Button size="sm" variant="outline" onClick={onStartEdit} className="h-8 text-xs">แก้</Button>
                <Button size="sm" variant="outline" onClick={onDelete} className="h-8 text-xs text-red-600 hover:bg-red-50">
                    <Trash2 size={12} />
                </Button>
            </div>
        </div>
    );
}

function LineChannelForm({
    channel, onSaved, onCancel,
}: {
    channel?: LineChannel;
    onSaved: () => Promise<void> | void;
    onCancel: () => void;
}) {
    const isEdit = !!channel;
    const [name, setName] = useState(channel?.name ?? '');
    const [channelId, setChannelId] = useState(channel?.channel_id ?? '');
    const [accessToken, setAccessToken] = useState(channel?.channel_access_token ?? '');
    const [secret, setSecret] = useState(channel?.channel_secret ?? '');
    const [notes, setNotes] = useState(channel?.notes ?? '');
    const [showSecrets, setShowSecrets] = useState(false);
    const [testing, setTesting] = useState(false);
    const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null);
    const [saving, setSaving] = useState(false);
    const [err, setErr] = useState<string | null>(null);

    async function handleTest() {
        if (!accessToken.trim()) {
            setTestResult({ ok: false, msg: 'กรุณาใส่ Channel Access Token ก่อน' });
            return;
        }
        setTesting(true);
        setTestResult(null);
        try {
            const r = await lineChannelsApi.testConnection(accessToken.trim());
            if (r.ok) {
                const info = r.info ?? {};
                setTestResult({
                    ok: true,
                    msg: `เชื่อมต่อสำเร็จ — ${(info.displayName as string) ?? '?'}${info.userId ? ` (${(info.userId as string).slice(0, 12)}...)` : ''}`,
                });
            } else {
                setTestResult({ ok: false, msg: r.error ?? 'ไม่ทราบสาเหตุ' });
            }
        } finally {
            setTesting(false);
        }
    }

    async function handleSave() {
        if (!name.trim() || !accessToken.trim() || !secret.trim()) {
            setErr('กรุณากรอกชื่อ + Channel Access Token + Channel Secret');
            return;
        }
        setSaving(true);
        setErr(null);
        try {
            if (isEdit && channel) {
                await lineChannelsApi.update(channel.id, {
                    name: name.trim(),
                    channel_id: channelId.trim() || null,
                    channel_access_token: accessToken.trim(),
                    channel_secret: secret.trim(),
                    notes: notes.trim() || null,
                });
            } else {
                await lineChannelsApi.create({
                    name: name.trim(),
                    channel_id: channelId.trim() || undefined,
                    channel_access_token: accessToken.trim(),
                    channel_secret: secret.trim(),
                    notes: notes.trim() || undefined,
                });
            }
            await onSaved();
        } catch (e) {
            setErr((e as Error).message);
        } finally {
            setSaving(false);
        }
    }

    return (
        <div className="rounded-lg border-2 border-indigo-300 bg-indigo-50/30 p-4 space-y-3">
            <div className="text-xs font-semibold text-indigo-900">
                {isEdit ? 'แก้ไข Channel' : 'เพิ่ม LINE Channel ใหม่'}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                    <Label className="text-[10px] font-semibold uppercase text-neutral-700">ชื่อ Channel *</Label>
                    <Input
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="เช่น JNAC Test, JNAC Official"
                        className="h-8 text-sm"
                    />
                </div>
                <div>
                    <Label className="text-[10px] font-semibold uppercase text-neutral-700">Channel ID (ไม่บังคับ)</Label>
                    <Input
                        value={channelId}
                        onChange={(e) => setChannelId(e.target.value)}
                        placeholder="2007xxxxx"
                        className="h-8 text-sm font-mono"
                    />
                </div>
            </div>
            <div>
                <div className="flex items-center justify-between mb-1">
                    <Label className="text-[10px] font-semibold uppercase text-neutral-700">Channel Access Token (long-lived) *</Label>
                    <button
                        type="button"
                        onClick={() => setShowSecrets(!showSecrets)}
                        className="text-[10px] text-neutral-500 hover:text-neutral-900 flex items-center gap-1"
                    >
                        {showSecrets ? <EyeOff size={11} /> : <Eye size={11} />}
                        {showSecrets ? 'ซ่อน' : 'แสดง'}
                    </button>
                </div>
                <Input
                    type={showSecrets ? 'text' : 'password'}
                    value={accessToken}
                    onChange={(e) => setAccessToken(e.target.value)}
                    placeholder="เริ่มต้นด้วย Bearer token ยาว ๆ"
                    className="h-8 text-sm font-mono"
                />
            </div>
            <div>
                <Label className="text-[10px] font-semibold uppercase text-neutral-700">Channel Secret *</Label>
                <Input
                    type={showSecrets ? 'text' : 'password'}
                    value={secret}
                    onChange={(e) => setSecret(e.target.value)}
                    placeholder="32 ตัวอักษร hex"
                    className="h-8 text-sm font-mono"
                />
            </div>
            <div>
                <Label className="text-[10px] font-semibold uppercase text-neutral-700">โน้ต (ไม่บังคับ)</Label>
                <Input
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="เช่น สำหรับทดสอบ — ลบหลังเปลี่ยนเป็น production"
                    className="h-8 text-sm"
                />
            </div>

            {testResult && (
                <div className={cn(
                    'text-xs rounded p-2 border flex items-start gap-2',
                    testResult.ok
                        ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                        : 'bg-red-50 border-red-200 text-red-700',
                )}>
                    {testResult.ok
                        ? <CheckCircle size={12} className="mt-0.5 flex-shrink-0" />
                        : <AlertTriangle size={12} className="mt-0.5 flex-shrink-0" />
                    }
                    {testResult.msg}
                </div>
            )}
            {err && (
                <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded p-2">
                    <AlertTriangle size={12} className="inline mr-1" /> {err}
                </div>
            )}

            <div className="flex gap-2 pt-1">
                <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleTest}
                    disabled={testing}
                    className="h-8 text-xs gap-1.5"
                >
                    {testing ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle size={12} />}
                    ทดสอบเชื่อมต่อ
                </Button>
                <div className="flex-1" />
                <Button type="button" variant="outline" size="sm" onClick={onCancel} className="h-8 text-xs">
                    ยกเลิก
                </Button>
                <Button
                    type="button"
                    size="sm"
                    onClick={handleSave}
                    disabled={saving}
                    className="h-8 text-xs gap-1.5 bg-indigo-600 hover:bg-indigo-700"
                >
                    {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
                    {isEdit ? 'บันทึก' : 'เพิ่ม'}
                </Button>
            </div>
        </div>
    );
}

function SecretRow({ spec }: { spec: SecretSpec }) {
    const [preview, setPreview] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState('');
    const [showDraft, setShowDraft] = useState(false);
    const [saving, setSaving] = useState(false);
    const [removing, setRemoving] = useState(false);
    const [err, setErr] = useState<string | null>(null);
    const [savedAt, setSavedAt] = useState<number | null>(null);

    async function load() {
        setLoading(true);
        setErr(null);
        try {
            setPreview(await apiSecretsApi.previewSecret(spec.name));
        } catch (e) {
            setErr((e as Error).message);
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => {
        void load();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    async function handleSave() {
        if (!draft.trim()) {
            setErr('ต้องใส่ค่า key');
            return;
        }
        setSaving(true);
        setErr(null);
        try {
            await apiSecretsApi.setSecret(spec.name, draft.trim());
            setDraft('');
            setShowDraft(false);
            setEditing(false);
            setSavedAt(Date.now());
            await load();
            // Hide the saved indicator after a few seconds
            window.setTimeout(() => setSavedAt(null), 3000);
        } catch (e) {
            setErr((e as Error).message);
        } finally {
            setSaving(false);
        }
    }

    async function handleRemove() {
        if (!window.confirm(`ลบ ${spec.label} ออกจาก vault ใช่ไหม?`)) return;
        setRemoving(true);
        setErr(null);
        try {
            await apiSecretsApi.removeSecret(spec.name);
            await load();
        } catch (e) {
            setErr((e as Error).message);
        } finally {
            setRemoving(false);
        }
    }

    const hasValue = preview !== null;

    return (
        <div className="rounded-lg border border-neutral-200 bg-white p-4 space-y-3">
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                        <Label className="text-sm font-semibold text-neutral-900">
                            {spec.label}
                        </Label>
                        {hasValue ? (
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-700 border border-emerald-200">
                                <CheckCircle size={9} /> Active
                            </span>
                        ) : (
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-neutral-100 text-neutral-600 border border-neutral-200">
                                Not set
                            </span>
                        )}
                    </div>
                    <p className="text-xs text-neutral-500 mt-1">{spec.desc}</p>
                </div>
                {spec.docs && (
                    <a
                        href={spec.docs.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-indigo-600 hover:underline inline-flex items-center gap-1 flex-shrink-0 mt-0.5"
                    >
                        {spec.docs.label}
                        <ExternalLink size={11} />
                    </a>
                )}
            </div>

            {/* Display */}
            {!editing && (
                <div className="flex items-center gap-2">
                    <code className="flex-1 bg-neutral-50 border border-neutral-200 rounded px-3 py-2 text-sm font-mono text-neutral-700 tabular-nums">
                        {loading ? '...' : (preview ?? '— ยังไม่ได้ตั้งค่า —')}
                    </code>
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => {
                            setEditing(true);
                            setDraft('');
                            setShowDraft(false);
                        }}
                    >
                        {hasValue ? 'แก้ไข' : 'ตั้งค่า'}
                    </Button>
                    {hasValue && (
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => void handleRemove()}
                            disabled={removing}
                            className="border-red-200 text-red-700 hover:bg-red-50"
                            title="ลบ key ออกจาก vault"
                        >
                            {removing ? (
                                <Loader2 size={13} className="animate-spin" />
                            ) : (
                                <Trash2 size={13} />
                            )}
                        </Button>
                    )}
                </div>
            )}

            {/* Edit */}
            {editing && (
                <div className="space-y-2">
                    <div className="relative">
                        <Input
                            type={showDraft ? 'text' : 'password'}
                            placeholder={spec.placeholder ?? 'paste API key ที่นี่...'}
                            value={draft}
                            onChange={(e) => setDraft(e.target.value)}
                            autoFocus
                            className="pr-10 font-mono"
                        />
                        <button
                            type="button"
                            onClick={() => setShowDraft((v) => !v)}
                            className="absolute right-2 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-neutral-600"
                            title={showDraft ? 'ซ่อน key' : 'แสดง key'}
                        >
                            {showDraft ? <EyeOff size={14} /> : <Eye size={14} />}
                        </button>
                    </div>
                    <div className="flex items-center gap-2">
                        <Button
                            type="button"
                            size="sm"
                            onClick={() => void handleSave()}
                            disabled={saving || !draft.trim()}
                            className="gap-1.5 bg-indigo-500 hover:bg-indigo-600"
                        >
                            {saving ? (
                                <Loader2 size={13} className="animate-spin" />
                            ) : (
                                <Save size={13} />
                            )}
                            บันทึก
                        </Button>
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => {
                                setEditing(false);
                                setDraft('');
                                setErr(null);
                            }}
                            disabled={saving}
                        >
                            ยกเลิก
                        </Button>
                    </div>
                </div>
            )}

            {err && (
                <p className="text-xs text-red-700 flex items-center gap-1">
                    <AlertTriangle size={11} /> {err}
                </p>
            )}
            {savedAt && (
                <p className="text-xs text-emerald-700 flex items-center gap-1">
                    <CheckCircle size={11} /> บันทึกแล้ว
                </p>
            )}
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
