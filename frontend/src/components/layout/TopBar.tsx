import React from 'react';
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

const TopBar: React.FC<TopBarProps> = ({ isMobile, onToggleSidebar, onOpenMobileMenu }) => {
    const { language, setLanguage, t } = useLanguage();
    const { profile } = useAuth();

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

                {!isMobile && (
                    <button className="header-icon-btn" title={t.layout.help}>
                        <CircleHelp size={18} />
                    </button>
                )}

                <button className="notification-btn" title={t.layout.notifications}>
                    <Bell size={18} />
                    <span className="notification-dot" aria-hidden="true"></span>
                </button>

                {/* Profile dropdown — shadcn DropdownMenu */}
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
                        <DropdownMenuItem className="gap-2.5 cursor-pointer">
                            <UserCircle size={16} />
                            {t.layout.adminWorkspace}
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
