import { redirect } from "next/navigation";

import { getAdminSession } from "@/lib/auth";
import {
  ADMIN_EMAILS,
  hasSupabaseAuthConfig,
  SUPABASE_ANON_KEY,
  SUPABASE_URL,
} from "@/lib/config";
import { jnacPath } from "@/lib/paths";
import { LoginClient } from "@/app/login/login-client";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const session = await getAdminSession();
  if (session) redirect(jnacPath("/"));

  const params = await searchParams;
  return (
    <main className="min-h-screen bg-[var(--background)] px-4 py-10 text-[var(--foreground)]">
      <div className="mx-auto flex min-h-[calc(100vh-80px)] max-w-md flex-col justify-center">
        <div className="mb-8">
          <p className="mb-2 text-sm font-medium text-[var(--accent)]">JNAC Admin</p>
          <h1 className="text-3xl font-semibold">เข้าสู่ระบบเว็บแชทแอดมิน</h1>
          <p className="mt-3 text-sm leading-6 text-[var(--muted)]">
            อนุญาตเฉพาะอีเมลในรายการแอดมิน ระบบ production ใช้ Supabase Auth
            และ local dev ใช้ cookie เฉพาะเครื่องนี้
          </p>
        </div>
        <LoginClient
          supabaseEnabled={hasSupabaseAuthConfig()}
          supabaseUrl={SUPABASE_URL}
          supabaseAnonKey={SUPABASE_ANON_KEY}
          allowedEmails={ADMIN_EMAILS}
          error={params.error}
        />
      </div>
    </main>
  );
}
