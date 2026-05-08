import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

import {
  getSupabaseAdminClient,
  getSupabaseServerClient,
} from "@/lib/supabase/server";
import type { ChatMessage } from "@/lib/types";

type LocalSession = {
  id: string;
  admin_email: string;
  title: string;
  created_at: string;
  updated_at: string;
  messages: ChatMessage[];
};

const localLogPath = path.resolve(process.cwd(), "data", "dev-chat-log.json");

async function readLocalSessions(): Promise<LocalSession[]> {
  try {
    return JSON.parse(await readFile(localLogPath, "utf8")) as LocalSession[];
  } catch {
    return [];
  }
}

async function writeLocalSessions(sessions: LocalSession[]) {
  await mkdir(path.dirname(localLogPath), { recursive: true });
  await writeFile(localLogPath, JSON.stringify(sessions, null, 2), "utf8");
}

export async function saveChatTurn(params: {
  sessionId?: string | null;
  adminEmail: string;
  question: string;
  answer: string;
  metadata?: Record<string, unknown>;
}) {
  const supabase = getSupabaseAdminClient() ?? (await getSupabaseServerClient());
  const now = new Date().toISOString();
  const title = params.question.slice(0, 90);

  if (supabase) {
    let sessionId = params.sessionId;
    if (!sessionId) {
      const { data, error } = await supabase
        .from("chat_sessions")
        .insert({ admin_email: params.adminEmail, title })
        .select("id")
        .single();
      if (error) throw error;
      sessionId = data.id;
    } else {
      await supabase
        .from("chat_sessions")
        .update({ updated_at: now })
        .eq("id", sessionId);
    }

    const { error } = await supabase.from("chat_messages").insert([
      {
        session_id: sessionId,
        role: "user",
        content: params.question,
        metadata: params.metadata ?? {},
      },
      {
        session_id: sessionId,
        role: "assistant",
        content: params.answer,
        metadata: params.metadata ?? {},
      },
    ]);
    if (error) throw error;
    return sessionId!;
  }

  const sessions = await readLocalSessions();
  let session = params.sessionId
    ? sessions.find((item) => item.id === params.sessionId)
    : undefined;
  if (!session) {
    session = {
      id: randomUUID(),
      admin_email: params.adminEmail,
      title,
      created_at: now,
      updated_at: now,
      messages: [],
    };
    sessions.unshift(session);
  }
  session.updated_at = now;
  session.messages.push(
    { role: "user", content: params.question, created_at: now },
    { role: "assistant", content: params.answer, created_at: now },
  );
  await writeLocalSessions(sessions);
  return session.id;
}

export async function listChatSessions(adminEmail: string) {
  const supabase = getSupabaseAdminClient() ?? (await getSupabaseServerClient());
  if (supabase) {
    const { data, error } = await supabase
      .from("chat_sessions")
      .select("id,title,admin_email,created_at,updated_at")
      .eq("admin_email", adminEmail)
      .order("updated_at", { ascending: false })
      .limit(50);
    if (error) throw error;
    return data ?? [];
  }

  const sessions = await readLocalSessions();
  return sessions
    .filter((session) => session.admin_email === adminEmail)
    .map((session) => ({
      id: session.id,
      admin_email: session.admin_email,
      title: session.title,
      created_at: session.created_at,
      updated_at: session.updated_at,
    }))
    .slice(0, 50);
}

export async function listChatMessages(sessionId: string, adminEmail: string) {
  const supabase = getSupabaseAdminClient() ?? (await getSupabaseServerClient());
  if (supabase) {
    const { data: session, error: sessionError } = await supabase
      .from("chat_sessions")
      .select("id")
      .eq("id", sessionId)
      .eq("admin_email", adminEmail)
      .single();
    if (sessionError || !session) return [];
    const { data, error } = await supabase
      .from("chat_messages")
      .select("id,role,content,created_at")
      .eq("session_id", sessionId)
      .order("created_at", { ascending: true });
    if (error) throw error;
    return data ?? [];
  }

  const sessions = await readLocalSessions();
  return sessions.find((session) => session.id === sessionId)?.messages ?? [];
}
