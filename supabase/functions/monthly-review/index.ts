/**
 * monthly-review v1 — AI "สรุปผล + ข้อเสนอแนะ" ประจำเดือน (รอบ 30 วัน)
 *
 * Pipeline:
 *   1. agent_collect_review_metrics(days)  → 30-day behaviour/ops metrics
 *   2. Gemini turns the numbers into a Thai analysis + ranked recommendations
 *      (rule-based fallback if Gemini is missing/unavailable — never fails)
 *   3. insert into public.system_reviews
 *   4. push a LINE summary to every active LINE-linked owner/admin
 *
 * Triggered by the agent-monthly-review cron (pg_net → agent_run_monthly_review_internal)
 * or on demand by the owner via the agent_request_monthly_review() RPC.
 * verify_jwt is OFF — the x-review-key shared header gates it (same model as notify-team).
 * Pass {"push": false} to generate without sending LINE (used for testing).
 */
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

const REVIEW_KEY = "corebiz_monthly_review_2026_r9m4";
const REPORT_URL = "https://www.jnac.online/center/agent";
const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
const GEMINI_MODELS = ["gemini-2.5-flash", "gemini-2.5-flash-lite"];

type Rec = { priority: number; area: string; title: string; detail: string; effort: string };
type Analysis = { headline: string; summary: string; recommendations: Rec[] };

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { "Content-Type": "application/json" },
  });
}
const baht = (n: unknown) => Number(n ?? 0).toLocaleString("en-US");

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);
  if (req.headers.get("x-review-key") !== REVIEW_KEY) return json({ ok: false, error: "forbidden" }, 403);

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* empty body ok */ }
  const days = Number(body.days ?? 30) || 30;
  const doPush = body.push !== false;

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  // 1) metrics
  const { data: metrics, error: mErr } = await admin.rpc("agent_collect_review_metrics", { p_days: days });
  if (mErr || !metrics) return json({ ok: false, error: "metrics_failed", detail: mErr?.message }, 500);

  // 2) analysis — Gemini, fall back to rule-based
  let analysis: Analysis | null = null;
  let generatedBy = "fallback";
  let usedModel: string | null = null;
  try {
    const key = await getGeminiKey(admin);
    if (key) {
      const r = await geminiAnalyze(key, metrics, days);
      analysis = r.parsed; usedModel = r.model; generatedBy = "ai";
    }
  } catch (e) {
    console.error("monthly-review gemini failed:", (e as Error).message);
  }
  if (!analysis || !analysis.recommendations.length) analysis = fallbackAnalysis(metrics, days);

  // 3) persist
  const periodEnd = new Date();
  const periodStart = new Date(periodEnd.getTime() - days * 86400000);
  const { data: ins, error: iErr } = await admin
    .from("system_reviews")
    .insert({
      period_start: periodStart.toISOString(),
      period_end: periodEnd.toISOString(),
      metrics,
      headline: analysis.headline,
      summary: analysis.summary,
      recommendations: analysis.recommendations,
      generated_by: generatedBy,
      model: usedModel,
    } as never)
    .select("id")
    .single();
  if (iErr) return json({ ok: false, error: "insert_failed", detail: iErr.message }, 500);

  // 4) push LINE
  let sent = 0;
  if (doPush) sent = await pushToOwners(admin, analysis);

  return json({
    ok: true,
    review_id: (ins as { id: string }).id,
    generated_by: generatedBy,
    model: usedModel,
    headline: analysis.headline,
    recommendations: analysis.recommendations.length,
    sent,
  });
});

// --------------------------------------------------------------------------
async function getGeminiKey(admin: SupabaseClient): Promise<string | null> {
  const { data, error } = await admin.rpc("get_api_secret_internal", { p_name: "GEMINI_API_KEY" });
  if (error) { console.warn("gemini key read failed:", error.message); return null; }
  return (data as string | null) ?? null;
}

function stripFence(s: string): string {
  const m = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return (m ? m[1] : s).trim();
}

function normalize(p: Record<string, unknown>): Analysis {
  const recs = Array.isArray(p?.recommendations) ? (p.recommendations as Record<string, unknown>[]) : [];
  return {
    headline: String(p?.headline ?? "").slice(0, 300),
    summary: String(p?.summary ?? "").slice(0, 2000),
    recommendations: recs.slice(0, 8).map((r, i) => ({
      priority: Number(r?.priority ?? i + 1) || i + 1,
      area: String(r?.area ?? "ทั่วไป").slice(0, 40),
      title: String(r?.title ?? "").slice(0, 200),
      detail: String(r?.detail ?? "").slice(0, 800),
      effort: String(r?.effort ?? "กลาง").slice(0, 20),
    })).filter((r) => r.title),
  };
}

