import { resolveSourceBinding, sourceDigest } from "./critical-source-binding.mjs";

export const PAYMENT_SOURCE = "faq/2026-05/เลขบัญชี-โอนเงิน-ชำระเงิน.md";
export const LOCATION_SOURCE = "faq/2026-05/แผนที่-location.md";
export const SOURCE_PATHS = [PAYMENT_SOURCE, LOCATION_SOURCE];

// Fixed source adapters, not LLM extraction. A format change needs review.
// Source values are not hardcoded and this function never grants approval.
export async function prepareCriticalSourceBinding(settings, chunks) {
  if (!settings || typeof settings.business_name !== "string" || typeof settings.address !== "string") throw Error("missing_org_fields");
  if (!Array.isArray(chunks) || chunks.length < 2 || chunks.length > 30) throw Error("missing_sources");
  const sources = [], fields = {};
  for (const field of ["business_name", "address"]) sources.push({ key: field, kind: "org_settings", field, sha256: await sourceDigest(settings[field]) });
  const bind = (field, key, text, value) => {
    const start = text.indexOf(value);
    if (!value || start < 0 || text.indexOf(value, start + value.length) >= 0) throw Error(`ambiguous_${field}`);
    const offset = [...text.slice(0, start)].length;
    (fields[field] ??= []).push({ source: key, start: offset, end: offset + [...value].length });
  };
  bind("legal_name", "business_name", settings.business_name, settings.business_name);
  bind("registered_address", "address", settings.address, settings.address);
  let bankCount = 0, nameCount = 0, locationNameCount = 0;
  for (const chunk of [...chunks].sort((a,b) => (a.source_path < b.source_path ? -1 : a.source_path > b.source_path ? 1 : 0) || a.chunk_index - b.chunk_index)) {
    if (!SOURCE_PATHS.includes(chunk.source_path) || chunk.visibility !== "public" || chunk.language !== "th") throw Error("unexpected_source");
    const key = `kb${sources.length}`;
    sources.push({ key, kind: "knowledge_chunk", id: chunk.id, source_path: chunk.source_path, chunk_index: chunk.chunk_index,
      content_hash: chunk.content_hash, updated_at: chunk.updated_at, sha256: await sourceDigest(chunk.content) });
    const names = [...chunk.content.matchAll(/บริษัท[^\n<>]*?จำกัด/gu)].map(match => match[0]);
    if (names.some(name => name !== settings.business_name)) throw Error("conflicting_company_name");
    if (names.length > 1) throw Error("ambiguous_company_name");
    if (names.length === 1) {
      bind("legal_name", key, chunk.content, names[0]);
      if (chunk.source_path === PAYMENT_SOURCE) { bind("account_name", key, chunk.content, names[0]); nameCount++; }
      else locationNameCount++;
    }
    if (chunk.source_path === PAYMENT_SOURCE) {
      const banks = [...chunk.content.matchAll(/ธ\.([^\n]+?)\s+เลขที่\s+([0-9][0-9 -]+[0-9])\s*\(([^()\n]+)\)/gu)];
      for (const match of banks) {
        bind("bank_name", key, chunk.content, match[1]);
        bind("account_number", key, chunk.content, match[2]);
        bind("account_type", key, chunk.content, match[3]);
        bankCount++;
      }
    }
  }
  if (bankCount !== 1 || nameCount !== 1 || locationNameCount !== 1) throw Error("missing_or_ambiguous_payment_source");
  const binding = { schema_version: 2, records: [{ active: true, status: "draft", revision: "source-binding-v2", source_ref: SOURCE_PATHS.join("; "), sources, fields }] };
  const resolved = await resolveSourceBinding(binding, settings, chunks);
  if (!resolved) throw Error("source_binding_invalid");
  return { binding, preview: { legal_name: resolved.records[0].legal_name, registered_address: resolved.records[0].registered_address, bank_accounts: resolved.records[0].bank_accounts }, digest: await sourceDigest(JSON.stringify(binding)) };
}
