import { GripVertical, Pin, Pencil, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ChatContactNote } from '../../lib/api';

const NOTE_TYPE_LABEL: Record<ChatContactNote['note_type'], string> = {
  general: 'ทั่วไป',
  tax_invoice: 'ใบกำกับภาษี',
  shipping: 'ที่อยู่ส่งของ',
  reminder: 'เตือนความจำ',
  bank_account: 'บัญชีธนาคาร',
  special_terms: 'สิทธิพิเศษ/ส่วนลด',
};

const NOTE_TYPE_ICON: Record<ChatContactNote['note_type'], string> = {
  general: '📝',
  tax_invoice: '🧾',
  shipping: '📦',
  reminder: '⏰',
  bank_account: '🏦',
  special_terms: '⭐',
};

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString('th-TH', { day: '2-digit', month: 'short', year: 'numeric' });

interface AddressLike {
  name?: string;
  company?: string;
  tax_id?: string;
  branch?: string;
  phone?: string;
  line1?: string;
  district?: string;
  subdistrict?: string;
  province?: string;
  postcode?: string;
}

interface Props {
  note: ChatContactNote;
  onEdit: () => void;
  onDelete: () => void;
  onTogglePin: () => void;
  draggable?: boolean;
  isDragging?: boolean;
  isDragOver?: boolean;
  onDragStart?: (e: React.DragEvent) => void;
  onDragOver?: (e: React.DragEvent) => void;
  onDragLeave?: (e: React.DragEvent) => void;
  onDrop?: (e: React.DragEvent) => void;
  onDragEnd?: (e: React.DragEvent) => void;
}

export default function NoteCard({
  note,
  onEdit,
  onDelete,
  onTogglePin,
  draggable,
  isDragging,
  isDragOver,
  onDragStart,
  onDragOver,
  onDragLeave,
  onDrop,
  onDragEnd,
}: Props) {
  const a = (note.address ?? null) as AddressLike | null;

  return (
    <div
      draggable={draggable}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
      className={cn(
        'rounded-lg border p-3 mb-2 transition',
        note.is_pinned
          ? 'bg-indigo-50/40 border-indigo-200'
          : 'bg-neutral-50/40 border-neutral-200',
        isDragging && 'opacity-40',
        isDragOver && 'ring-2 ring-indigo-400 ring-offset-1',
      )}
    >
      <div className="flex items-start gap-2 mb-1.5">
        {draggable && (
          <span
            className="text-neutral-400 hover:text-neutral-600 cursor-grab active:cursor-grabbing self-stretch flex items-center -ml-1"
            title="ลากเพื่อจัดลำดับ"
          >
            <GripVertical size={14} />
          </span>
        )}
        <span className="text-sm">{NOTE_TYPE_ICON[note.note_type]}</span>
        <div className="flex-1 min-w-0">
          <div className="text-[9px] uppercase tracking-wide font-bold text-neutral-500">
            {NOTE_TYPE_LABEL[note.note_type]}
          </div>
          {note.title && (
            <div className="text-sm font-semibold text-neutral-900 mt-0.5 truncate">
              {note.title}
            </div>
          )}
        </div>
        <div className="flex gap-0.5 flex-shrink-0">
          <button
            type="button"
            onClick={onTogglePin}
            title={note.is_pinned ? 'ยกเลิกปักหมุด' : 'ปักหมุด'}
            className={cn(
              'p-1 rounded hover:bg-neutral-100',
              note.is_pinned ? 'text-indigo-600' : 'text-neutral-400',
            )}
          >
            <Pin size={11} fill={note.is_pinned ? 'currentColor' : 'none'} />
          </button>
          <button
            type="button"
            onClick={onEdit}
            title="แก้ไข"
            className="p-1 rounded text-neutral-400 hover:text-neutral-700 hover:bg-neutral-100"
          >
            <Pencil size={11} />
          </button>
          <button
            type="button"
            onClick={onDelete}
            title="ลบ"
            className="p-1 rounded text-neutral-400 hover:text-red-600 hover:bg-red-50"
          >
            <Trash2 size={11} />
          </button>
        </div>
      </div>

      {note.content && (
        <div className="text-xs text-neutral-700 whitespace-pre-wrap leading-relaxed">
          {note.content}
        </div>
      )}

      {a && (
        <div className="text-xs text-neutral-700 leading-relaxed mt-1">
          {a.company && <div className="font-semibold text-neutral-900">{a.company}</div>}
          {a.name && <div className="font-semibold text-neutral-900">{a.name}</div>}
          {a.tax_id && <div>เลขผู้เสียภาษี: {a.tax_id}</div>}
          {a.branch && <div>สาขา: {a.branch}</div>}
          {a.phone && <div>โทร: {a.phone}</div>}
          {(a.line1 || a.subdistrict || a.district || a.province) && (
            <div>
              {[a.line1, a.subdistrict, a.district, a.province, a.postcode]
                .filter(Boolean)
                .join(' ')}
            </div>
          )}
        </div>
      )}

      {note.due_date && (
        <div className="mt-2 inline-flex items-center gap-1 px-2 py-0.5 rounded bg-orange-50 border border-orange-200 text-orange-700 text-[10px]">
          ⏰ ครบกำหนด: {fmtDate(note.due_date)}
        </div>
      )}

      <div className="text-[9px] text-neutral-400 text-right mt-2">
        {fmtDate(note.updated_at)}
      </div>
    </div>
  );
}
