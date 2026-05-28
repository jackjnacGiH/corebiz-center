import type { ChatConversation, CustomerSnapshot } from '../lib/api';

const MS_PER_DAY = 1000 * 60 * 60 * 24;

export const MANUAL_CUSTOMER_TYPE_TAGS = [
  'ลูกค้าโรงงาน',
  'ตัวแทน',
  'เทรดดิ้ง',
  'หน่วยงานราชการ',
  'ผู้รับเหมาก่อสร้าง',
  'ร้านค้าปลีก/ย่อย',
  'DIY / ช่างส่วนตัว',
] as const;

export const MANUAL_STATUS_TAGS = ['ลูกค้าค้างจ่าย', 'ลูกค้าแบล็กลิสต์'] as const;

export const TIME_TAGS = [
  'หลัง 3 วัน',
  'หลัง 5 วัน',
  'หลัง 7 วัน',
  'หลัง 15 วัน',
  'หลัง 30 วัน',
  'หลัง 45 วัน',
  'หลัง 60 วัน',
  'หลัง 90 วัน',
  'หลัง 180 วัน',
  'เกิน 1 ปี',
] as const;

export function daysSince(iso?: string | null): number | null {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return null;
  return Math.floor((Date.now() - then) / MS_PER_DAY);
}

function timeTagFromDays(days: number | null): string | null {
  if (days === null || days < 3) return null;
  if (days >= 365) return 'เกิน 1 ปี';
  if (days >= 180) return 'หลัง 180 วัน';
  if (days >= 90) return 'หลัง 90 วัน';
  if (days >= 60) return 'หลัง 60 วัน';
  if (days >= 45) return 'หลัง 45 วัน';
  if (days >= 30) return 'หลัง 30 วัน';
  if (days >= 15) return 'หลัง 15 วัน';
  if (days >= 7) return 'หลัง 7 วัน';
  if (days >= 5) return 'หลัง 5 วัน';
  return 'หลัง 3 วัน';
}

export function computeAutoTags(
  conv: Pick<ChatConversation, 'last_customer_message_at' | 'last_message_at'>,
  customer: Pick<CustomerSnapshot, 'tier' | 'total_orders'> | null,
): string[] {
  const tags: string[] = [];
  const lastCustomerMsg = conv.last_customer_message_at ?? conv.last_message_at ?? null;

  if (customer) {
    if (customer.tier === 'vip') tags.push('VIP');
    else if (customer.tier === 'gold') tags.push('Gold');
    else if (customer.tier === 'silver') tags.push('Silver');

    if (customer.total_orders === 1) tags.push('ลูกค้าซื้อครั้งแรก');

    const days = daysSince(lastCustomerMsg);
    if (customer.total_orders >= 3 && days !== null && days <= 90) {
      tags.push('ลูกค้าประจำ');
    }
  }

  const timeTag = timeTagFromDays(daysSince(lastCustomerMsg));
  if (timeTag) tags.push(timeTag);

  return tags;
}

export function isTimeTag(tag: string): boolean {
  return tag.startsWith('หลัง ') || tag === 'เกิน 1 ปี';
}

export interface TagPalette {
  bg: string;
  text: string;
  border: string;
}

export function tagPalette(tag: string): TagPalette {
  if (tag === 'VIP') return { bg: 'bg-purple-50', text: 'text-purple-700', border: 'border-purple-200' };
  if (tag === 'Gold') return { bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-200' };
  if (tag === 'Silver') return { bg: 'bg-slate-50', text: 'text-slate-700', border: 'border-slate-200' };
  if (tag === 'ลูกค้าซื้อครั้งแรก') return { bg: 'bg-green-50', text: 'text-green-700', border: 'border-green-200' };
  if (tag === 'ลูกค้าประจำ') return { bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200' };
  if (tag === 'ลูกค้าค้างจ่าย') return { bg: 'bg-orange-50', text: 'text-orange-700', border: 'border-orange-200' };
  if (tag === 'ลูกค้าแบล็กลิสต์') return { bg: 'bg-red-50', text: 'text-red-700', border: 'border-red-200' };
  if (isTimeTag(tag)) return { bg: 'bg-indigo-50', text: 'text-indigo-700', border: 'border-indigo-200' };
  return { bg: 'bg-blue-50', text: 'text-blue-700', border: 'border-blue-200' };
}
