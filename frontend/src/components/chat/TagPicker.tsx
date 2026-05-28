import { useState } from 'react';
import { Plus } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { MANUAL_CUSTOMER_TYPE_TAGS, MANUAL_STATUS_TAGS, tagPalette } from '../../utils/chatAutoTags';

interface Props {
  existing: string[];
  onAdd: (tag: string) => void;
}

export default function TagPicker({ existing, onAdd }: Props) {
  const [custom, setCustom] = useState('');
  const [open, setOpen] = useState(false);

  const handleAddPreset = (t: string) => {
    onAdd(t);
    setOpen(false);
  };

  const handleAddCustom = () => {
    const v = custom.trim();
    if (v && !existing.includes(v)) {
      onAdd(v);
      setCustom('');
      setOpen(false);
    }
  };

  const customerType = MANUAL_CUSTOMER_TYPE_TAGS.filter((t) => !existing.includes(t));
  const status = MANUAL_STATUS_TAGS.filter((t) => !existing.includes(t));

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border border-dashed border-neutral-300 text-[10px] text-neutral-500 hover:bg-neutral-50 transition"
        >
          <Plus size={10} /> เพิ่มแท็ก
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64 p-2">
        <DropdownMenuLabel className="text-[10px] uppercase text-neutral-500 px-1 py-1">
          ประเภทลูกค้า
        </DropdownMenuLabel>
        <div className="flex flex-wrap gap-1 px-1 pb-2">
          {customerType.length === 0 && (
            <span className="text-[10px] text-neutral-400">เพิ่มครบแล้ว</span>
          )}
          {customerType.map((t) => {
            const p = tagPalette(t);
            return (
              <button
                key={t}
                type="button"
                onClick={() => handleAddPreset(t)}
                className={cn(
                  'px-2 py-0.5 rounded-full border text-[10px]',
                  p.bg,
                  p.text,
                  p.border,
                  'hover:opacity-80',
                )}
              >
                {t}
              </button>
            );
          })}
        </div>

        <DropdownMenuSeparator />

        <DropdownMenuLabel className="text-[10px] uppercase text-neutral-500 px-1 py-1">
          สถานะ
        </DropdownMenuLabel>
        <div className="flex flex-wrap gap-1 px-1 pb-2">
          {status.length === 0 && (
            <span className="text-[10px] text-neutral-400">เพิ่มครบแล้ว</span>
          )}
          {status.map((t) => {
            const p = tagPalette(t);
            return (
              <button
                key={t}
                type="button"
                onClick={() => handleAddPreset(t)}
                className={cn(
                  'px-2 py-0.5 rounded-full border text-[10px]',
                  p.bg,
                  p.text,
                  p.border,
                  'hover:opacity-80',
                )}
              >
                {t}
              </button>
            );
          })}
        </div>

        <DropdownMenuSeparator />

        <DropdownMenuLabel className="text-[10px] uppercase text-neutral-500 px-1 py-1">
          แท็กกำหนดเอง
        </DropdownMenuLabel>
        <div className="flex gap-1 px-1 pb-1">
          <input
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAddCustom()}
            placeholder="พิมพ์แล้ว Enter"
            className="flex-1 h-7 px-2 text-xs rounded-md border border-neutral-200 bg-neutral-50 outline-none focus:border-indigo-500"
          />
          <button
            type="button"
            disabled={!custom.trim()}
            onClick={handleAddCustom}
            className="h-7 px-2 text-xs rounded-md bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            +
          </button>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
