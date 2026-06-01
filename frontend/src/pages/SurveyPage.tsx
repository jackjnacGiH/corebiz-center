import { useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Loader2, Star, CheckCircle2, AlertCircle } from 'lucide-react';
import { surveyApi } from '../lib/api';

/**
 * Public NPS / satisfaction page (no auth). Customers reach it from a LINE
 * link `/survey/:token`. They tap a 0–10 score, optionally leave a comment,
 * and we record it via the anon `submit_survey` RPC.
 */
export default function SurveyPage() {
  const { token } = useParams<{ token: string }>();
  const [score, setScore] = useState<number | null>(null);
  const [comment, setComment] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'done' | 'already' | 'error'>('idle');
  const [errMsg, setErrMsg] = useState('');

  const scale = useMemo(() => Array.from({ length: 11 }, (_, i) => i), []);

  function colorFor(n: number) {
    if (n <= 6) return 'detractor';
    if (n <= 8) return 'passive';
    return 'promoter';
  }

  async function submit() {
    if (score === null || !token) return;
    setState('sending');
    setErrMsg('');
    try {
      const ok = await surveyApi.submit(token, score, comment);
      setState(ok ? 'done' : 'already');
    } catch (e) {
      setErrMsg((e as Error).message);
      setState('error');
    }
  }

  // ---- Thank-you / terminal states -------------------------------------
  if (state === 'done' || state === 'already') {
    const promoter = (score ?? 0) >= 9;
    return (
      <Shell>
        <div className="text-center py-6">
          <CheckCircle2 size={56} className="mx-auto text-emerald-500" />
          <h2 className="mt-4 text-xl font-bold text-neutral-800">
            {state === 'already' ? 'คุณได้ให้คะแนนไปแล้ว 🙏' : 'ขอบคุณมากค่ะ! 🙏'}
          </h2>
          <p className="mt-2 text-sm text-neutral-500 leading-relaxed">
            {state === 'already'
              ? 'เราได้รับคำตอบของคุณก่อนหน้านี้แล้ว ขอบคุณที่สละเวลานะคะ'
              : promoter
                ? 'ดีใจมากที่คุณประทับใจ! ความเห็นของคุณช่วยให้ทีม JNAC พัฒนาต่อไปได้ค่ะ'
                : 'ขอบคุณสำหรับความเห็นค่ะ เราจะนำไปปรับปรุงให้ดียิ่งขึ้น ทีมงานอาจติดต่อกลับเพื่อดูแลคุณเพิ่มเติมนะคะ'}
          </p>
        </div>
      </Shell>
    );
  }

  // ---- Rating form ------------------------------------------------------
  return (
    <Shell>
      <div className="text-center">
        <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-amber-100 text-amber-500 mb-3">
          <Star size={26} className="fill-amber-400 text-amber-400" />
        </div>
        <h1 className="text-lg font-bold text-neutral-800 leading-snug">
          คุณจะแนะนำ <span className="text-indigo-600">JNAC</span> ให้เพื่อนหรือคนรู้จักมากแค่ไหน?
        </h1>
        <p className="mt-1.5 text-xs text-neutral-400">0 = ไม่แนะนำเลย · 10 = แนะนำแน่นอน</p>
      </div>

      {/* 0–10 scale */}
      <div className="mt-5 grid grid-cols-6 gap-2 sm:grid-cols-11">
        {scale.map((n) => {
          const sel = score === n;
          const kind = colorFor(n);
          const base =
            kind === 'detractor'
              ? 'border-red-200 text-red-600 hover:bg-red-50'
              : kind === 'passive'
                ? 'border-amber-200 text-amber-600 hover:bg-amber-50'
                : 'border-emerald-200 text-emerald-600 hover:bg-emerald-50';
          const selCls =
            kind === 'detractor'
              ? 'bg-red-500 border-red-500 text-white'
              : kind === 'passive'
                ? 'bg-amber-500 border-amber-500 text-white'
                : 'bg-emerald-500 border-emerald-500 text-white';
          return (
            <button
              key={n}
              type="button"
              onClick={() => setScore(n)}
              className={`h-11 rounded-lg border text-sm font-bold tabular-nums transition ${sel ? selCls : base}`}
            >
              {n}
            </button>
          );
        })}
      </div>
      <div className="mt-1.5 flex justify-between text-[10px] text-neutral-400 px-0.5">
        <span>ไม่พอใจ</span>
        <span>พอใจมาก</span>
      </div>

      {/* Comment + submit (revealed after a score is chosen) */}
      {score !== null && (
        <div className="mt-5 animate-in fade-in">
          <label className="block text-xs font-semibold text-neutral-600 mb-1.5">
            อยากบอกอะไรเราเพิ่มไหมคะ? (ไม่บังคับ)
          </label>
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            rows={3}
            placeholder={score <= 6 ? 'มีอะไรให้เราปรับปรุงบ้างคะ?' : 'สิ่งที่คุณชอบเกี่ยวกับเรา…'}
            className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 resize-none"
          />

          {state === 'error' && (
            <div className="mt-2 flex items-start gap-1.5 rounded-lg border border-red-200 bg-red-50 p-2 text-xs text-red-700">
              <AlertCircle size={14} className="mt-0.5 flex-shrink-0" /> ส่งไม่สำเร็จ: {errMsg}
            </div>
          )}

          <button
            type="button"
            onClick={() => void submit()}
            disabled={state === 'sending'}
            className="mt-3 w-full h-11 rounded-lg bg-indigo-600 text-white text-sm font-bold hover:bg-indigo-700 disabled:opacity-50 inline-flex items-center justify-center gap-2"
          >
            {state === 'sending' ? <><Loader2 size={16} className="animate-spin" /> กำลังส่ง…</> : 'ส่งคะแนน'}
          </button>
        </div>
      )}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gradient-to-b from-indigo-50 to-neutral-100 flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-xl border border-neutral-100 p-6 sm:p-7">
        {children}
        <div className="mt-6 pt-4 border-t border-neutral-100 text-center text-[10px] text-neutral-300">
          JNAC · CoreBiz Center — แบบสอบถามความพึงพอใจ
        </div>
      </div>
    </div>
  );
}
