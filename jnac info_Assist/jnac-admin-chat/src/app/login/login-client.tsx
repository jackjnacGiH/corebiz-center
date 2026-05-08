"use client";

import { createBrowserClient } from "@supabase/ssr";
import { LogIn } from "lucide-react";
import { useState } from "react";

export function LoginClient({
  supabaseEnabled,
  supabaseUrl,
  supabaseAnonKey,
  allowedEmails,
  error,
}: {
  supabaseEnabled: boolean;
  supabaseUrl: string;
  supabaseAnonKey: string;
  allowedEmails: string[];
  error?: string;
}) {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setStatus(null);
    try {
      if (supabaseEnabled) {
        const supabase = createBrowserClient(supabaseUrl, supabaseAnonKey);
        const { error: signInError } = await supabase.auth.signInWithOtp({
          email,
          options: {
            emailRedirectTo: `${window.location.origin}/auth/callback`,
          },
        });
        if (signInError) throw signInError;
        setStatus("ส่งลิงก์เข้าสู่ระบบไปที่อีเมลแล้ว");
      } else {
        const response = await fetch("/api/dev-login", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ email }),
        });
        if (!response.ok) {
          const body = (await response.json()) as { error?: string };
          throw new Error(body.error ?? "Login failed");
        }
        window.location.href = "/";
      }
    } catch (caught) {
      setStatus(caught instanceof Error ? caught.message : "Login failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="rounded-lg border border-[var(--line)] bg-[var(--panel)] p-5">
      {error ? (
        <p className="mb-4 rounded-md border border-red-400/30 bg-red-400/10 px-3 py-2 text-sm text-red-200">
          Login error: {error}
        </p>
      ) : null}
      <form onSubmit={submit} className="space-y-4">
        <label className="block text-sm font-medium" htmlFor="email">
          Admin email
        </label>
        <input
          id="email"
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="admin@example.com"
          className="h-11 w-full rounded-md border border-[var(--line)] bg-[var(--panel-2)] px-3 text-sm outline-none focus:border-[var(--accent)]"
          required
        />
        <button
          type="submit"
          disabled={loading}
          className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-md bg-[var(--accent)] px-4 text-sm font-semibold text-slate-950 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <LogIn size={18} />
          {supabaseEnabled ? "ส่ง magic link" : "เข้าสู่ระบบ local dev"}
        </button>
      </form>
      {status ? <p className="mt-4 text-sm text-[var(--muted)]">{status}</p> : null}
      <div className="mt-5 border-t border-[var(--line)] pt-4">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
          Allowed admins
        </p>
        <ul className="space-y-1 text-sm text-slate-300">
          {allowedEmails.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </div>
    </section>
  );
}
