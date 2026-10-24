const LEASE_MS = 120_000;
const WAIT_MS = 30_000;

/** Atomic compare-and-swap on the existing conversation row. No process-local
 * mutex: independent Edge isolates must agree before any tools or reply run. */
export async function acquireConversationTurn(admin, conversationId, { inheritedToken = null, now = Date.now, wait = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
  const deadline = now() + WAIT_MS;
  while (true) {
    const { data: row, error } = await admin.from("chat_conversations")
      .select("bot_turn_token,bot_turn_until,bot_turn_revision,bot_enabled").eq("id", conversationId).maybeSingle();
    if (error || !row) throw Error("conversation_turn_unavailable");
    if (inheritedToken) {
      if (row.bot_turn_token !== inheritedToken || Date.parse(row.bot_turn_until) <= now()) throw Error("conversation_turn_stale");
      return { token: inheritedToken, revision: row.bot_turn_revision, owned: false };
    }
    if (!row.bot_turn_token || !row.bot_turn_until || Date.parse(row.bot_turn_until) <= now()) {
      const token = crypto.randomUUID();
      let claim = admin.from("chat_conversations").update({ bot_turn_token: token,
        bot_turn_until: new Date(now() + LEASE_MS).toISOString(), bot_turn_revision: Number(row.bot_turn_revision ?? 0) + 1 })
        .eq("id", conversationId).eq("bot_turn_revision", row.bot_turn_revision ?? 0);
      claim = row.bot_turn_token ? claim.eq("bot_turn_token", row.bot_turn_token) : claim.is("bot_turn_token", null);
      const result = await claim.select("bot_turn_token,bot_turn_revision").maybeSingle();
      if (result.error) throw Error("conversation_turn_unavailable");
      if (result.data?.bot_turn_token === token) return { token, revision: result.data.bot_turn_revision, owned: true };
    }
    if (now() >= deadline) throw Error("conversation_turn_busy_retryable");
    await wait(200);
  }
}

export async function currentConversationTurn(admin, conversationId, token) {
  const { data, error } = await admin.from("chat_conversations")
    .select("bot_turn_token,bot_turn_until,bot_enabled").eq("id", conversationId).maybeSingle();
  if (error || !data || data.bot_turn_token !== token || Date.parse(data.bot_turn_until) <= Date.now()) return false;
  return data.bot_enabled !== false;
}

export async function releaseConversationTurn(admin, conversationId, lease) {
  if (!lease.owned) return;
  const { error } = await admin.from("chat_conversations")
    .update({ bot_turn_token: null, bot_turn_until: null }).eq("id", conversationId).eq("bot_turn_token", lease.token);
  if (error) console.warn("conversation turn release failed; expiry will recover the lease");
}

export async function withConversationTurn(admin, conversationId, work, options = {}) {
  const lease = await acquireConversationTurn(admin, conversationId, options);
  try { return await work(lease); }
  finally { await releaseConversationTurn(admin, conversationId, lease); }
}
