import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { DEV_ADMIN_COOKIE } from "@/lib/auth";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const supabase = await getSupabaseServerClient();
  if (supabase) {
    await supabase.auth.signOut();
  }
  const cookieStore = await cookies();
  cookieStore.delete(DEV_ADMIN_COOKIE);
  return NextResponse.redirect(new URL("/login", request.url));
}
