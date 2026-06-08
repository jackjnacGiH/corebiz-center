/**
 * admin-users — owner/admin user & role management (Admin RBAC Phase 1).
 *
 * The browser cannot use the Supabase service_role key, so all create/update/
 * delete of accounts goes through this function. It:
 *   1. Identifies the caller from their JWT (Authorization header).
 *   2. Authorizes: caller must be an active `owner` or `admin`.
 *   3. Enforces safety rules (can't manage owner unless owner, can't edit own
 *      role / deactivate self, always keep >= 1 owner).
 *   4. Performs the action with the service-role admin client.
 *   5. Writes an audit_logs row.
 *
 * Every handled response is HTTP 200 with { ok: boolean, ... } so the client
 * reads errors from the body (avoids FunctionsHttpError parsing).
 */
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Roles assignable in Phase 1 (the three that have full RLS data access).
const ASSIGNABLE_ROLES = ["owner", "admin", "staff", "agent", "viewer"];

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}
const ok = (extra: Record<string, unknown> = {}) => json({ ok: true, ...extra });
const fail = (error: string) => json({ ok: false, error });

type Profile = { id: string; email: string; role: string; is_active: boolean; full_name: string | null };

async function getProfile(admin: SupabaseClient, id: string): Promise<Profile | null> {
  const { data } = await admin
    .from("profiles")
    .select("id, email, role, is_active, full_name")
    .eq("id", id)
    .maybeSingle();
  return (data as Profile | null) ?? null;
}

