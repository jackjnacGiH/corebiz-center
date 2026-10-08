import { supabase } from './supabase';

export const PRIVATE_CHAT_BUCKET = 'chat-private-attachments';

/** Historical signed links keep their path after token expiry. Re-sign them
 * through the logged-in staff's RLS rather than persisting long-lived tokens. */
export async function resolveChatAttachmentUrl(url: string): Promise<string> {
    let parsed: URL;
    try { parsed = new URL(url); } catch { return url; }
    const match = parsed.pathname.match(/^\/storage\/v1\/object\/sign\/chat-private-attachments\/(.+)$/);
    if (!match) return url;
    const path = decodeURIComponent(match[1]);
    const { data, error } = await supabase.storage.from(PRIVATE_CHAT_BUCKET).createSignedUrl(path, 300);
    if (error || !data?.signedUrl) throw error ?? new Error('ไม่สามารถเปิดไฟล์แนบได้');
    return data.signedUrl;
}
