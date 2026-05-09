"use client";

import {
  Database,
  History,
  LogOut,
  PackageSearch,
  RefreshCw,
  Send,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { jnacPath } from "@/lib/paths";
import type { ChatMessage, PriceRule, ProductRecord } from "@/lib/types";

type SessionRow = {
  id: string;
  title: string;
  admin_email: string;
  created_at: string;
  updated_at: string;
};

export function ChatShell({
  adminEmail,
  authMode,
  initialSessions,
}: {
  adminEmail: string;
  authMode: string;
  initialSessions: SessionRow[];
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: "assistant",
      content:
        "ถามราคา คงเหลือ ตำแหน่งจัดเก็บ หรือรายละเอียดสินค้าได้ ระบบจะใช้ Product price rules และ Inventory ล่าสุด",
    },
  ]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncStatus, setSyncStatus] = useState<string | null>(null);
  const [matches, setMatches] = useState<{
    products: ProductRecord[];
    priceRules: PriceRule[];
  }>({ products: [], priceRules: [] });

  const canSend = useMemo(() => input.trim().length > 0 && !loading, [input, loading]);

  async function sendMessage(event: React.FormEvent) {
    event.preventDefault();
    if (!canSend) return;
    const message = input.trim();
    setInput("");
    setLoading(true);
    setMessages((current) => [...current, { role: "user", content: message }]);
    try {
      const response = await fetch(jnacPath("/api/chat"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message, sessionId }),
      });
      const body = (await response.json()) as {
        answer?: string;
        sessionId?: string;
        products?: ProductRecord[];
        priceRules?: PriceRule[];
        error?: string;
      };
      if (!response.ok) throw new Error(body.error ?? "Chat request failed");
      if (body.sessionId) setSessionId(body.sessionId);
      setMatches({ products: body.products ?? [], priceRules: body.priceRules ?? [] });
      setMessages((current) => [
        ...current,
        { role: "assistant", content: body.answer ?? "ไม่มีคำตอบ" },
      ]);
    } catch (caught) {
      setMessages((current) => [
        ...current,
        {
          role: "assistant",
          content: caught instanceof Error ? caught.message : "Chat request failed",
        },
      ]);
    } finally {
      setLoading(false);
    }
  }

  async function runSync() {
    setSyncing(true);
    setSyncStatus(null);
    try {
      const response = await fetch(jnacPath("/api/sync"), { method: "POST" });
      const body = (await response.json()) as Record<string, number | string>;
      if (!response.ok) throw new Error("Sync failed");
      setSyncStatus(
        `records ${body.output_records}, price rules ${body.product_price_rules}, matched ${body.price_matched_records}`,
      );
    } catch (caught) {
      setSyncStatus(caught instanceof Error ? caught.message : "Sync failed");
    } finally {
      setSyncing(false);
    }
  }

  return (
    <main className="min-h-screen bg-[var(--background)] text-[var(--foreground)]">
      <div className="grid min-h-screen grid-cols-1 lg:grid-cols-[300px_1fr_340px]">
        <aside className="border-b border-[var(--line)] bg-[var(--panel)] p-4 lg:border-b-0 lg:border-r">
          <div className="mb-6 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-md bg-[var(--accent)] text-slate-950">
              <ShieldCheck size={22} />
            </div>
            <div>
              <h1 className="text-base font-semibold">JNAC Admin Chat</h1>
              <p className="text-xs text-[var(--muted)]">{authMode}</p>
            </div>
          </div>
          <div className="space-y-2 text-sm">
            <div className="rounded-md border border-[var(--line)] bg-[var(--panel-2)] p-3">
              <p className="text-xs text-[var(--muted)]">Signed in</p>
              <p className="mt-1 break-all font-medium">{adminEmail}</p>
            </div>
            <button
              type="button"
              onClick={runSync}
              disabled={syncing}
              className="flex h-10 w-full items-center justify-center gap-2 rounded-md border border-[var(--line)] bg-transparent text-sm disabled:opacity-60"
            >
              <RefreshCw size={16} />
              {syncing ? "Syncing" : "Sync now"}
            </button>
            {syncStatus ? <p className="text-xs text-[var(--muted)]">{syncStatus}</p> : null}
            <Link
              href="/history"
              className="flex h-10 items-center justify-center gap-2 rounded-md border border-[var(--line)] text-sm"
            >
              <History size={16} />
              History
            </Link>
            <Link
              href="/logout"
              className="flex h-10 items-center justify-center gap-2 rounded-md border border-[var(--line)] text-sm text-red-200"
            >
              <LogOut size={16} />
              Logout
            </Link>
          </div>
          <div className="mt-8">
            <p className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
              <History size={14} />
              Recent sessions
            </p>
            <div className="space-y-2">
              {initialSessions.slice(0, 8).map((session) => (
                <Link
                  href={`/history/${session.id}`}
                  className="block rounded-md border border-[var(--line)] px-3 py-2 text-sm text-slate-300"
                  key={session.id}
                >
                  {session.title}
                </Link>
              ))}
            </div>
          </div>
        </aside>

        <section className="flex min-h-[70vh] flex-col">
          <header className="border-b border-[var(--line)] px-5 py-4">
            <div className="flex items-center gap-2 text-sm text-[var(--muted)]">
              <Sparkles size={16} />
              ราคาอ่านจาก Product, คงเหลืออ่านจาก Inventory
            </div>
          </header>
          <div className="flex-1 space-y-4 overflow-y-auto px-5 py-5">
            {messages.map((message, index) => (
              <div
                key={`${message.role}-${index}`}
                className={`max-w-3xl whitespace-pre-wrap rounded-lg border px-4 py-3 text-sm leading-6 ${
                  message.role === "user"
                    ? "ml-auto border-[var(--accent)] bg-emerald-500/10"
                    : "border-[var(--line)] bg-[var(--panel)]"
                }`}
              >
                {message.content}
              </div>
            ))}
            {loading ? (
              <div className="max-w-3xl rounded-lg border border-[var(--line)] bg-[var(--panel)] px-4 py-3 text-sm text-[var(--muted)]">
                กำลังค้นข้อมูลและสร้างคำตอบ
              </div>
            ) : null}
          </div>
          <form onSubmit={sendMessage} className="border-t border-[var(--line)] p-4">
            <div className="flex gap-3">
              <textarea
                value={input}
                onChange={(event) => setInput(event.target.value)}
                placeholder="ถามเช่น ราคาจานทรายหลังอ่อน XA911 48P 4นิ้ว #80 หรือ คงเหลือรหัส 2020000027"
                className="min-h-20 flex-1 resize-none rounded-md border border-[var(--line)] bg-[var(--panel)] px-3 py-3 text-sm outline-none focus:border-[var(--accent)]"
              />
              <button
                type="submit"
                disabled={!canSend}
                className="flex w-12 items-center justify-center rounded-md bg-[var(--accent)] text-slate-950 disabled:opacity-60"
                aria-label="Send"
              >
                <Send size={20} />
              </button>
            </div>
          </form>
        </section>

        <aside className="border-t border-[var(--line)] bg-[var(--panel)] p-4 lg:border-l lg:border-t-0">
          <p className="mb-3 flex items-center gap-2 text-sm font-semibold">
            <PackageSearch size={17} />
            Retrieved data
          </p>
          <div className="space-y-4">
            <section>
              <p className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
                <Database size={14} />
                Price rules
              </p>
              <div className="space-y-2">
                {matches.priceRules.map((rule) => (
                  <div
                    key={rule.id}
                    className="rounded-md border border-[var(--line)] bg-[var(--panel-2)] p-3 text-xs leading-5"
                  >
                    <p className="font-medium">{rule.base_name}</p>
                    <p className="text-[var(--muted)]">
                      {rule.grits.map((grit) => `#${grit}`).join(" ")}
                    </p>
                    <p>{rule.price.toLocaleString("th-TH")} บาท/{rule.unit || "หน่วย"}</p>
                  </div>
                ))}
              </div>
            </section>
            <section>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
                Products
              </p>
              <div className="space-y-2">
                {matches.products.map((product) => (
                  <div
                    key={product.product_code}
                    className="rounded-md border border-[var(--line)] bg-[var(--panel-2)] p-3 text-xs leading-5"
                  >
                    <p className="font-mono text-[var(--accent-2)]">{product.product_code}</p>
                    <p className="font-medium">{product.name}</p>
                    <p className="text-[var(--muted)]">
                      ราคา {product.price ?? "ไม่ระบุ"} / คงเหลือ{" "}
                      {product.stock ?? "ไม่ระบุ"} {product.unit}
                    </p>
                  </div>
                ))}
              </div>
            </section>
          </div>
        </aside>
      </div>
    </main>
  );
}
