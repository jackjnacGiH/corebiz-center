import { useEffect, useState } from 'react';
import { Save } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import type { ChatContactNote } from '../../lib/api';

const TYPES: ChatContactNote['note_type'][] = [
  'general',
  'tax_invoice',
  'shipping',
  'reminder',
  'bank_account',
  'special_terms',
];

const LABELS: Record<ChatContactNote['note_type'], string> = {
  general: 'ทั่วไป',
  tax_invoice: 'ใบกำกับภาษี',
  shipping: 'ที่อยู่ส่งของ',
  reminder: 'เตือนความจำ',
  bank_account: 'บัญชีธนาคาร',
  special_terms: 'สิทธิพิเศษ/ส่วนลด',
};

const ICONS: Record<ChatContactNote['note_type'], string> = {
  general: '📝',
  tax_invoice: '🧾',
  shipping: '📦',
  reminder: '⏰',
  bank_account: '🏦',
  special_terms: '⭐',
};

interface AddressDraft {
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

interface DraftPayload {
  note_type: ChatContactNote['note_type'];
  title: string | null;
  content: string | null;
  address: Record<string, unknown> | null;
  due_date: string | null;
  tags: string[];
  metadata: Record<string, unknown>;
  is_pinned: boolean;
}

interface Props {
  open: boolean;
  initial?: ChatContactNote;
  onClose: () => void;
  onSubmit: (payload: DraftPayload) => Promise<void>;
}

export default function NoteModal({ open, initial, onClose, onSubmit }: Props) {
  const [type, setType] = useState<ChatContactNote['note_type']>('general');
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [address, setAddress] = useState<AddressDraft>({});
  const [dueDate, setDueDate] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setType(initial?.note_type ?? 'general');
      setTitle(initial?.title ?? '');
      setContent(initial?.content ?? '');
      setAddress((initial?.address as AddressDraft) ?? {});
      setDueDate(initial?.due_date ? initial.due_date.slice(0, 16) : '');
    }
  }, [open, initial]);

  const isAddressType = type === 'tax_invoice' || type === 'shipping';

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSubmit({
        note_type: type,
        title: title.trim() || null,
        content: !isAddressType ? content.trim() || null : null,
        address: isAddressType ? (address as Record<string, unknown>) : null,
        due_date: type === 'reminder' && dueDate ? new Date(dueDate).toISOString() : null,
        tags: initial?.tags ?? [],
        metadata: initial?.metadata ?? {},
        is_pinned: initial?.is_pinned ?? false,
      });
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{initial ? 'แก้ไขโน้ต' : 'สร้างโน้ตใหม่'}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label className="text-xs">ประเภทโน้ต</Label>
            <div className="grid grid-cols-4 gap-1.5 mt-1.5">
              {TYPES.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setType(t)}
                  className={cn(
                    'flex flex-col items-center gap-1 py-2 px-1 rounded-md border text-[10px] transition',
                    type === t
                      ? 'bg-indigo-50 border-indigo-500 text-indigo-700 font-medium'
                      : 'bg-white border-neutral-200 text-neutral-600 hover:bg-neutral-50',
                  )}
                >
                  <span className="text-base">{ICONS[t]}</span>
                  {LABELS[t]}
                </button>
              ))}
            </div>
          </div>

          <div>
            <Label className="text-xs">หัวข้อ</Label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="เช่น สำนักงานใหญ่ / สาขา 1"
              className="mt-1.5"
            />
          </div>

          {isAddressType && (
            <>
              {type === 'tax_invoice' && (
                <>
                  <div>
                    <Label className="text-xs">ชื่อบริษัท / นิติบุคคล</Label>
                    <Input
                      value={address.company ?? ''}
                      onChange={(e) => setAddress({ ...address, company: e.target.value })}
                      className="mt-1.5"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <Label className="text-xs">เลขผู้เสียภาษี</Label>
                      <Input
                        value={address.tax_id ?? ''}
                        onChange={(e) => setAddress({ ...address, tax_id: e.target.value })}
                        className="mt-1.5"
                      />
                    </div>
                    <div>
                      <Label className="text-xs">สาขา</Label>
                      <Input
                        value={address.branch ?? ''}
                        onChange={(e) => setAddress({ ...address, branch: e.target.value })}
                        className="mt-1.5"
                      />
                    </div>
                  </div>
                </>
              )}
              {type === 'shipping' && (
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label className="text-xs">ชื่อผู้รับ</Label>
                    <Input
                      value={address.name ?? ''}
                      onChange={(e) => setAddress({ ...address, name: e.target.value })}
                      className="mt-1.5"
                    />
                  </div>
                  <div>
                    <Label className="text-xs">เบอร์โทร</Label>
                    <Input
                      value={address.phone ?? ''}
                      onChange={(e) => setAddress({ ...address, phone: e.target.value })}
                      className="mt-1.5"
                    />
                  </div>
                </div>
              )}
              <div>
                <Label className="text-xs">ที่อยู่ (เลขที่ / หมู่ / ถนน)</Label>
                <Input
                  value={address.line1 ?? ''}
                  onChange={(e) => setAddress({ ...address, line1: e.target.value })}
                  className="mt-1.5"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-xs">ตำบล/แขวง</Label>
                  <Input
                    value={address.subdistrict ?? ''}
                    onChange={(e) => setAddress({ ...address, subdistrict: e.target.value })}
                    className="mt-1.5"
                  />
                </div>
                <div>
                  <Label className="text-xs">อำเภอ/เขต</Label>
                  <Input
                    value={address.district ?? ''}
                    onChange={(e) => setAddress({ ...address, district: e.target.value })}
                    className="mt-1.5"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-xs">จังหวัด</Label>
                  <Input
                    value={address.province ?? ''}
                    onChange={(e) => setAddress({ ...address, province: e.target.value })}
                    className="mt-1.5"
                  />
                </div>
                <div>
                  <Label className="text-xs">รหัสไปรษณีย์</Label>
                  <Input
                    value={address.postcode ?? ''}
                    onChange={(e) => setAddress({ ...address, postcode: e.target.value })}
                    className="mt-1.5"
                  />
                </div>
              </div>
            </>
          )}

          {type === 'reminder' && (
            <div>
              <Label className="text-xs">วันที่ครบกำหนด</Label>
              <Input
                type="datetime-local"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="mt-1.5"
              />
            </div>
          )}

          {!isAddressType && (
            <div>
              <Label className="text-xs">รายละเอียด</Label>
              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                rows={4}
                placeholder={
                  type === 'bank_account'
                    ? 'ธนาคาร / เลขบัญชี / ชื่อบัญชี'
                    : type === 'special_terms'
                      ? 'เช่น ส่วนลด 10%, credit 30 วัน'
                      : 'รายละเอียดเพิ่มเติม...'
                }
                className="mt-1.5 w-full rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 resize-none"
              />
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            ยกเลิก
          </Button>
          <Button
            onClick={handleSave}
            disabled={saving}
            className="bg-indigo-600 hover:bg-indigo-700 gap-2"
          >
            <Save size={14} /> บันทึก
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
