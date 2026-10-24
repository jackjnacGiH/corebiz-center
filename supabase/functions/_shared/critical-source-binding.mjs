// Approval stores source references and exact selectors, never a second master.
// The owner reviews the existing source; the runtime reads it again on each use.
const keys = ["legal_name", "registered_address", "bank_name", "account_name", "account_number", "account_type"];
const sha256 = async text => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)))].map(x => x.toString(16).padStart(2, "0")).join("");

export async function resolveSourceBinding(binding, settings, chunks) {
  if (binding?.schema_version !== 2 || !Array.isArray(binding.records) || binding.records.length !== 1) return null;
  const row = binding.records[0];
  if (!Array.isArray(row.sources) || !row.sources.length || row.sources.length > 32 || !row.fields) return null;
  const paths = new Set(row.sources.filter(source => source.kind === "knowledge_chunk").map(source => source.source_path));
  if (chunks.some(chunk => paths.has(chunk.source_path) && !row.sources.some(source => source.kind === "knowledge_chunk" && source.id === chunk.id))) return null;
  const texts = new Map();
  for (const source of row.sources) {
    if (!source?.key || texts.has(source.key) || !/^[a-f0-9]{64}$/.test(source.sha256 ?? "")) return null;
    let text;
    if (source.kind === "org_settings") {
      if (!["business_name", "address"].includes(source.field)) return null;
      text = settings[source.field];
    } else if (source.kind === "knowledge_chunk") {
      const matches = chunks.filter(chunk => chunk.source_path === source.source_path && chunk.chunk_index === source.chunk_index);
      if (matches.length !== 1) return null;
      const chunk = matches[0];
      if (chunk.id !== source.id || chunk.updated_at !== source.updated_at || chunk.content_hash !== source.content_hash
        || chunk.visibility !== "public" || chunk.language !== "th") return null;
      text = chunk.content;
    } else return null;
    if (typeof text !== "string" || await sha256(text) !== source.sha256) return null;
    texts.set(source.key, text);
  }
  const fields = {};
  for (const key of keys) {
    const selectors = row.fields[key];
    // All explicitly bound corroborating sources must agree byte for byte.
    if (!Array.isArray(selectors) || !selectors.length || selectors.length > 8) return null;
    const values = [];
    for (const selector of selectors) {
      const text = texts.get(selector.source);
      if (typeof text !== "string" || !Number.isSafeInteger(selector.start) || !Number.isSafeInteger(selector.end)
        || selector.start < 0 || selector.end <= selector.start || selector.end > [...text].length) return null;
      values.push([...text].slice(selector.start, selector.end).join(""));
    }
    if (values.some(value => value !== values[0])) return null;
    fields[key] = values[0];
  }
  if (fields.account_name !== fields.legal_name) return null;
  return { schema_version: 1, records: [{ ...row, legal_name: fields.legal_name, registered_address: fields.registered_address,
    bank_accounts: [{ bank_name: fields.bank_name, account_name: fields.account_name, account_number: fields.account_number, account_type: fields.account_type }] }] };
}

export { sha256 as sourceDigest };
