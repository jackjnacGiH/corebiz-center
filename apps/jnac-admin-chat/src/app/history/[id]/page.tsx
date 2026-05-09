import { redirect } from "next/navigation";
import Link from "next/link";

import { getAdminSession } from "@/lib/auth";
import { listChatMessages } from "@/lib/chat-store";
import { jnacPath } from "@/lib/paths";

export default async function HistoryDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await getAdminSession();
  if (!session) redirect(jnacPath("/login"));

  const { id } = await params;
  const messages = await listChatMessages(id, session.email);

  return (
    <main className="min-h-screen bg-[var(--background)] px-5 py-8 text-[var(--foreground)]">
      <div className="mx-auto max-w-4xl">
        <Link className="text-sm text-[var(--accent)]" href="/history">
          กลับไปประวัติทั้งหมด
        </Link>
        <h1 className="mt-6 text-2xl font-semibold">รายละเอียดบทสนทนา</h1>
        <div className="mt-6 space-y-4">
          {messages.map((message, index) => (
            <div
              key={message.id ?? index}
              className={`whitespace-pre-wrap rounded-lg border px-4 py-3 text-sm leading-6 ${
                message.role === "user"
                  ? "border-[var(--accent)] bg-emerald-500/10"
                  : "border-[var(--line)] bg-[var(--panel)]"
              }`}
            >
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
                {message.role}
              </p>
              {message.content}
            </div>
          ))}
          {!messages.length ? (
            <p className="rounded-lg border border-[var(--line)] bg-[var(--panel)] px-4 py-8 text-sm text-[var(--muted)]">
              ไม่พบข้อความ หรือคุณไม่มีสิทธิ์อ่าน session นี้
            </p>
          ) : null}
        </div>
      </div>
    </main>
  );
}
