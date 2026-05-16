import React from 'react';
import { useNavigate } from 'react-router-dom';
import {
    Bell,
    Search,
    CircleHelp,
    Command,
    LogOut,
    UserCircle,
    PanelLeft,
    Menu,
    ChevronDown,
    Settings,
    Keyboard,
    BookOpen,
    LifeBuoy,
    Info,
    ShoppingBag,
    UserPlus,
    Boxes,
    Activity,
} from 'lucide-react';
import { useLanguage, type Language } from '../../i18n';
import { useAuth } from '../../lib/AuthProvider';
import { signOut } from '../../lib/auth';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

export interface TopBarProps {
    isMobile: boolean;
    onToggleSidebar: () => void;   // desktop: collapse/expand
    onOpenMobileMenu: () => void;  // mobile: open Sheet drawer
}

// ─── Mock notification data ─────────────────────────────────────────────
// TODO: replace with real-time hook off a `notifications` table once the
// schema is wired up.
interface NotificationItem {
    id: string;
    type: 'order' | 'customer' | 'inventory' | 'system';
    title: string;
    body: string;
    elapsed: string;
    unread: boolean;
}

const NOTIFICATION_STYLE: Record<
    NotificationItem['type'],
    { icon: React.ComponentType<{ size?: number }>; iconBg: string; iconFg: string }
> = {
    order:     { icon: ShoppingBag, iconBg: 'bg-indigo-50',  iconFg: 'text-indigo-600' },
    customer:  { icon: UserPlus,    iconBg: 'bg-emerald-50', iconFg: 'text-emerald-600' },
    inventory: { icon: Boxes,       iconBg: 'bg-amber-50',   iconFg: 'text-amber-700' },
    system:    { icon: Activity,    iconBg: 'bg-neutral-100', iconFg: 'text-neutral-600' },
};

const MOCK_NOTIFICATIONS: NotificationItem[] = [
    {
        id: 'n1',
        type: 'order',
        title: 'คำสั่งซื้อใหม่',
        body: 'ORD-2026-0005 จากลูกค้า บจก. ก่อสร้างไทย — ฿4,500',
        elapsed: '2 นาทีที่แล้ว',
        unread: true,
    },
    {
        id: 'n2',
        type: 'inventory',
        title: 'สต็อกต่ำ',
        body: 'ใบเจียรเหล็ก 4" หนา 6mm (GRN-001) เหลือ 0 ชิ้น',
        elapsed: '15 นาทีที่แล้ว',
        unread: true,
    },
    {
        id: 'n3',
        type: 'customer',
        title: 'ลูกค้าใหม่',
        body: 'บริษัท เจริญการช่าง จำกัด ลงทะเบียน VIP tier',
        elapsed: '1 ชั่วโมงที่แล้ว',
        unread: true,
    },
    {
        id: 'n4',
        type: 'system',
        title: 'Backup เสร็จสิ้น',
        body: 'Daily backup ของ Supabase ทำงานสำเร็จ',
        elapsed: '3 ชั่วโมงที่แล้ว',
        unread: false,
    },
];

// ─── TopBar ─────────────────────────────────────────────────────────────

