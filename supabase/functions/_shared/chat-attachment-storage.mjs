export const PRIVATE_CHAT_BUCKET = 'chat-private-attachments';

/** Signed links are delivery capabilities, while bucket/path preserve staff
 * access to history after expiry. Never switch the legacy public bucket. */
export async function uploadPrivateChatAttachment(admin, { path, body, contentType }) {
  if (!path || path.startsWith('/') || path.includes('..')) throw new Error('invalid_attachment_path');
  const bucket = PRIVATE_CHAT_BUCKET;
  const { error } = await admin.storage.from(bucket).upload(path, body, { contentType, upsert: false, cacheControl: '0' });
  if (error) throw error;
  const signed = await admin.storage.from(bucket).createSignedUrl(path, 7 * 86400);
  if (signed.error || !signed.data?.signedUrl) throw signed.error ?? new Error('attachment_sign_failed');
  return { bucket, path, url: signed.data.signedUrl };
}
