import fs from 'node:fs/promises';

const url = process.env.SUPABASE_URL;
const anon = process.env.SUPABASE_ANON_KEY;
if (!url || !anon) {
  console.error('Set SUPABASE_URL and SUPABASE_ANON_KEY before running the evaluation.');
  process.exit(2);
}

const cases = JSON.parse(await fs.readFile(new URL('./omnichat-rag-eval-cases.json', import.meta.url), 'utf8'));
let failed = 0;
for (const test of cases) {
  const query = test.query === '__GENERATE_4001__' ? 'ก'.repeat(4001) : test.query;
  const res = await fetch(`${url}/functions/v1/rag-chat`, {
    method: 'POST',
    headers: { apikey: anon, Authorization: `Bearer ${anon}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, stream: false, channel: 'default', match_count: 5, match_threshold: 0.3 }),
  });
  let body = {};
  try { body = await res.json(); } catch { /* assertion below reports it */ }
  const calls = Array.isArray(body.tool_calls) ? body.tool_calls.map((c) => c.name) : [];
  const answer = String(body.answer ?? body.error ?? '');
  const e = test.expect;
  const checks = [
    !e.status || res.status === e.status,
    !e.blocked || body.blocked === 'cost_query',
    !e.tool || calls.includes(e.tool),
    !e.tool_any || e.tool_any.some((name) => calls.includes(name)),
    !e.forbid_tool || !calls.includes(e.forbid_tool),
    !e.source || (Array.isArray(body.sources) && body.sources.length > 0),
    !e.require_terms || e.require_terms.every((term) => answer.includes(term)),
    !e.forbid_terms || e.forbid_terms.every((term) => !answer.includes(term)),
  ];
  const ok = checks.every(Boolean);
  if (!ok) failed += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${test.id} status=${res.status} tools=${calls.join(',') || '-'} sources=${body.sources?.length ?? 0}`);
}

console.log(`\n${cases.length - failed}/${cases.length} passed`);
process.exitCode = failed ? 1 : 0;
