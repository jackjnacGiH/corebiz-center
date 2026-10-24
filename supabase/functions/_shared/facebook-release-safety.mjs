export const JNAC_PAGE_ID = '103826764792590';
export function jnacRoomMatches(pageId, room, event) {
  if (pageId !== JNAC_PAGE_ID || room?.channel !== 'messenger' || room.metadata?.page_id !== pageId) return false;
  if (event.kind === 'message') return room.metadata?.facebook_surface === 'messenger' && room.external_id === event.senderId;
  return event.kind === 'comment' && room.metadata?.facebook_surface === 'comment'
    && room.metadata?.comment_id === event.commentId && room.metadata?.post_id === event.postId
    && room.external_id === `comment:${pageId}:${event.commentId}` && event.postId.startsWith(`${pageId}_`);
}
export function conservativeHoursAnswer(query) {
  return /(?:เปิด.*กี่โมง|เวลาทำการ|เปิดทำการ|วันหยุด|opening\s*hours|business\s*hours|public\s*holiday)/iu.test(query)
    ? 'ข้อมูลเวลาเปิดทำการในระบบยังไม่ตรงกันค่ะ ขอให้เจ้าหน้าที่ยืนยันเวลาที่ถูกต้องก่อนนะคะ' : null;
}
export function facebookQuery(text, prefix) {
  return text.startsWith(prefix) ? text.slice(prefix.length).replace(/^\s*[:：-]\s*/, '').trim() : text;
}
