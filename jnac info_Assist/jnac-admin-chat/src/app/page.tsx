import { redirect } from "next/navigation";

import { getAdminSession } from "@/lib/auth";
import { listChatSessions } from "@/lib/chat-store";
import { ChatShell } from "@/app/chat-shell";

export default async function Home() {
  const session = await getAdminSession();
  if (!session) redirect("/login");

  const sessions = await listChatSessions(session.email);
  return (
    <ChatShell
      adminEmail={session.email}
      authMode={session.authMode}
      initialSessions={sessions}
    />
  );
}
