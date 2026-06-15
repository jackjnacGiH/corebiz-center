/**
 * reprocess-line-files v1 — recover customer file attachments that failed to
 * store (e.g. when the chat-attachments bucket still rejected PDFs). For each
 * content_type='file' message with no file_url, re-download the content from
 * LINE (by external_msg_id), upload it to chat-attachments, and patch the
 * message's content + metadata so it shows a download card in Omni-Chat.
 *
 * One-off / maintenance tool. Key-gated, verify_jwt off. LINE keeps message
 * content for a limited window, so very old messages may no longer be fetchable.
 */
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const KEY = "corebiz_reprocess_files_2026_r7q2";
const MAX_FILE_BYTES = 20 * 1024 * 1024;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);
  if (req.headers.get("x-key") !== KEY) return json({ ok: false, error: "forbidden" }, 403);

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: ch } = await admin.from("line_channels").select("channel_access_token").eq("is_active", true).limit(1).maybeSingle();
  const token = (ch as { channel_access_token?: string } | null)?.channel_access_token;
  if (!token) return json({ ok: false, error: "no_active_channel" }, 500);

  const { data: rows } = await admin
    .from("chat_messages")
    .select("id, external_msg_id, conversation_id, content, metadata")
    .eq("content_type", "file")
    .limit(100);

  const todo = (rows ?? []).filter((r: Record<string, unknown>) => {
    const meta = (r.metadata ?? {}) as Record<string, unknown>;
    return !meta.file_url && r.external_msg_id;
  });

  const results: Array<{ id: string; ok: boolean; reason?: string }> = [];
  for (const r of todo as Array<Record<string, unknown>>) {
    const id = String(r.id);
    const msgId = String(r.external_msg_id);
    const meta = (r.metadata ?? {}) as Record<string, unknown>;
    const fileName = String(meta.file_name ?? `file-${msgId}`);
    try {
      const res = await fetch(`https://api-data.line.me/v2/bot/message/${msgId}/content`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) { results.push({ id, ok: false, reason: `line_${res.status}` }); continue; }
      const mimeType = (res.headers.get("content-type") || "application/octet-stream").split(";")[0].trim();
      const bytes = new Uint8Array(await res.arrayBuffer());
      if (bytes.length === 0 || bytes.length > MAX_FILE_BYTES) { results.push({ id, ok: false, reason: "size" }); continue; }

      const safe = (fileName.replace(/[^\w.\-]+/g, "_") || "file").slice(-80);
      const path = `${String(r.conversation_id)}/${Date.now()}-${safe}`;
      const up = await admin.storage.from("chat-attachments").upload(path, bytes, { contentType: mimeType, upsert: false });
      if (up.error) { results.push({ id, ok: false, reason: up.error.message }); continue; }
      const { data: pub } = admin.storage.from("chat-attachments").getPublicUrl(path);
      const url = pub?.publicUrl;
      if (!url) { results.push({ id, ok: false, reason: "no_url" }); continue; }

      await admin.from("chat_messages").update({
        content: `📎 ${fileName}`,
        metadata: { ...meta, file_url: url, file_size: meta.file_size ?? bytes.length, mime_type: mimeType },
      }).eq("id", id);
      results.push({ id, ok: true });
    } catch (e) {
      results.push({ id, ok: false, reason: (e as Error).message });
    }
  }

  return json({ ok: true, total: todo.length, recovered: results.filter((r) => r.ok).length, results });
});
