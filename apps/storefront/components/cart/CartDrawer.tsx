"use client";

import { useEffect, useState } from "react";
import { useCart } from "./CartProvider";
import { formatTHB } from "@/lib/format";
import { supabaseBrowser, getPortalProfile } from "@/lib/supabase-browser";

const BRAND = "#1696F4";
const FN_URL = "https://owoedccmuqnzdtxvywgt.supabase.co/functions/v1/storefront-quote";
const ANON =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im93b2VkY2NtdXFuemR0eHZ5d2d0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIzNTMyOTQsImV4cCI6MjA4NzkyOTI5NH0.OfOaHTsJx-M36N5G54PjC4n-8-qZVQNVUuLdb10RO4M";

export default function CartDrawer() {
  const { items, subtotal, count, setQty, remove, clear, open, setOpen } = useCart();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [company, setCompany] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [doneCode, setDoneCode] = useState<string | null>(null);
  const [member, setMember] = useState(false);
  const [memberPct, setMemberPct] = useState(0);
  const [memberTier, setMemberTier] = useState("");

  // Logged-in member → prefill the contact form from their portal profile
  // (only fields still empty, so anything they typed is never overwritten).
  useEffect(() => {
    if (!open) return;
    let live = true;
    void (async () => {
      const p = await getPortalProfile();
      if (!live) return;
      if (p) {
        setMember(true);
        setMemberPct(p.pending_verification ? 0 : Number(p.discount_percent) || 0);
        setMemberTier(p.tier_label ?? "");
        setName((v) => v || p.contact_name || "");
        setPhone((v) => v || p.contact_phone || p.phone || "");
        setCompany((v) => v || p.name || "");
        setEmail((v) => v || p.email || "");
      } else {
        // Logged in but not registered yet → at least fill from the login.
        const { data: sess } = await supabaseBrowser().auth.getSession();
        const u = sess.session?.user;
        if (!live || !u) return;
        setEmail((v) => v || u.email || "");
        setName((v) => v || (u.user_metadata?.full_name as string | undefined) || "");
      }
    })();
    return () => { live = false; };
  }, [open]);

  const vat = Math.round(subtotal * 0.07 * 100) / 100;
  const total = subtotal + vat;

  async function submit() {
    setErr(null);
    if (!name.trim() || !phone.trim()) {
      setErr("กรุณากรอกชื่อและเบอร์โทรติดต่อ");
      return;
    }
    setBusy(true);
    try {
      // Members send their own JWT so the quote is linked to their CRM
      // customer (and their tier discount is applied server-side).
      const { data: sess } = await supabaseBrowser().auth.getSession();
      const bearer = sess.session?.access_token ?? ANON;
      const res = await fetch(FN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: ANON, Authorization: `Bearer ${bearer}` },
        body: JSON.stringify({
          items: items.map((i) => ({ sku: i.sku, qty: i.qty })),
          contact: { name, phone, email, company, note },
        }),
      });
      const data = await res.json();
      if (data?.ok) {
        setDoneCode(String(data.code));
        clear();
      } else {
        setErr(data?.error || "ส่งคำขอไม่สำเร็จ กรุณาลองใหม่");
      }
    } catch {
      setErr("เชื่อมต่อไม่สำเร็จ กรุณาลองใหม่");
    } finally {
      setBusy(false);
    }
  }

  function close() {
    setOpen(false);
    // reset success state shortly after closing so reopening is clean
    setTimeout(() => setDoneCode(null), 300);
  }

  return (
    <div
      className={"fixed inset-0 z-[1100] " + (open ? "" : "pointer-events-none")}
      aria-hidden={!open}
    >
      {/* Backdrop */}
      <div
        onClick={close}
        className={"absolute inset-0 bg-black/40 transition-opacity " + (open ? "opacity-100" : "opacity-0")}
      />
      {/* Panel */}
      <aside
        className={
          "absolute right-0 top-0 h-full w-full sm:w-[420px] bg-neutral-50 shadow-2xl flex flex-col transition-transform duration-200 " +
          (open ? "translate-x-0" : "translate-x-full")
        }
      >
        <header className="flex items-center justify-between px-4 py-3.5 text-white flex-shrink-0" style={{ background: BRAND }}>
          <div className="font-bold">ตะกร้าใบเสนอราคา {count > 0 ? `(${count})` : ""}</div>
          <button type="button" onClick={close} aria-label="ปิด" className="p-1.5 rounded-md hover:bg-white/15">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </header>

        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {doneCode ? (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-5 text-center">
              <div className="text-4xl">✅</div>
              <h3 className="mt-2 font-bold text-emerald-800">ส่งคำขอใบเสนอราคาแล้ว!</h3>
              <p className="mt-1 text-sm text-emerald-700">
                เลขที่เอกสาร <span className="font-mono font-bold">{doneCode}</span>
                <br />ทีมงานจะติดต่อกลับเพื่อยืนยันราคาและจัดส่งโดยเร็วที่สุดค่ะ
              </p>
              <button type="button" onClick={close} className="mt-4 rounded-lg px-5 py-2 text-white font-semibold" style={{ background: BRAND }}>
                เลือกซื้อต่อ
              </button>
            </div>
          ) : items.length === 0 ? (
            <div className="text-center text-neutral-400 py-16">ยังไม่มีสินค้าในตะกร้า</div>
          ) : (
            <>
              {items.map((it) => (
                <div key={it.sku} className="flex gap-3 rounded-xl border border-neutral-200 bg-white p-2.5">
                  <div className="w-16 h-16 flex-shrink-0 bg-neutral-50 rounded-lg grid place-items-center overflow-hidden">
                    {it.image ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={it.image} alt={it.name} className="w-full h-full object-contain p-1" />
                    ) : (
                      <span className="text-[10px] text-neutral-300">ไม่มีรูป</span>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-[11px] text-neutral-400 font-mono">{it.sku}</div>
                    <div className="text-sm text-neutral-800 leading-snug line-clamp-2">{it.name}</div>
                    <div className="mt-1 flex items-center justify-between">
                      <div className="inline-flex items-center rounded border border-neutral-200 overflow-hidden">
                        <button type="button" onClick={() => setQty(it.sku, it.qty - 1)} className="px-2 text-neutral-500 hover:bg-neutral-50">−</button>
                        <input
                          type="number"
                          min={1}
                          value={it.qty}
                          onChange={(e) => setQty(it.sku, Number(e.target.value) || 1)}
                          className="w-12 text-center outline-none py-1 tabular-nums text-sm"
                        />
                        <button type="button" onClick={() => setQty(it.sku, it.qty + 1)} className="px-2 text-neutral-500 hover:bg-neutral-50">+</button>
                      </div>
                      <div className="text-sm font-bold" style={{ color: BRAND }}>{formatTHB(it.price * it.qty)}</div>
                    </div>
                  </div>
                  <button type="button" onClick={() => remove(it.sku)} aria-label="ลบ" className="text-neutral-300 hover:text-rose-600 self-start">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" />
                    </svg>
                  </button>
                </div>
              ))}

              {/* Contact form */}
              <div className="rounded-xl border border-neutral-200 bg-white p-3 space-y-2.5 mt-2">
                <div className="text-sm font-bold text-neutral-800">ข้อมูลติดต่อ (เพื่อออกใบเสนอราคา)</div>
                {member && (
                  <p className="rounded-md bg-emerald-50 border border-emerald-100 px-2.5 py-1.5 text-[11px] text-emerald-700">
                    ✓ ดึงข้อมูลจากบัญชีสมาชิกของคุณแล้ว (แก้ไขได้) — ใบเสนอราคานี้จะบันทึกเข้าประวัติบัญชีของคุณ
                  </p>
                )}
                <input value={name} onChange={(e) => setName(e.target.value)} placeholder="ชื่อผู้ติดต่อ *" className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-[#1696F4]" />
                <input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" placeholder="เบอร์โทร *" className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-[#1696F4]" />
                <input value={company} onChange={(e) => setCompany(e.target.value)} placeholder="บริษัท / ร้าน (ถ้ามี)" className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-[#1696F4]" />
                <input value={email} onChange={(e) => setEmail(e.target.value)} inputMode="email" placeholder="อีเมล (ถ้ามี)" className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-[#1696F4]" />
                <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="หมายเหตุ / รายละเอียดเพิ่มเติม" className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-[#1696F4] resize-none" />
              </div>
            </>
          )}
        </div>

        {!doneCode && items.length > 0 && (
          <footer className="border-t border-neutral-200 bg-white p-4 space-y-2 flex-shrink-0">
            {err && <div className="rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-sm px-3 py-2">{err}</div>}
            <div className="flex justify-between text-sm text-neutral-600">
              <span>ยอดรวมสินค้า</span><span className="tabular-nums">{formatTHB(subtotal)}</span>
            </div>
            <div className="flex justify-between text-sm text-neutral-600">
              <span>ภาษีมูลค่าเพิ่ม 7%</span><span className="tabular-nums">{formatTHB(vat)}</span>
            </div>
            <div className="flex justify-between font-bold text-neutral-900">
              <span>ยอดสุทธิ (ประมาณ)</span><span className="tabular-nums" style={{ color: BRAND }}>{formatTHB(total)}</span>
            </div>
            {memberPct > 0 && (
              <p className="text-[11px] text-emerald-700 text-center">
                🏅 สมาชิก {memberTier}: ส่วนลด {memberPct}% จะถูกหักให้ในใบเสนอราคาอัตโนมัติ
              </p>
            )}
            <button
              type="button"
              onClick={submit}
              disabled={busy}
              className="w-full rounded-lg py-3 text-white font-bold transition disabled:opacity-60"
              style={{ background: BRAND }}
            >
              {busy ? "กำลังส่ง..." : "ส่งคำขอใบเสนอราคา"}
            </button>
            <p className="text-[11px] text-neutral-400 text-center">ราคาเป็นราคาประมาณการ ทีมงานจะยืนยันราคาสุทธิอีกครั้ง</p>
          </footer>
        )}
      </aside>
    </div>
  );
}
