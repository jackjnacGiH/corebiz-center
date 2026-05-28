import { Lock, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { tagPalette } from '../../utils/chatAutoTags';

interface Props {
  label: string;
  isAuto?: boolean;
  onRemove?: () => void;
}

export default function TagChip({ label, isAuto, onRemove }: Props) {
  const p = tagPalette(label);
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10px] font-medium whitespace-nowrap',
        p.bg,
        p.text,
        p.border,
      )}
      title={isAuto ? 'แท็กอัตโนมัติ (ระบบประเมิน)' : 'แท็กแอดมิน'}
    >
      {isAuto && <Lock size={9} className="opacity-60" />}
      {label}
      {!isAuto && onRemove && (
        <button
          type="button"
          onClick={onRemove}
          className="hover:opacity-100 opacity-60 inline-flex items-center"
          aria-label={`Remove ${label}`}
        >
          <X size={10} />
        </button>
      )}
    </span>
  );
}
