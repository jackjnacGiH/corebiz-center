/**
 * Storage helpers for the `products` bucket (Supabase Storage).
 *
 * Bucket settings (see migration `create_products_storage_bucket`):
 *   - public read (so <img src> works without signing)
 *   - 5 MB max per file
 *   - only image/jpeg|png|webp|gif allowed
 *   - authenticated users (admin/staff) may upload/update/delete
 */
import { supabase } from './supabase';

const BUCKET = 'products';
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

function extFor(file: File): string {
    // Prefer real extension from filename, fall back to MIME map
    const m = file.name.toLowerCase().match(/\.([a-z0-9]+)$/);
    if (m) return m[1];
    switch (file.type) {
        case 'image/jpeg': return 'jpg';
        case 'image/png':  return 'png';
        case 'image/webp': return 'webp';
        case 'image/gif':  return 'gif';
        default: return 'bin';
    }
}

/**
 * Validate a file before upload. Throws if invalid.
 */
export function validateImage(file: File): void {
    if (!ALLOWED_TYPES.includes(file.type)) {
        throw new Error(
            `ไฟล์ ${file.name} ไม่รองรับ — ใช้ได้แค่ JPG / PNG / WebP / GIF`,
        );
    }
    if (file.size > MAX_FILE_SIZE) {
        throw new Error(
            `ไฟล์ ${file.name} ใหญ่เกิน 5 MB (ตอนนี้ ${(file.size / 1024 / 1024).toFixed(1)} MB)`,
        );
    }
}

/**
 * Upload one image and return its public URL.
 *
 * `productKey` is used to namespace files (typically the product `id` for
 * existing products, or `pending-{random}` for unsaved drafts).
 */
export async function uploadProductImage(file: File, productKey: string): Promise<string> {
    validateImage(file);

    const ext = extFor(file);
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const path = `${productKey}/${stamp}.${ext}`;

    const { error: uploadErr } = await supabase.storage
        .from(BUCKET)
        .upload(path, file, {
            cacheControl: '31536000', // 1 year
            upsert: false,
            contentType: file.type,
        });

    if (uploadErr) throw uploadErr;

    const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
    return data.publicUrl;
}

/** Upload the company logo (for quotation/bill headers) → returns public URL. */
export async function uploadOrgLogo(file: File): Promise<string> {
    validateImage(file);
    const ext = extFor(file);
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const path = `org/logo-${stamp}.${ext}`;
    const { error: uploadErr } = await supabase.storage
        .from(BUCKET)
        .upload(path, file, { cacheControl: '31536000', upsert: false, contentType: file.type });
    if (uploadErr) throw uploadErr;
    const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
    return data.publicUrl;
}

const CHAT_BUCKET = 'chat-attachments';

/**
 * Upload one chat attachment image and return its public URL.
 *
 * Used by the Omni-Chat composer for both device uploads and clipboard
 * paste / screen-crop (Ctrl+V of a screenshot). Files are namespaced by
 * conversation id. The returned public URL is embedded into the outgoing
 * message as markdown `![image](url)` — line-push then turns it into a
 * native LINE image message, and the web widget renders it inline.
 *
 * Reuses the same `validateImage` guard (JPG/PNG/WebP/GIF, ≤5 MB) as
 * product uploads.
 */
export async function uploadChatImage(file: File, conversationId: string): Promise<string> {
    validateImage(file);

    const ext = extFor(file);
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const path = `${conversationId}/${stamp}.${ext}`;

    const { error: uploadErr } = await supabase.storage
        .from(CHAT_BUCKET)
        .upload(path, file, {
            cacheControl: '31536000', // 1 year
            upsert: false,
            contentType: file.type,
        });

    if (uploadErr) throw uploadErr;

    const { data } = supabase.storage.from(CHAT_BUCKET).getPublicUrl(path);
    return data.publicUrl;
}

const MAX_CHAT_FILE_SIZE = 20 * 1024 * 1024; // 20 MB (chat-attachments bucket limit)

export interface UploadedChatFile { url: string; name: string; size: number; type: string; }

/** Validate a non-image chat attachment (PDF/doc/etc.) before upload. */
export function validateChatFile(file: File): void {
    if (file.size > MAX_CHAT_FILE_SIZE) {
        throw new Error(`ไฟล์ ${file.name} ใหญ่เกิน 20 MB (ตอนนี้ ${(file.size / 1024 / 1024).toFixed(1)} MB)`);
    }
}

/**
 * Upload a document (PDF/docs/etc.) the admin attaches in Omni-Chat to the
 * public chat-attachments bucket. Keeps the original filename for display; the
 * storage path is ASCII-sanitised + timestamped. The returned URL is shown as a
 * file card in Omni-Chat and (for LINE) sent to the customer as a link, since
 * the LINE Messaging API can't push file messages.
 */
export async function uploadChatFile(file: File, conversationId: string): Promise<UploadedChatFile> {
    validateChatFile(file);
    const safe = (file.name.replace(/[^\w.\-]+/g, '_') || 'file').slice(-80);
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const path = `${conversationId}/${stamp}-${safe}`;
    const { error: uploadErr } = await supabase.storage
        .from(CHAT_BUCKET)
        .upload(path, file, { cacheControl: '31536000', upsert: false, contentType: file.type || 'application/octet-stream' });
    if (uploadErr) throw uploadErr;
    const { data } = supabase.storage.from(CHAT_BUCKET).getPublicUrl(path);
    return { url: data.publicUrl, name: file.name, size: file.size, type: file.type || 'application/octet-stream' };
}

/**
 * Best-effort delete by public URL. Silently ignores errors (cleanup task).
 *
 * Parses the storage object path out of the public URL, e.g.:
 *   https://xxx.supabase.co/storage/v1/object/public/products/abc/123.jpg
 *                                                       ^^^^^^^^^^^^^^^^^^ path
 */
export async function deleteProductImage(publicUrl: string): Promise<void> {
    try {
        const marker = `/object/public/${BUCKET}/`;
        const idx = publicUrl.indexOf(marker);
        if (idx === -1) return;
        const path = publicUrl.slice(idx + marker.length);
        if (!path) return;
        await supabase.storage.from(BUCKET).remove([path]);
    } catch {
        // Cleanup failures shouldn't block UI
    }
}