async function geminiAnalyze(apiKey: string, metrics: unknown, days: number): Promise<{ parsed: Analysis; model: string }> {
  const sys =
    "คุณคือนักวิเคราะห์ธุรกิจและประสบการณ์ลูกค้า (CX) ของบริษัท JNAC ผู้จำหน่ายวัสดุงานขัด เจียร ตัด " +
    "และเครื่องมือช่างแบบ B2B ในประเทศไทย หน้าที่ของคุณคืออ่านข้อมูลสรุปการดำเนินงานแล้วให้คำแนะนำเชิงกลยุทธ์ที่ทำได้จริง " +
    "เพื่อเพิ่มยอดขาย เพิ่มความพึงพอใจของลูกค้า และลดภาระงานของแอดมิน";
  const instr =
    `ข้อมูลสรุปพฤติกรรมและการดำเนินงาน ${days} วันล่าสุด (JSON):\n${JSON.stringify(metrics)}\n\n` +
    `วิเคราะห์แล้วตอบกลับเป็น JSON object เท่านั้น ตาม schema นี้:\n` +
    `{"headline": string, "summary": string, "recommendations": [{"priority": number, "area": string, "title": string, "detail": string, "effort": string}]}\n\n` +
    `กฎ:\n` +
    `- ภาษาไทยล้วน เป็นกันเองแต่มืออาชีพ\n` +
    `- headline = สรุปภาพรวมเดือนนี้ 1 ประโยคสั้น\n` +
    `- summary = 3-6 ประโยค: ภาพรวม จุดเด่น และจุดที่ต้องระวัง โดยอ้างอิงตัวเลขจริง\n` +
    `- recommendations = 3-6 ข้อ จัดลำดับ priority (1=สำคัญสุด ถึง 3=รอง); ` +
    `area เลือกจาก [ลูกค้า, การขาย, แชท/บริการ, สินค้า/สต็อก, การตลาด, ระบบ]; ` +
    `effort เลือกจาก [เล็ก, กลาง, ใหญ่]; detail บอกว่าควรทำอะไรและเพราะอะไร อิงตัวเลขจริง\n` +
    `- เน้นสิ่งที่เพิ่มความพึงพอใจลูกค้าและลดงานแอดมินได้จริง\n` +
    `- ถ้าข้อมูลยังน้อย ให้เสนอสิ่งที่ควรเริ่มเก็บหรือตั้งค่าก่อน\n` +
    `- ห้ามเปิดเผยหรือคาดเดาต้นทุน/กำไร`;

  let lastErr: Error | null = null;
  for (const model of GEMINI_MODELS) {
    try {
      const res = await fetch(`${GEMINI_BASE}/${model}:generateContent?key=${apiKey}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: sys }] },
          contents: [{ role: "user", parts: [{ text: instr }] }],
          generationConfig: { responseMimeType: "application/json", temperature: 0.4, maxOutputTokens: 2048 },
        }),
      });
      if (!res.ok) {
        const t = await res.text().catch(() => "");
        lastErr = new Error(`gemini ${res.status} ${t.slice(0, 200)}`);
        if (res.status === 429 || res.status === 503) continue;
        throw lastErr;
      }
      const data = await res.json();
      const txt = (data?.candidates?.[0]?.content?.parts ?? [])
        .map((p: { text?: string }) => p.text ?? "").join("").trim();
      if (!txt) { lastErr = new Error("empty gemini text"); continue; }
      return { parsed: normalize(JSON.parse(stripFence(txt))), model };
    } catch (e) {
      lastErr = e as Error;
    }
  }
  throw lastErr ?? new Error("gemini failed");
}

function fallbackAnalysis(m: Record<string, any>, days: number): Analysis {
  const c = m?.customers ?? {}, q = m?.quotes ?? {}, ch = m?.chat ?? {}, inv = m?.inventory ?? {}, sat = m?.satisfaction ?? {};
  const headline =
    `รอบ ${days} วัน: ลูกค้าใหม่ ${c.new ?? 0} ราย · ใบเสนอราคา ${q.count ?? 0} ใบ (${baht(q.value)} ฿) · แชท ${ch.conversations ?? 0} ห้อง`;
  const summary =
    `ช่วง ${days} วันที่ผ่านมามีลูกค้าใหม่ ${c.new ?? 0} ราย จากฐานทั้งหมด ${c.total ?? 0} ราย, ` +
    `เปิดใบเสนอราคา ${q.count ?? 0} ใบ มูลค่ารวม ${baht(q.value)} บาท (ค้างปิด ${q.open ?? 0} ใบ), ` +
    `มีการสนทนา ${ch.conversations ?? 0} ห้อง/${ch.messages ?? 0} ข้อความ, ` +
    `สินค้าหมดสต็อก ${inv.out_of_stock ?? 0} รายการ และใกล้หมด ${inv.low_stock ?? 0} รายการ. ` +
    (sat.responses ? `คะแนนความพึงพอใจเฉลี่ย ${sat.avg_score}.` : `ยังไม่มีการเก็บคะแนนความพึงพอใจในรอบนี้.`);
  const recs: Rec[] = [];
  if ((inv.out_of_stock ?? 0) > 0)
    recs.push({ priority: 1, area: "สินค้า/สต็อก", title: `เติมสต็อกสินค้าที่หมด ${inv.out_of_stock} รายการ`, detail: "สินค้าหมดสต็อกทำให้เสียโอกาสขายและลูกค้าผิดหวัง ควรเร่งสั่งซื้อหรืออัปเดตจำนวนให้ถูกต้อง", effort: "กลาง" });
  if ((q.open ?? 0) > 0)
    recs.push({ priority: 1, area: "การขาย", title: `ติดตามใบเสนอราคาค้าง ${q.open} ใบ`, detail: "ใบเสนอราคาที่ยังไม่ปิดคือโอกาสขายที่รออยู่ ควรติดตามลูกค้าเพื่อปิดการขาย", effort: "เล็ก" });
  if ((sat.responses ?? 0) === 0)
    recs.push({ priority: 2, area: "แชท/บริการ", title: "เริ่มเก็บคะแนนความพึงพอใจลูกค้า", detail: "ส่งแบบประเมินหลังปิดการขายหรือจบบริการ เพื่อวัดความพึงพอใจและหาจุดปรับปรุง", effort: "เล็ก" });
  if ((ch.open_unassigned ?? 0) > 0)
    recs.push({ priority: 2, area: "แชท/บริการ", title: `จัดผู้รับผิดชอบแชทค้าง ${ch.open_unassigned} ห้อง`, detail: "แชทที่ยังไม่มีคนรับผิดชอบเสี่ยงตอบช้าและกระทบความพึงพอใจ", effort: "เล็ก" });
  recs.push({ priority: 3, area: "การตลาด", title: "ใช้ฐานลูกค้าเดิมกระตุ้นการซื้อซ้ำ", detail: `มีลูกค้าในระบบ ${c.total ?? 0} ราย ลองยิงแคมเปญหรือคูปองผ่าน LINE เพื่อกระตุ้นให้กลับมาซื้อ`, effort: "กลาง" });
  return { headline, summary, recommendations: recs.slice(0, 6) };
}

async function pushToOwners(admin: SupabaseClient, analysis: Analysis): Promise<number> {
  const { data: recipients } = await admin
    .from("profiles")
    .select("line_user_id")
    .in("role", ["owner", "admin"])
    .eq("is_active", true)
    .not("line_user_id", "is", null);
  if (!recipients || recipients.length === 0) return 0;

  const { data: ch } = await admin
    .from("line_channels")
    .select("channel_access_token")
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();
  const token = (ch as { channel_access_token?: string } | null)?.channel_access_token;
  if (!token) return 0;

  const topRecs = analysis.recommendations.slice(0, 3).map((r, i) => `${i + 1}. ${r.title}`).join("\n");
  const text =
    `📊 รายงาน AI ประจำเดือน (30 วันล่าสุด)\n\n${analysis.headline}\n\n` +
    (topRecs ? `🎯 ข้อเสนอแนะเด่น:\n${topRecs}\n\n` : "") +
    `อ่านฉบับเต็มในระบบ: ${REPORT_URL}`;

  let sent = 0;
  for (const r of recipients as Array<{ line_user_id: string }>) {
    const res = await fetch("https://api.line.me/v2/bot/message/push", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ to: r.line_user_id, messages: [{ type: "text", text: text.slice(0, 4900) }] }),
    });
    if (res.ok) sent++;
    else console.error("LINE push failed:", res.status, await res.text().catch(() => ""));
  }
  return sent;
}
