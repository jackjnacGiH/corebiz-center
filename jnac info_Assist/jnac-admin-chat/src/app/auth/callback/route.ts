import { redirect } from "next/navigation";
import { NextResponse } from "next/server";

import { isAdminEmail } from "@/lib/config";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const supabase = await getSupabaseServerClient();

  if (!code || !supabase) {
    redirect("/login?error=missing_code");
  }

  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    redirect("/login?error=auth_failed");
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!isAdminEmail(user?.email)) {
    await supabase.auth.signOut();
    return NextResponse.redirect(new URL("/login?error=not_allowed", request.url));
  }

  return NextResponse.redirect(new URL("/", request.url));
}
