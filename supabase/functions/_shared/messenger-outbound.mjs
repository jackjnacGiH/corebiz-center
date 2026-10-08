import { OWNER_TEST } from './facebook-owner-test.mjs';
export function facebookOutboundTarget(room, pageId, publicEnabled = false, now = Date.now()) {
  if (room?.channel !== 'messenger' || room.metadata?.page_id !== pageId) return null;
  const comment = room.metadata?.facebook_surface === 'comment';
  if (!publicEnabled && (comment
    ? room.metadata.comment_id !== OWNER_TEST.commentId || room.metadata.post_id !== OWNER_TEST.postId
    : room.id !== OWNER_TEST.messengerRoom || room.external_id !== OWNER_TEST.messengerSender)) return null;
  if (comment) {
    const commentId = room.metadata.comment_id;
    return /^[0-9]+(?:_[0-9]+)?$/.test(commentId ?? '') ? { surface:'comment',path:`${commentId}/comments` } : null;
  }
  const lastCustomer = Date.parse(room.last_customer_message_at ?? '');
  if (!/^[0-9]+$/.test(room.external_id ?? '') || !Number.isFinite(lastCustomer)
    || lastCustomer > now + 60000 || now - lastCustomer > 24 * 60 * 60 * 1000) return null;
  return { surface:'messenger',path:`${pageId}/messages`,recipient:room.external_id };
}
export function facebookTextParts(text, limit = 1900) {
  if (typeof text !== 'string' || !text.trim() || text.length > 9500) throw new Error('message_out_of_range');
  const chars = [...text.trim()];
  const parts=[];
  for (let i=0;i<chars.length;i+=limit) parts.push(chars.slice(i,i+limit).join(''));
  return parts;
}