async function ownerCount(admin: SupabaseClient): Promise<number> {
  const { count } = await admin
    .from("profiles")
    .select("id", { count: "exact", head: true })
    .eq("role", "owner")
    .eq("is_active", true);
  return count ?? 0;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return fail("method_not_allowed");

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  // --- 1. Identify + authorize caller ---
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return fail("unauthorized");
  const { data: u, error: uErr } = await admin.auth.getUser(token);
  if (uErr || !u?.user) return fail("unauthorized");
  const caller = await getProfile(admin, u.user.id);
  if (!caller || !caller.is_active || !["owner", "admin"].includes(caller.role)) {
    return fail("คุณไม่มีสิทธิ์จัดการผู้ใช้");
  }
  const isOwner = caller.role === "owner";

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { return fail("รูปแบบคำขอไม่ถูกต้อง"); }
  const action = String(body.action ?? "");

  const audit = (act: string, targetId: string | null, detail: Record<string, unknown> = {}) =>
    admin.from("audit_logs").insert({
      actor_id: caller.id, action: act, target_type: "user", target_id: targetId, detail,
    });

  // Guard: only owner may touch an owner account.
  const guardOwnerTarget = (target: Profile) =>
    target.role === "owner" && !isOwner ? "จัดการบัญชี Owner ได้เฉพาะ Owner เท่านั้น" : null;

  switch (action) {
    case "list": {
      const { data, error } = await admin
        .from("profiles")
        .select("id, email, full_name, phone, role, is_active, provider, avatar_url")
        .order("is_active", { ascending: false })
        .order("role", { ascending: true })
        .order("email", { ascending: true });
      if (error) return fail(error.message);
      return ok({ users: data ?? [] });
    }

    case "create": {
      const email = String(body.email ?? "").trim().toLowerCase();
      const role = String(body.role ?? "staff");
      const full_name = String(body.full_name ?? "").trim() || null;
      const phone = String(body.phone ?? "").trim() || null;
      const password = String(body.password ?? "");
      const mode = body.mode === "invite" ? "invite" : "password";
      const redirectTo = String(body.redirectTo ?? "https://www.jnac.online/auth/callback");
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail("กรุณากรอกอีเมลให้ถูกต้อง");
      if (!ASSIGNABLE_ROLES.includes(role)) return fail("สิทธิ์ (role) ไม่ถูกต้อง");
      if (role === "owner" && !isOwner) return fail("เฉพาะ Owner เท่านั้นที่กำหนดสิทธิ์ Owner ได้");

      let newId: string;
      if (mode === "invite") {
        // Send an email invitation; the user sets their own password via the link.
        const { data: inv, error: iErr } = await admin.auth.admin.inviteUserByEmail(email, {
          data: { full_name }, redirectTo,
        });
        if (iErr || !inv?.user) return fail(iErr?.message ?? "ส่งคำเชิญไม่สำเร็จ (ตรวจการตั้งค่าอีเมลของระบบ)");
        newId = inv.user.id;
      } else {
        if (password.length < 8) return fail("รหัสผ่านเริ่มต้นต้องยาวอย่างน้อย 8 ตัวอักษร");
        const { data: created, error: cErr } = await admin.auth.admin.createUser({
          email, password, email_confirm: true, user_metadata: { full_name },
        });
        if (cErr || !created?.user) return fail(cErr?.message ?? "สร้างบัญชีไม่สำเร็จ");
        newId = created.user.id;
      }
      // handle_new_user trigger already inserted a base profile row; set role/details.
      const { error: pErr } = await admin
        .from("profiles")
        .upsert({ id: newId, email, role, full_name, phone, is_active: true, provider: "email" }, { onConflict: "id" });
      if (pErr) return fail(pErr.message);
      await audit("user.create", newId, { email, role });
      return ok({ id: newId });
    }

    case "update": {
      const id = String(body.id ?? "");
      const target = await getProfile(admin, id);
      if (!target) return fail("ไม่พบผู้ใช้");
      const og = guardOwnerTarget(target);
      if (og) return fail(og);

      const patch: Record<string, unknown> = {};
      if (body.full_name !== undefined) patch.full_name = String(body.full_name).trim() || null;
      if (body.phone !== undefined) patch.phone = String(body.phone).trim() || null;
      if (body.role !== undefined) {
        const newRole = String(body.role);
        if (!ASSIGNABLE_ROLES.includes(newRole)) return fail("สิทธิ์ (role) ไม่ถูกต้อง");
        if (id === caller.id) return fail("เปลี่ยนสิทธิ์ของตัวเองไม่ได้");
        if ((newRole === "owner" || target.role === "owner") && !isOwner)
          return fail("จัดการสิทธิ์ Owner ได้เฉพาะ Owner");
        if (target.role === "owner" && newRole !== "owner" && (await ownerCount(admin)) <= 1)
          return fail("ต้องมี Owner อย่างน้อย 1 คนในระบบ");
        patch.role = newRole;
      }
      if (Object.keys(patch).length === 0) return ok();
      const { error } = await admin.from("profiles").update(patch).eq("id", id);
      if (error) return fail(error.message);
      await audit("user.update", id, patch);
      return ok();
    }

    case "set_active": {
      const id = String(body.id ?? "");
      const active = Boolean(body.active);
      if (id === caller.id) return fail("เปิด/ปิดบัญชีของตัวเองไม่ได้");
      const target = await getProfile(admin, id);
      if (!target) return fail("ไม่พบผู้ใช้");
      const og = guardOwnerTarget(target);
      if (og) return fail(og);
      if (!active && target.role === "owner" && (await ownerCount(admin)) <= 1)
        return fail("ปิดการใช้งาน Owner คนสุดท้ายไม่ได้");
      const { error } = await admin.from("profiles").update({ is_active: active }).eq("id", id);
      if (error) return fail(error.message);
      // Force sign-out when deactivating (revoke sessions).
      if (!active) await admin.auth.admin.signOut(id).catch(() => {});
      await audit(active ? "user.activate" : "user.deactivate", id, {});
      return ok();
    }

    case "set_password": {
      const id = String(body.id ?? "");
      const password = String(body.password ?? "");
      if (password.length < 8) return fail("รหัสผ่านต้องยาวอย่างน้อย 8 ตัวอักษร");
      const target = await getProfile(admin, id);
      if (!target) return fail("ไม่พบผู้ใช้");
      const og = guardOwnerTarget(target);
      if (og) return fail(og);
      const { error } = await admin.auth.admin.updateUserById(id, { password });
      if (error) return fail(error.message);
      await audit("user.set_password", id, {});
      return ok();
    }

    case "delete": {
      if (!isOwner) return fail("ลบผู้ใช้ได้เฉพาะ Owner");
      const id = String(body.id ?? "");
      if (id === caller.id) return fail("ลบบัญชีของตัวเองไม่ได้");
      const target = await getProfile(admin, id);
      if (!target) return fail("ไม่พบผู้ใช้");
      if (target.role === "owner" && (await ownerCount(admin)) <= 1)
        return fail("ลบ Owner คนสุดท้ายไม่ได้");
      const { error } = await admin.auth.admin.deleteUser(id);
      if (error) return fail(error.message);
      await admin.from("profiles").delete().eq("id", id); // in case there is no FK cascade
      await audit("user.delete", id, { email: target.email });
      return ok();
    }

    case "transfer_owner": {
      if (!isOwner) return fail("โอนความเป็นเจ้าของได้เฉพาะ Owner");
      const id = String(body.id ?? "");
      if (id === caller.id) return fail("เลือกผู้ใช้คนอื่นเพื่อโอนความเป็นเจ้าของ");
      const target = await getProfile(admin, id);
      if (!target) return fail("ไม่พบผู้ใช้");
      if (!target.is_active) return fail("ผู้ใช้ที่จะรับโอนต้องเปิดใช้งานอยู่");
      const { error: e1 } = await admin.from("profiles").update({ role: "owner" }).eq("id", id);
      if (e1) return fail(e1.message);
      const { error: e2 } = await admin.from("profiles").update({ role: "admin" }).eq("id", caller.id);
      if (e2) return fail(e2.message);
      await audit("user.transfer_owner", id, { from: caller.id });
      return ok();
    }

    default:
      return fail("คำสั่งไม่ถูกต้อง");
  }
});
