export interface ConversationCursor { lastMessageAt: string | null; createdAt: string; id: string }

/** Ordered exactly as the DB: last_message_at DESC NULLS LAST, created_at DESC, id DESC. */
export function conversationCursorFilter(cursor: ConversationCursor): string {
  const olderCreation = `created_at.lt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.lt.${cursor.id})`;
  if (cursor.lastMessageAt === null) return `and(last_message_at.is.null,or(${olderCreation}))`;
  return `last_message_at.lt.${cursor.lastMessageAt},and(last_message_at.eq.${cursor.lastMessageAt},or(${olderCreation})),last_message_at.is.null`;
}

/** Escape reserved filter syntax as well as LIKE wildcards in a user search. */
export function inboxSearchPattern(term: string): string {
  const escaped = term.replace(/[%_]/g, (value) => `\\${value}`).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return `"%${escaped}%"`;
}
