import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { Loader2, Gift, CheckCircle2, AlertCircle, UserPlus } from 'lucide-react';
import { referralApi } from '../lib/api';

/**
 * Public referral landing page (no auth). A customer shares `/refer/:code`;
 * their friend enters name + phone and we create a pending referral via the
 * anon `submit_referral` RPC. Staff then reward both sides once it converts.
 */
export default function ReferPage() {
  const { code } = useParams<{ code: string }>();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [note, setNote] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'done' | 'error'>('idle');
  const [errMsg, setErrMsg] = useState('');

  async function submit() {
    if (!code || !name.trim()) return;
    setState('sending');
    setErrMsg('');
    try {
      await referralApi.submit(code, name.trim(), phone.trim() || undefined, note.trim() || undefined);
      setState('done');
    } catch (e) {
      const m = (e as Error).message;
      setErrMsg(m.includes('invalid_code') ? 'ลิงก์แนะนำไม่ถูกต้องหรือหมดอายุ' : m);
      setState('error');
    }
  }

  if (state === 'done') {
    return (
      <Shell>
        <div className="text-center py-6">
          <CheckCircle2 size={56} className="mx-auto text-emerald-500" />
          <h2 className="mt-4 text-xl font-bold text-neutral-800">ลงทะเบียนเรียบร้อย! 🎉</h2>
          <p className="mt-2 text-sm text-neutral-500 leading-relaxed">
            ขอบคุณที่สนใจ JNAC นะคะ ทีมงานจะติดต่อกลับเร็ว ๆ นี้ค่ะ<br />
            เมื่อสั่งซื้อครั้งแรก คุณและเพื่อนที่แนะนำจะได้รับสิทธิพิเศษทั้งคู่ 🎁
          </p>
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      <div className="text-center">
        <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-rose-100 text-rose-500 mb-3">
          <Gift size={26} />
        </div>
        <h1 className="text-lg font-bold text-neutral-800 leading-snug">
          เพื่อนแนะนำคุณมาที่ <span className="text-indigo-600">JNAC</span> 🎁
        </h1>
        <p className="mt-1.5 text-xs text-neutral-500 leading-relaxed">
          ผู้จำหน่ายวัสดุขัด/เจียรอุตสาหกรรม · ลงทะเบียนรับสิทธิพิเศษสำหรับลูกค้าใหม่ แล้วทีมงานจะติดต่อกลับค่ะ
        </p>
      </div>

      <div className="mt-5 flex flex-col gap-3">
        <Field label="ชื่อ–บริษัท / ผู้ติดต่อ *">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="เช่น คุณสมชาย / บริษัท ABC จำกัด"
            className="w-full rounded-lg border border-neutral-200 px-3 py-2.5 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
          />
        </Field>
        <Field label="เบอร์โทรติดต่อ">
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            inputMode="tel"
            placeholder="08X-XXX-XXXX"
            className="w-full rounded-lg border border-neutral-200 px-3 py-2.5 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
          />
        </Field>
        <Field label="สนใจสินค้าประเภทไหน (ไม่บังคับ)">
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            placeholder="เช่น จานทรายเจีย, กระดาษทราย, ใบตัด…"
            className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 resize-none"
          />
        </Field>

        {state === 'error' && (
          <div className="flex items-start gap-1.5 rounded-lg border border-red-200 bg-red-50 p-2 text-xs text-red-700">
            <AlertCircle size={14} className="mt-0.5 flex-shrink-0" /> {errMsg}
          </div>
        )}

        <button
          type="button"
          onClick={() => void submit()}
          disabled={state === 'sending' || !name.trim()}
          className="mt-1 w-full h-11 rounded-lg bg-indigo-600 text-white text-sm font-bold hover:bg-indigo-700 disabled:opacity-50 inline-flex items-center justify-center gap-2"
        >
          {state === 'sending'
            ? <><Loader2 size={16} className="animate-spin" /> กำลังส่ง…</>
            : <><UserPlus size={16} /> ลงทะเบียนรับสิทธิ์</>}
        </button>
        <p className="text-[10px] text-neutral-400 text-center">
          เราจะใช้ข้อมูลนี้เพื่อติดต่อกลับเรื่องการสั่งซื้อเท่านั้น
        </p>
      </div>
    </Shell>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs font-semibold text-neutral-600 mb-1">{label}</span>
      {children}
    </label>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gradient-to-b from-rose-50 to-neutral-100 flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-xl border border-neutral-100 p-6 sm:p-7">
        {children}
        <div className="mt-6 pt-4 border-t border-neutral-100 text-center text-[10px] text-neutral-300">
          JNAC · CoreBiz Center — โปรแกรมแนะนำเพื่อน
        </div>
      </div>
    </div>
  );
}
