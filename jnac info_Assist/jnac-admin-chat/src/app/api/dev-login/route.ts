import { cookies } from "next/headers";

import { DEV_ADMIN_COOKIE } from "@/lib/auth";
import { hasSupabaseAuthConfig, isAdminEmail } from "@/lib/config";

export async function POST(request: Request) {
  if (hasSupabaseAuthConfig()) {
    return Response.json(
      { error: "Dev login is disabled when Supabase auth is configured" },
      { status: 400 },
    );
  }

  const body = (await request.json()) as { email?: string };
  const email = body.email?.trim().toLowerCase();
  if (!isAdminEmail(email)) {
    return Response.json({ error: "Email is not in admin whitelist" }, { status: 403 });
  }

  const cookieStore = await cookies();
  cookieStore.set(DEV_ADMIN_COOKIE, email!, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });
  return Response.json({ ok: true });
}
