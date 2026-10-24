import { createCriticalReview, hasCriticalClaim } from './critical-company-info.mjs';

export async function runDurableChatDelivery(admin, { channel, eventKey, process, replay }) {
  const claim = await admin.rpc('claim_chat_delivery_event', { p_channel: channel, p_event_key: eventKey });
  if (claim.error) throw claim.error;
  let row = claim.data;
  if (!row || row.action === 'busy') throw new Error('delivery_busy');
  if (row.action === 'completed' || row.action === 'review') return row.state;
  const context = {
    requestId: row.request_id,
    conversationId: row.conversation_id,
    async update(state, fields = {}) {
      const result = await admin.rpc('update_chat_delivery_event', {
        p_channel: channel, p_event_key: eventKey, p_claim_token: row.claim_token,
        p_state: state, p_conversation_id: context.conversationId,
        p_reply_text: fields.text ?? null, p_reply_metadata: fields.metadata ?? null,
        p_error: fields.error ?? null,
      });
      if (result.error) throw result.error;
      row = { ...row, ...result.data };
    },
    async send(text, metadata, deliver) {
      // Persist before crossing the external mutation boundary. If the network
      // outcome is unknown, a retry must never generate or publish twice.
      await context.update('sending', { text, metadata });
      let delivered;
      try { delivered = await deliver(text); }
      catch (cause) {
        await context.update('delivery_unknown', { error: 'external_send_outcome_unknown' });
        throw cause;
      }
      if (!delivered) {
        await context.update('reply_pending', { error: 'external_send_rejected' });
        throw new Error('external_send_rejected');
      }
      // History and ledger completion commit together. If this transaction
      // fails after the provider accepted, 'sending' requires review.
      const completed = await admin.rpc('complete_chat_delivery_event', {
        p_channel: channel, p_event_key: eventKey, p_claim_token: row.claim_token,
      });
      if (completed.error) throw completed.error;
      row = { ...row, ...completed.data };
      return true;
    },
  };
  try {
    // Prepared old bot replies bypass RAG on retry. Never replay stale bank,
    // company or handoff claims as though today's master/receipt validated them.
    // Human-authored outbound messages retain their explicit staff retry path.
    if (row.reply_text && !row.reply_metadata?.staff_message_id
      && (row.reply_metadata?.critical_response === true || hasCriticalClaim(row.reply_text))) {
      await createCriticalReview(admin, { conversationId: row.conversation_id, channel,
        query: `Prepared bot reply held for staff review; event ${eventKey}`,
        kind: 'company_payment', readOnly: false });
      await context.update('processing_unknown', { error: 'critical_reply_replay_requires_review' });
      return 'processing_unknown';
    }
    if (row.reply_text) await replay(context, row);
    else await process(context);
    if (!['delivered', 'delivery_unknown', 'processing_unknown', 'reply_pending'].includes(row.state)) await context.update('ignored');
    return row.state;
  } catch (cause) {
    if (!['sending','delivery_unknown','delivered','reply_pending'].includes(row.state)) {
      await context.update(row.reply_metadata?.work_started ? 'processing_unknown' : 'failed', { error: 'processing_failed' });
    }
    throw cause;
  }
}
