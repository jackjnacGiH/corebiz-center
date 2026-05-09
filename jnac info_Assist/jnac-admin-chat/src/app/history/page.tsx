import { History } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { getAdminSession } from "@/lib/auth";
import { listChatSessions } from "@/lib/chat-store";
import { jnacPath } from "@/lib/paths";

export default async function HistoryPage() {
  const session = await getAdminSession();
  if (!session) redirect(jnacPath("/login"));
  const sessions = await listChatSessions(session.email);

  return (
    <main className="min-h-screen bg-[var(--background)] px-5 py-8 text-[var(--foreground)]">
      <div className="mx-auto max-w-4xl">
        <Link className="text-sm text-[var(--accent)]" href="/">
          กลับไปหน้าแชท
        </Link>
        <div className="mt-6 flex items-center gap-3">
          <History size={24} />
          <h1 className="text-2xl font-semibold">ประวัติคำถาม-คำตอบ</h1>
        </div>
        <div className="mt-6 overflow-hidden rounded-lg border border-[var(--line)]">
          {sessions.length ? (
            sessions.map((item) => (
              <Link
                key={item.id}
                href={`/history/${item.id}`}
                className="block border-b border-[var(--line)] bg-[var(--panel)] px-4 py-3 last:border-b-0 hover:bg-[var(--panel-2)]"
              >
                <p className="font-medium">{item.title}</p>
                <p className="mt-1 text-xs text-[var(--muted)]">
                  {new Date(item.updated_at).toLocaleString("th-TH")}
                </p>
              </Link>
            ))
          ) : (
            <p className="bg-[var(--panel)] px-4 py-8 text-sm text-[var(--muted)]">
              ยังไม่มีประวัติ
            </p>
          )}
        </div>
      </div>
    </main>
  );
}
