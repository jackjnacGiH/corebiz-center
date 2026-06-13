import { ChevronDown, User, X } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import type { StaffProfile } from '../../lib/api';

interface Props {
  packers: StaffProfile[];
  selectedId: string | null | undefined;
  onChange: (id: string | null) => void;
  loading?: boolean;
}

const ROLE_BADGE: Record<StaffProfile['role'], string> = {
  owner: 'bg-purple-50 text-purple-700 border-purple-200',
  admin: 'bg-blue-50 text-blue-700 border-blue-200',
  staff: 'bg-slate-50 text-slate-700 border-slate-200',
};

// Avatar background + ring tint by role — conveys the role in the compact
// trigger without a text badge that would crowd out the name.
const ROLE_RING: Record<StaffProfile['role'], string> = {
  owner: 'bg-purple-500 ring-purple-200',
  admin: 'bg-blue-500 ring-blue-200',
  staff: 'bg-slate-500 ring-slate-200',
};

export default function PackerSelect({ packers, selectedId, onChange, loading }: Props) {
  const selected = packers.find((p) => p.id === selectedId);
  const displayName = (p: StaffProfile) => p.full_name?.trim() || p.email;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          disabled={loading}
          title={selected ? `${displayName(selected)} · ${selected.role}` : 'ยังไม่ได้กำหนดผู้รับผิดชอบ'}
          className="w-full flex items-center gap-2 h-9 px-2.5 rounded-md border border-neutral-200 bg-white text-sm hover:bg-neutral-50 transition justify-between disabled:opacity-50"
        >
          {selected ? (
            <span className="flex items-center gap-1.5 min-w-0">
              <span
                className={cn(
                  'grid place-items-center w-6 h-6 rounded-full text-white text-[10px] font-semibold flex-shrink-0 ring-2',
                  ROLE_RING[selected.role],
                )}
              >
                {displayName(selected).charAt(0).toUpperCase()}
              </span>
              <span className="truncate text-neutral-900">{displayName(selected)}</span>
            </span>
          ) : (
            <span className="flex items-center gap-1.5 text-neutral-400 text-xs">
              <User size={12} /> ยังไม่ได้กำหนด Packer
            </span>
          )}
          <ChevronDown size={13} className="text-neutral-400 flex-shrink-0" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-72 max-h-80 overflow-y-auto">
        <DropdownMenuLabel className="text-[10px] uppercase text-neutral-500">
          เลือก Packer
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {selected && (
          <>
            <DropdownMenuItem
              onClick={() => onChange(null)}
              className="text-red-600 text-xs gap-2"
            >
              <X size={12} /> ยกเลิกการกำหนด
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        )}
        {packers.map((p) => (
          <DropdownMenuItem
            key={p.id}
            onClick={() => onChange(p.id)}
            className={cn('text-sm gap-2 cursor-pointer', p.id === selectedId && 'bg-indigo-50')}
          >
            <span className="grid place-items-center w-7 h-7 rounded-full bg-gradient-to-br from-indigo-500 to-purple-500 text-white text-[11px] font-semibold flex-shrink-0">
              {displayName(p).charAt(0).toUpperCase()}
            </span>
            <span className="flex-1 min-w-0">
              <div className="truncate text-neutral-900">{displayName(p)}</div>
              <div className="truncate text-[10px] text-neutral-500">{p.email}</div>
            </span>
            <span
              className={cn(
                'text-[9px] uppercase font-bold px-1.5 py-0.5 rounded border flex-shrink-0',
                ROLE_BADGE[p.role],
              )}
            >
              {p.role}
            </span>
          </DropdownMenuItem>
        ))}
        {packers.length === 0 && (
          <div className="p-3 text-xs text-neutral-400 text-center">ไม่พบ staff</div>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
