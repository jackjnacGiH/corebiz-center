import { redirect } from "next/navigation";
import { NextResponse } from "next/server";

import { isAdminEmail } from "@/lib/config";
import { jnacPath } from "@/lib/paths";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const supabase = await getSupabaseServerClient();

  if (!code || !supabase) {
    redirect(jnacPath("/login?error=missing_code"));
  }

  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    redirect(jnacPath("/login?error=auth_failed"));
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!isAdminEmail(user?.email)) {
    await supabase.auth.signOut();
    return NextResponse.redirect(new URL(jnacPath("/login?error=not_allowed"), request.url));
  }

  return NextResponse.redirect(new URL(jnacPath("/"), request.url));
}
