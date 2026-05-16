import { useState } from 'react';
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
} from 'lucide-react';
import { useAuth } from '../lib/AuthProvider';
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
    const { profile } = useAuth();
    const { language, setLanguage, t } = useLanguage();
    const [tab, setTab] = useState<'profile' | 'notifications' | 'security' | 'workspace'>(
        'profile',
    );

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
                                        defaultValue={profile?.full_name ?? ''}
                                        placeholder="กรอกชื่อ"
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
                                    <Input id="phone" type="tel" placeholder="08x-xxx-xxxx" />
                                </div>
                            </div>

                            <div className="flex justify-end pt-2">
                                <Button className="gap-2 bg-indigo-500 hover:bg-indigo-600">
                                    <Save size={14} /> บันทึก
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
                                เลือกประเภทการแจ้งเตือนที่ต้องการรับ
                            </p>
                        </CardHeader>
                        <CardContent className="px-6 space-y-1">
                            {[
                                {
                                    title: 'คำสั่งซื้อใหม่',
                                    desc: 'แจ้งเตือนเมื่อมีออเดอร์เข้ามา',
                                    enabled: true,
                                },
                                {
                                    title: 'สต็อกต่ำ',
                                    desc: 'แจ้งเตือนเมื่อสินค้าใกล้หมด',
                                    enabled: true,
                                },
                                {
                                    title: 'ลูกค้าใหม่',
                                    desc: 'แจ้งเตือนเมื่อมีลูกค้าลงทะเบียน',
                                    enabled: false,
                                },
                                {
                                    title: 'รายงานประจำสัปดาห์',
                                    desc: 'สรุปผลการดำเนินงานทุกวันจันทร์',
                                    enabled: true,
                                },
                            ].map((row, i) => (
                                <ToggleRow
                                    key={i}
                                    title={row.title}
                                    desc={row.desc}
                                    defaultEnabled={row.enabled}
                                />
                            ))}
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
                                ใช้ได้เฉพาะบัญชีที่ลงทะเบียนด้วย email/password
                            </p>
                        </CardHeader>
                        <CardContent className="px-6 space-y-4 max-w-md">
                            <div className="space-y-2">
                                <Label htmlFor="cur-pwd">รหัสผ่านปัจจุบัน</Label>
                                <Input id="cur-pwd" type="password" />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="new-pwd">รหัสผ่านใหม่</Label>
                                <Input id="new-pwd" type="password" />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="confirm-pwd">ยืนยันรหัสผ่านใหม่</Label>
                                <Input id="confirm-pwd" type="password" />
                            </div>
                            <Button className="gap-2 bg-indigo-500 hover:bg-indigo-600">
                                <Save size={14} /> อัปเดตรหัสผ่าน
                            </Button>
                        </CardContent>
                    </Card>

                    <Card className="gap-5 py-6">
                        <CardHeader className="px-6">
                            <CardTitle className="text-base font-semibold text-neutral-900">
                                Two-Factor Authentication
                            </CardTitle>
                            <p className="text-xs text-neutral-500 mt-1">
                                เพิ่มความปลอดภัยอีกขั้นด้วย authenticator app
                            </p>
                        </CardHeader>
                        <CardContent className="px-6 flex items-center justify-between">
                            <div>
                                <div className="text-sm font-medium text-neutral-900">
                                    ยังไม่ได้เปิดใช้งาน
                                </div>
                                <div className="text-xs text-neutral-500 mt-0.5">
                                    แนะนำสำหรับบัญชี admin
                                </div>
                            </div>
                            <Button variant="outline">เปิดใช้งาน 2FA</Button>
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
                        </CardHeader>
                        <CardContent className="px-6 space-y-4">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <Label htmlFor="biz-name">ชื่อธุรกิจ</Label>
                                    <Input
                                        id="biz-name"
                                        defaultValue="J NAC Thailand"
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="biz-tax">เลขประจำตัวผู้เสียภาษี</Label>
                                    <Input id="biz-tax" />
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="biz-tz">Timezone</Label>
                                    <Input
                                        id="biz-tz"
                                        defaultValue="Asia/Bangkok (GMT+7)"
                                        disabled
                                        className="bg-neutral-50"
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="biz-currency">สกุลเงิน</Label>
                                    <Input
                                        id="biz-currency"
                                        defaultValue="THB (฿)"
                                        disabled
                                        className="bg-neutral-50"
                                    />
                                </div>
                            </div>
                            <div className="flex justify-end pt-2">
                                <Button className="gap-2 bg-indigo-500 hover:bg-indigo-600">
                                    <Save size={14} /> บันทึก
                                </Button>
                            </div>
                        </CardContent>
                    </Card>
                </TabsContent>
            </Tabs>
        </div>
    );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function ToggleRow({
    title,
    desc,
    defaultEnabled,
}: {
    title: string;
    desc: string;
    defaultEnabled: boolean;
}) {
    const [enabled, setEnabled] = useState(defaultEnabled);
    return (
        <div className="flex items-center justify-between py-3 border-b border-neutral-100 last:border-0">
            <div className="min-w-0">
                <div className="text-sm font-medium text-neutral-900">{title}</div>
                <div className="text-xs text-neutral-500 mt-0.5">{desc}</div>
            </div>
            <button
                type="button"
                onClick={() => setEnabled((e) => !e)}
                className={cn(
                    'relative inline-flex h-5 w-9 items-center rounded-full transition-colors flex-shrink-0',
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
