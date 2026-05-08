import { cookies } from "next/headers";

import { hasSupabaseAuthConfig, isAdminEmail } from "@/lib/config";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export type AdminSession = {
  email: string;
  authMode: "supabase" | "dev-cookie";
};

export const DEV_ADMIN_COOKIE = "jnac_dev_admin_email";

export async function getAdminSession(): Promise<AdminSession | null> {
  if (hasSupabaseAuthConfig()) {
    const supabase = await getSupabaseServerClient();
    const {
      data: { user },
    } = await supabase!.auth.getUser();
    const email = user?.email?.toLowerCase() ?? null;
    if (isAdminEmail(email)) {
      return { email: email!, authMode: "supabase" };
    }
    return null;
  }

  const cookieStore = await cookies();
  const email = cookieStore.get(DEV_ADMIN_COOKIE)?.value?.toLowerCase();
  if (isAdminEmail(email)) {
    return { email: email!, authMode: "dev-cookie" };
  }
  return null;
}

export async function requireAdminForApi() {
  const session = await getAdminSession();
  if (!session) {
    return {
      session: null,
      response: Response.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }
  return { session, response: null };
}
