import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export interface PageHeaderProps {
    title: string;
    subtitle?: string;
    /** Icon shown next to title */
    icon?: ReactNode;
    /** Right-aligned action buttons */
    actions?: ReactNode;
    /** Additional className for the wrapper */
    className?: string;
    /** Hide the accent border (default: shown) */
    noBorder?: boolean;
}

/**
 * Standard page header — title + subtitle + actions, with optional icon.
 *
 * @example
 *   <PageHeader
 *     title={t.marketing.title}
 *     subtitle={t.marketing.subtitle}
 *     icon={<Target size={20} />}
 *     actions={<Button onClick={...}>Create</Button>}
 *   />
 */
export default function PageHeader({
    title,
    subtitle,
    icon,
    actions,
    className,
    noBorder = false,
}: PageHeaderProps) {
    return (
        <header
            className={cn(
                'page-header flex flex-col md:flex-row md:items-center md:justify-between gap-4',
                noBorder && 'page-header--no-border',
                className,
            )}
        >
            <div className="flex items-start gap-3 min-w-0">
                {icon && (
                    <div className="page-header-icon grid place-items-center w-10 h-10 rounded-lg flex-shrink-0">
                        {icon}
                    </div>
                )}
                <div className="min-w-0">
                    <h1 className="text-2xl font-bold tracking-tight break-words">
                        {title}
                    </h1>
                    {subtitle && (
                        <p className="page-header-subtitle text-sm mt-1">{subtitle}</p>
                    )}
                </div>
            </div>
            {actions && (
                /* On mobile the actions row wraps below the title and takes
                   full width so search inputs / buttons don't get truncated.
                   From md up it pins right of the title like before. */
                <div className="page-header-actions flex flex-wrap items-center gap-2 w-full md:w-auto md:justify-end">
                    {actions}
                </div>
            )}
        </header>
    );
}