const TopBar: React.FC<TopBarProps> = ({ isMobile, onToggleSidebar, onOpenMobileMenu }) => {
    const { language, setLanguage, t } = useLanguage();
    const { profile } = useAuth();
    const navigate = useNavigate();

    const initials = profile?.full_name
        ? profile.full_name
              .split(' ')
              .map((p) => p[0])
              .slice(0, 2)
              .join('')
              .toUpperCase()
        : profile?.email?.slice(0, 2).toUpperCase() ?? '??';

    const displayName = profile?.full_name ?? profile?.email ?? 'User';
    const roleLabel = profile?.role
        ? profile.role.charAt(0).toUpperCase() + profile.role.slice(1)
        : t.layout.adminWorkspace;

    const languageOptions: { value: Language; label: string }[] = [
        { value: 'th', label: t.common.thai },
        { value: 'en', label: t.common.english },
    ];

    const unreadCount = MOCK_NOTIFICATIONS.filter((n) => n.unread).length;

    return (
        <header className="header">
            {/* Left: toggle + search */}
            <div className="flex items-center gap-3 min-w-0 flex-1">
                <button
                    type="button"
                    onClick={isMobile ? onOpenMobileMenu : onToggleSidebar}
                    className="header-icon-btn flex-shrink-0"
                    title={
                        isMobile
                            ? t.layout.systemSettings
                            : `${t.layout.systemSettings} (Ctrl+B)`
                    }
                    aria-label="Toggle navigation"
                >
                    {isMobile ? <Menu size={18} /> : <PanelLeft size={18} />}
                </button>

                <div className="header-search-container">
                    <Search size={16} />
                    <input
                        type="text"
                        placeholder={t.layout.searchPlaceholder}
                        className="header-search-input"
                    />
                    {!isMobile && (
                        <span className="search-shortcut">
                            <Command size={12} /> K
                        </span>
                    )}
                </div>
            </div>

            {/* Right: language, help, notifications, profile */}
            <div className="header-actions">
                {!isMobile && (
                    <div
                        className="language-switch"
                        role="group"
                        aria-label={t.common.languageLabel}
                    >
                        {languageOptions.map((option) => (
                            <button
                                key={option.value}
                                type="button"
                                className={language === option.value ? 'active' : ''}
                                aria-pressed={language === option.value}
                                onClick={() => setLanguage(option.value)}
                            >
                                {option.label}
                            </button>
                        ))}
                    </div>
                )}

                {/* Help dropdown */}
                {!isMobile && (
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <button
                                type="button"
                                className="header-icon-btn"
                                title={t.layout.help}
                            >
                                <CircleHelp size={18} />
                            </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" sideOffset={8} className="w-60">
                            <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-neutral-400 font-medium px-3">
                                {t.layout.help}
                            </DropdownMenuLabel>
                            <DropdownMenuItem className="gap-2.5 cursor-pointer">
                                <Keyboard size={15} />
                                <div className="flex-1">
                                    <div className="text-sm">คีย์ลัด</div>
                                    <div className="text-[11px] text-neutral-500">
                                        Ctrl+B, Ctrl+K
                                    </div>
                                </div>
                            </DropdownMenuItem>
                            <DropdownMenuItem className="gap-2.5 cursor-pointer">
                                <BookOpen size={15} />
                                เอกสารคู่มือ
                            </DropdownMenuItem>
                            <DropdownMenuItem className="gap-2.5 cursor-pointer">
                                <LifeBuoy size={15} />
                                ติดต่อ Support
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem className="gap-2.5 cursor-pointer">
                                <Info size={15} />
                                <div className="flex-1">
                                    <div className="text-sm">เกี่ยวกับ</div>
                                    <div className="text-[11px] text-neutral-500">
                                        CoreBiz Center v1.0
                                    </div>
                                </div>
                            </DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>
                )}

                {/* Notification panel */}
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <button
                            type="button"
                            className="notification-btn"
                            title={t.layout.notifications}
                        >
                            <Bell size={18} />
                            {unreadCount > 0 && (
                                <span className="notification-dot" aria-hidden="true"></span>
                            )}
                        </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent
                        align="end"
                        sideOffset={8}
                        className="w-[360px] max-w-[calc(100vw-2rem)] p-0"
                    >
                        <div className="flex items-center justify-between px-4 py-3 border-b border-neutral-200">
                            <div>
                                <div className="text-sm font-semibold text-neutral-900">
                                    {t.layout.notifications}
                                </div>
                                {unreadCount > 0 && (
                                    <div className="text-[11px] text-neutral-500 mt-0.5">
                                        {unreadCount} ใหม่
                                    </div>
                                )}
                            </div>
                            <button
                                type="button"
                                className="text-[11px] text-indigo-600 hover:text-indigo-700 font-semibold"
                            >
                                ทำเครื่องหมายว่าอ่านแล้วทั้งหมด
                            </button>
                        </div>
                        <div className="max-h-[400px] overflow-y-auto">
                            {MOCK_NOTIFICATIONS.length === 0 ? (
                                <div className="px-4 py-8 text-center text-sm text-neutral-500">
                                    ไม่มีการแจ้งเตือนใหม่
                                </div>
                            ) : (
                                MOCK_NOTIFICATIONS.map((n) => {
                                    const { icon: Icon, iconBg, iconFg } = NOTIFICATION_STYLE[n.type];
                                    return (
                                        <button
                                            key={n.id}
                                            type="button"
                                            className={cn(
                                                'w-full text-left flex gap-3 px-4 py-3 border-b border-neutral-100 last:border-0 hover:bg-neutral-50 transition',
                                                n.unread && 'bg-indigo-50/30',
                                            )}
                                        >
                                            <div
                                                className={cn(
                                                    'w-9 h-9 rounded-lg grid place-items-center flex-shrink-0',
                                                    iconBg,
                                                    iconFg,
                                                )}
                                            >
                                                <Icon size={14} />
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-center gap-2">
                                                    <span className="text-sm font-semibold text-neutral-900 truncate">
                                                        {n.title}
                                                    </span>
                                                    {n.unread && (
                                                        <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 flex-shrink-0" />
                                                    )}
                                                </div>
                                                <div className="text-xs text-neutral-600 mt-0.5 leading-snug line-clamp-2">
                                                    {n.body}
                                                </div>
                                                <div className="text-[10px] text-neutral-400 mt-1 tabular-nums">
                                                    {n.elapsed}
                                                </div>
                                            </div>
                                        </button>
                                    );
                                })
                            )}
                        </div>
                        <div className="px-4 py-2.5 border-t border-neutral-200 text-center">
                            <button
                                type="button"
                                className="text-xs font-semibold text-indigo-600 hover:text-indigo-700"
                            >
                                ดูทั้งหมด →
                            </button>
                        </div>
                    </DropdownMenuContent>
                </DropdownMenu>

                {/* Profile dropdown */}
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <button
                            type="button"
                            className="user-profile-trigger"
                            aria-label={displayName}
                        >
                            {profile?.avatar_url ? (
                                <img
                                    src={profile.avatar_url}
                                    alt={displayName}
                                    className="user-avatar object-cover"
                                />
                            ) : (
                                <div className="user-avatar">{initials}</div>
                            )}
                            {!isMobile && (
                                <>
                                    <div className="min-w-0 text-left">
                                        <div className="user-info-name truncate">{displayName}</div>
                                        <div className="user-info-role truncate">{roleLabel}</div>
                                    </div>
                                    <ChevronDown size={14} className="profile-chevron" />
                                </>
                            )}
                        </button>
                    </DropdownMenuTrigger>

                    <DropdownMenuContent align="end" sideOffset={8} className="w-64">
                        <DropdownMenuLabel className="flex flex-col gap-0.5 p-3">
                            <span className="text-sm font-semibold text-neutral-900 truncate">
                                {displayName}
                            </span>
                            {profile?.email && (
                                <span className="text-xs font-normal text-neutral-500 truncate">
                                    {profile.email}
                                </span>
                            )}
                            {profile?.provider && (
                                <span className="text-[10px] font-medium uppercase tracking-wider text-neutral-400 mt-1">
                                    via {profile.provider}
                                </span>
                            )}
                        </DropdownMenuLabel>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                            className="gap-2.5 cursor-pointer"
                            onSelect={() => navigate('/settings')}
                        >
                            <UserCircle size={16} />
                            {t.layout.adminWorkspace}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                            className="gap-2.5 cursor-pointer"
                            onSelect={() => navigate('/settings')}
                        >
                            <Settings size={16} />
                            {t.layout.systemSettings}
                        </DropdownMenuItem>
                        {/* Mobile-only language switch — duplicated as menu items */}
                        {isMobile && (
                            <>
                                <DropdownMenuSeparator />
                                <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-neutral-400 font-medium">
                                    {t.common.languageLabel}
                                </DropdownMenuLabel>
                                {languageOptions.map((option) => (
                                    <DropdownMenuItem
                                        key={option.value}
                                        onSelect={() => setLanguage(option.value)}
                                        className={cn(
                                            'gap-2.5 cursor-pointer',
                                            language === option.value &&
                                                'font-semibold text-indigo-700',
                                        )}
                                    >
                                        {option.label}
                                    </DropdownMenuItem>
                                ))}
                            </>
                        )}
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                            variant="destructive"
                            className="gap-2.5 cursor-pointer"
                            onSelect={() => signOut()}
                        >
                            <LogOut size={16} />
                            {t.layout.signOut}
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
            </div>
        </header>
    );
};

export default TopBar;
