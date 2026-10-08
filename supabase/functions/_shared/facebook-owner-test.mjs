// Fixed owner Messenger room and owner technical tests on the approved post only.
export const OWNER_TEST = Object.freeze({
  ownerAutoTestEnabled: true, // Explicit owner-only automatic test approval; DB kill switches still apply.
  pageId: '103826764792590',
  messengerRoom: '16b60bf0-6d41-4c56-a7c6-095ca9dd120d',
  messengerSender: '3741480519195393',
  commentRoom: '3dee9468-98f9-43af-94c6-143f6c67606f',
  commentId: '1710900114377457_936353852519068',
  postId: '103826764792590_1710900114377457',
  commentAuthor: '3741480519195393', // Verified signed event 75e90e07-efa8-4e54-938a-ccbc8318f741.
  commentPrefix: 'ทดสอบบอทคอมเมนต์ JNAC เจ้าของ',
});

export function ownerTestAllowed(pageId, room, event, verifiedCommentAuthor = '', commentTestsEnabled = false) {
  if (pageId !== OWNER_TEST.pageId || room?.channel !== 'messenger'
    || room.metadata?.page_id !== OWNER_TEST.pageId || !event) return false;
  if (event.kind === 'message') return room.id === OWNER_TEST.messengerRoom
    && room.metadata?.facebook_surface === 'messenger'
    && room.external_id === OWNER_TEST.messengerSender
    && event.senderId === OWNER_TEST.messengerSender;
  // Must be populated only after resolving the author from a legitimate event.
  return commentTestsEnabled === true && event.kind === 'comment' && verifiedCommentAuthor === OWNER_TEST.commentAuthor
    && room.metadata?.facebook_surface === 'comment' && room.metadata?.post_id === OWNER_TEST.postId
    && room.external_id === `comment:${OWNER_TEST.pageId}:${event.commentId}`
    && room.metadata?.comment_id === event.commentId && event.postId === OWNER_TEST.postId
    && String(event.text).startsWith(OWNER_TEST.commentPrefix)
    && event.authorId === verifiedCommentAuthor;
}

export function safeOwnerTestAnswer(text) {
  // Owner test is informational only: no quotes, payments, discounts, guarantees,
  // operating/safety advice or promises. Uncertain answers remain with staff.
  return typeof text === 'string' && !!text.trim()
    && !/(?:ใบเสนอราคา|บัญชี|โอนเงิน|ชำระ|ส่วนลด|รับประกัน|ยืนยันคำสั่งซื้อ|ส่งภายใน|จัดส่งภายใน|ความเร็วรอบ|ปลอดภัย|ห้าม|ควรใช้|ต้องใช้|quotation|bank|payment|discount|guarantee|warranty|promise|safe to|rpm)/iu.test(text);
}

export function normalizedMessengerProfile(data) {
  const name = [data?.first_name, data?.last_name].filter(x => typeof x === 'string')
    .map(x => x.trim()).filter(Boolean).join(' ').slice(0, 160);
  let avatar = null;
  try {
    const url = new URL(data?.profile_pic);
    if (url.protocol === 'https:' && !url.username && !url.password
      && (/(?:^|\.)(?:fbcdn\.net|facebook\.com)$/.test(url.hostname)
        || url.hostname === 'platform-lookaside.fbsbx.com')) avatar = url.href;
  } catch { /* leave real UI fallback */ }
  return { name: name || null, avatar };
}
