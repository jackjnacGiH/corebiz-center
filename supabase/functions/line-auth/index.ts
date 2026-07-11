/**
 * LINE Login for CoreBiz Center staff.
 *
 * This endpoint never creates or links users. A LINE account can sign in only
 * when its LINE user ID is already attached to an active owner/admin/staff
 * profile by an administrator.
 */
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ALLOWED_ORIGINS = new Set([
  "https://www.jnac.online",
  "https://jnac.online",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
]);

function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("origin") ?? "";
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGINS.has(origin) ? origin : "https://www.jnac.online",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

function json(req: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req), "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(req) });
  }
  if (req.method !== "POST") return json(req, { ok: false, error: "method_not_allowed" }, 405);

  const origin = req.headers.get("origin");
  if (origin && !ALLOWED_ORIGINS.has(origin)) {
    return json(req, { ok: false, error: "origin_not_allowed" }, 403);
  }

  const channelId = Deno.env.get("LINE_LOGIN_CHANNEL_ID") ?? "";
  const channelSecret = Deno.env.get("LINE_LOGIN_CHANNEL_SECRET") ?? "";
  const callbackUrl = Deno.env.get("LINE_LOGIN_CALLBACK_URL") ?? "";
  if (!channelId || !channelSecret || !callbackUrl) {
    console.error("line-auth: missing LINE Login configuration");
    return json(req, { ok: false, error: "server_misconfigured" }, 503);
  }

  let code = "";
  try {
    const body = await req.json();
    code = String(body?.code ?? "").trim();
  } catch {
    return json(req, { ok: false, error: "bad_json" }, 400);
  }
  if (!code || code.length > 2048) {
    return json(req, { ok: false, error: "invalid_authorization_code" }, 400);
  }

  const tokenResponse = await fetch("https://api.line.me/oauth2/v2.1/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: callbackUrl,
      client_id: channelId,
      client_secret: channelSecret,
    }),
  });
  if (!tokenResponse.ok) {
    console.warn("line-auth: token exchange failed", tokenResponse.status);
    return json(req, { ok: false, error: "line_authorization_failed" }, 401);
  }

  const lineToken = await tokenResponse.json() as { access_token?: string };
  if (!lineToken.access_token) {
    return json(req, { ok: false, error: "line_authorization_failed" }, 401);
  }

  const profileResponse = await fetch("https://api.line.me/v2/profile", {
    headers: { Authorization: `Bearer ${lineToken.access_token}` },
  });
  if (!profileResponse.ok) {
    console.warn("line-auth: profile lookup failed", profileResponse.status);
    return json(req, { ok: false, error: "line_profile_failed" }, 401);
  }

  const lineProfile = await profileResponse.json() as { userId?: string };
  const lineUserId = String(lineProfile.userId ?? "").trim();
  if (!lineUserId) return json(req, { ok: false, error: "line_profile_failed" }, 401);

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  const { data: staff, error: staffError } = await admin
    .from("profiles")
    .select("id, role, is_active")
    .eq("line_user_id", lineUserId)
    .eq("is_active", true)
    .in("role", ["owner", "admin", "staff"])
    .maybeSingle();

  if (staffError) {
    console.error("line-auth: staff lookup failed", staffError.message);
    return json(req, { ok: false, error: "staff_lookup_failed" }, 500);
  }
  if (!staff) return json(req, { ok: false, error: "staff_account_not_linked" }, 403);

  const { data: authUser, error: userError } = await admin.auth.admin.getUserById(staff.id);
  const email = authUser.user?.email;
  if (userError || !email) {
    console.error("line-auth: auth user lookup failed", userError?.message ?? "missing email");
    return json(req, { ok: false, error: "staff_auth_unavailable" }, 500);
  }

  // generateLink creates a one-time token but sends no email. Consuming that
  // token here yields a normal Supabase session for the existing staff user.
  const { data: link, error: linkError } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
  });
  const tokenHash = link.properties?.hashed_token;
  if (linkError || !tokenHash) {
    console.error("line-auth: session link failed", linkError?.message ?? "missing token hash");
    return json(req, { ok: false, error: "session_issue_failed" }, 500);
  }

  const { data: verified, error: verifyError } = await admin.auth.verifyOtp({
    type: "magiclink",
    token_hash: tokenHash,
  });
  if (verifyError || !verified.session) {
    console.error("line-auth: session verification failed", verifyError?.message ?? "missing session");
    return json(req, { ok: false, error: "session_issue_failed" }, 500);
  }

  return json(req, {
    ok: true,
    access_token: verified.session.access_token,
    refresh_token: verified.session.refresh_token,
    expires_at: verified.session.expires_at,
  });
});
