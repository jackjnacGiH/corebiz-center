/** Authorize before privileged lookups, secrets, model calls, or writes.
 * @param {string | null} [serviceKey=null]
 */
export async function requireStaff(admin, req, roles = ['owner', 'admin'], serviceKey = null) {
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
  if (!token) return { error: 'unauthorized', status: 401 };
  // Only internal embedding callers opt into this exact secret comparison.
  if (serviceKey && token === serviceKey) return { actor: { id: null, role: 'service_role' } };
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data?.user || data.user.is_anonymous) return { error: 'unauthorized', status: 401 };
  const profile = await admin.from('profiles').select('id,role,is_active').eq('id', data.user.id).maybeSingle();
  if (profile.error) return { error: 'authorization_unavailable', status: 503 };
  if (!profile.data?.is_active || !roles.includes(profile.data.role)) return { error: 'forbidden', status: 403 };
  return { actor: profile.data };
}

export function embeddingInputError(texts, model, allowedModel = 'text-embedding-3-small') {
  if (model && model !== allowedModel) return 'embedding_model_not_allowed';
  if (!Array.isArray(texts) || texts.length < 1 || texts.length > 100) return 'texts_batch_out_of_range';
  if (texts.some(text => typeof text !== 'string' || !text.trim() || text.length > 12000)) return 'text_out_of_range';
  if (texts.reduce((sum, text) => sum + text.length, 0) > 200000) return 'embedding_batch_too_large';
  return null;
}

export function knowledgeInputError(body, sourceRequired = false) {
  if (!body || typeof body !== 'object') return 'invalid_knowledge_input';
  for (const [field, limit, required] of [['title', 200, true], ['content', 200000, true], ['source_path', 512, sourceRequired], ['category', 120, false]]) {
    const value = body[field];
    if ((required && (typeof value !== 'string' || !value.trim())) || (value !== undefined && (typeof value !== 'string' || value.length > limit))) return `invalid_${field}`;
  }
  if (body.language !== undefined && !['th', 'en', 'mixed'].includes(body.language)) return 'invalid_language';
  if (body.visibility !== undefined && !['public', 'internal'].includes(body.visibility)) return 'invalid_visibility';
  if (body.tags !== undefined && (!Array.isArray(body.tags) || body.tags.length > 50 || body.tags.some(tag => typeof tag !== 'string' || tag.length > 80))) return 'invalid_tags';
  return null;
}
