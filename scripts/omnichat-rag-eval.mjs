import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const casesUrl = new URL('./omnichat-rag-eval-cases.json', import.meta.url);
const cases = JSON.parse(await fs.readFile(casesUrl, 'utf8'));
const usage = `Usage:
  node scripts/omnichat-rag-eval.mjs [--case <id> | --case=<id>]...
  node scripts/omnichat-rag-eval.mjs --self-test

Safe SA331 example:
  node scripts/omnichat-rag-eval.mjs --case sa331-needs-variant --case sa331-refined --case sa331-follow-up

Options:
  --case <id>   Run only the named evaluation case. Repeat to select more cases.
  --self-test   Run offline assertion and CLI-filter checks; does not call rag-chat.
  --help, -h    Show this help.

Live evaluation requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.
Every live request uses the internal read-only evaluation mode.`;

const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const normalText = (value) => String(value ?? '').normalize('NFKC').toLowerCase();
const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function parseCliArgs(argv) {
  const options = { caseIds: [], selfTest: false, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--self-test') {
      options.selfTest = true;
    } else if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else if (arg === '--case') {
      const id = argv[index + 1];
      if (!id || id.startsWith('-')) throw new Error('--case requires a case id');
      options.caseIds.push(id.trim());
      index += 1;
    } else if (arg.startsWith('--case=')) {
      const id = arg.slice('--case='.length).trim();
      if (!id) throw new Error('--case requires a case id');
      options.caseIds.push(id);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (options.selfTest && options.caseIds.length > 0) {
    throw new Error('--case cannot be combined with --self-test');
  }
  return options;
}

function selectCases(allCases, caseIds) {
  if (caseIds.length === 0) return allCases;
  const byId = new Map(allCases.map((test) => [test.id, test]));
  const missing = [...new Set(caseIds.filter((id) => !byId.has(id)))];
  if (missing.length > 0) {
    throw new Error(`Unknown case id: ${missing.join(', ')}\nAvailable case ids: ${allCases.map((test) => test.id).join(', ')}`);
  }
  return [...new Set(caseIds)].map((id) => byId.get(id));
}

function containsToken(text, token) {
  const haystack = normalText(text);
  const needle = normalText(token).trim();
  if (!needle) return true;
  if (!/[\p{L}\p{N}]/u.test(needle)) return haystack.includes(needle);
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegExp(needle)}(?=$|[^\\p{L}\\p{N}])`, 'iu').test(haystack);
}

function containsModel(text, model) {
  const normalized = String(model ?? '').normalize('NFKC').toUpperCase().replace(/[^A-Z0-9]+/g, '');
  if (!normalized) return true;
  const groups = normalized.match(/[A-Z]+|\d+/g) ?? [normalized];
  const pattern = groups.map(escapeRegExp).join('[\\s._/-]*');
  return new RegExp(`(^|[^A-Z0-9])${pattern}(?=$|[^A-Z0-9])`, 'iu').test(String(text ?? '').normalize('NFKC'));
}

function containsSize(text, size) {
  const value = escapeRegExp(String(size ?? '').trim());
  if (!value) return true;
  return new RegExp(`(^|[^\\d.])${value}(?:\\.0+)?\\s*(?:\"|''|in(?:ch(?:es)?)?|นิ้ว)(?=$|[^\\p{L}\\p{N}.])`, 'iu')
    .test(String(text ?? '').normalize('NFKC'));
}

function containsGrit(text, grit) {
  const value = escapeRegExp(String(grit ?? '').replace(/^#/, '').trim());
  if (!value) return true;
  return new RegExp(`(?:#|เบอร์\\s*#?|grit\\s*#?)\\s*${value}(?!\\d)`, 'iu')
    .test(String(text ?? '').normalize('NFKC'));
}

function assertFindProducts(test, toolCalls, failures) {
  const expected = test.expect?.find_products;
  if (!expected) return;

  const call = toolCalls.find((item) => item?.name === 'find_products');
  if (!call) {
    failures.push('find_products call is missing');
    return;
  }

  const query = String(call.args?.query ?? '');
  const argsExpectation = expected.args ?? {};
  for (const token of argsExpectation.require_tokens ?? []) {
    if (!containsToken(query, token)) failures.push(`find_products query is missing token ${JSON.stringify(token)}`);
  }
  if (argsExpectation.model && !containsModel(query, argsExpectation.model)) {
    failures.push(`find_products query is missing model ${JSON.stringify(argsExpectation.model)}`);
  }
  if (argsExpectation.size && !containsSize(query, argsExpectation.size)) {
    failures.push(`find_products query is missing size ${JSON.stringify(argsExpectation.size)}`);
  }
  if (argsExpectation.grit && !containsGrit(query, argsExpectation.grit)) {
    failures.push(`find_products query is missing grit ${JSON.stringify(argsExpectation.grit)}`);
  }

  const resultExpectation = expected.result;
  if (!resultExpectation) return;
  const meta = call.result_meta;
  if (!isRecord(meta)) {
    failures.push('find_products result_meta is missing');
    return;
  }
  if (resultExpectation.disposition && meta.disposition !== resultExpectation.disposition) {
    failures.push(`find_products disposition expected ${resultExpectation.disposition}, got ${String(meta.disposition)}`);
  }
  if (
    typeof resultExpectation.selection_required === 'boolean' &&
    meta.selection_required !== resultExpectation.selection_required
  ) {
    failures.push(`find_products selection_required expected ${resultExpectation.selection_required}, got ${String(meta.selection_required)}`);
  }
  for (const field of resultExpectation.missing_fields ?? []) {
    if (!Array.isArray(meta.missing_fields) || !meta.missing_fields.includes(field)) {
      failures.push(`find_products result is missing required field ${JSON.stringify(field)}`);
    }
  }
  if (resultExpectation.selected_sku) {
    if (!Array.isArray(meta.selected_skus) || !meta.selected_skus.includes(resultExpectation.selected_sku)) {
      failures.push(`find_products result did not select SKU ${JSON.stringify(resultExpectation.selected_sku)}`);
    }
  }
}

function isExpectedPreflightClientError(test, status) {
  const expectedStatus = Number(test.expect?.status);
  return Number.isInteger(expectedStatus) &&
    expectedStatus >= 400 &&
    expectedStatus < 500 &&
    status === expectedStatus;
}

function evaluateCase(test, status, body, { requireReadOnly = false } = {}) {
  const toolCalls = Array.isArray(body.tool_calls) ? body.tool_calls : [];
  const calls = toolCalls.map((call) => call?.name).filter(Boolean);
  const answer = String(body.answer ?? body.error ?? '');
  const e = test.expect ?? {};
  const failures = [];

  if (requireReadOnly && body.read_only !== true && !isExpectedPreflightClientError(test, status)) {
    failures.push('server did not confirm read_only mode');
  }
  if (e.status && status !== e.status) failures.push(`status expected ${e.status}, got ${status}`);
  if (e.blocked && body.blocked !== 'cost_query') failures.push('cost-query guard did not block the request');
  if (e.tool && !calls.includes(e.tool)) failures.push(`required tool ${e.tool} was not called`);
  if (e.tool_any && !e.tool_any.some((name) => calls.includes(name))) {
    failures.push(`none of the required tools were called: ${e.tool_any.join(', ')}`);
  }
  for (const name of [e.forbid_tool, ...(e.forbid_tools ?? [])].filter(Boolean)) {
    if (calls.includes(name)) failures.push(`forbidden tool ${name} was called`);
  }
  if (e.source && (!Array.isArray(body.sources) || body.sources.length === 0)) {
    failures.push('required source citation is missing');
  }
  for (const term of e.require_terms ?? []) {
    if (!answer.includes(term)) failures.push(`answer is missing term ${JSON.stringify(term)}`);
  }
  for (const term of e.forbid_terms ?? []) {
    if (answer.includes(term)) failures.push(`answer contains forbidden term ${JSON.stringify(term)}`);
  }
  assertFindProducts(test, toolCalls, failures);

  return { ok: failures.length === 0, failures, calls };
}

function validateSafeSa331Cases(allCases) {
  const requiredCases = new Map([
    ['sa331-needs-variant', { disposition: 'needs_selection', selectionRequired: true }],
    ['sa331-refined', { disposition: 'resolved', selectedSku: '2020000979' }],
    ['sa331-follow-up', { disposition: 'resolved', selectedSku: '2020000979' }],
  ]);
  for (const [id, required] of requiredCases) {
    const item = allCases.find((test) => test.id === id);
    assert.ok(item, `missing required evaluation case ${id}`);
    const find = item.expect?.find_products;
    assert.equal(find?.args?.model, 'SA331', `${id} must require SA331 in find_products args`);
    assert.equal(find?.result?.disposition, required.disposition, `${id} must assert product disposition`);
    if (required.selectionRequired) {
      assert.equal(find?.result?.selection_required, true, `${id} must require selection_required=true`);
      assert.deepEqual(find?.result?.missing_fields, ['size', 'grit'], `${id} must assert size and grit are missing`);
    }
    if (required.selectedSku) {
      assert.equal(find?.result?.selected_sku, required.selectedSku, `${id} must assert the selected SKU`);
      assert.equal(find?.result?.selection_required, false, `${id} must require selection_required=false`);
      assert.equal(find?.args?.size, '5', `${id} must require size in find_products args`);
      assert.equal(find?.args?.grit, '120', `${id} must require grit in find_products args`);
    }
  }
}

function runSelfTest() {
  validateSafeSa331Cases(cases);
  assert.deepEqual(
    parseCliArgs(['--case', 'sa331-needs-variant', '--case=sa331-refined']),
    { caseIds: ['sa331-needs-variant', 'sa331-refined'], selfTest: false, help: false },
  );
  assert.deepEqual(
    selectCases(cases, ['sa331-refined', 'sa331-needs-variant', 'sa331-refined']).map((test) => test.id),
    ['sa331-refined', 'sa331-needs-variant'],
  );
  assert.throws(() => selectCases(cases, ['not-a-real-case']), /Unknown case id: not-a-real-case/);
  assert.throws(() => parseCliArgs(['--case']), /--case requires a case id/);
  assert.throws(() => parseCliArgs(['--case', '--help']), /--case requires a case id/);
  assert.throws(() => parseCliArgs(['--case=']), /--case requires a case id/);
  const initialCase = cases.find((test) => test.id === 'sa331-needs-variant');
  const followUpCase = cases.find((test) => test.id === 'sa331-follow-up');
  const refinedCase = cases.find((test) => test.id === 'sa331-refined');

  const fakeClarification = evaluateCase(initialCase, 200, {
    answer: 'สินค้านี้มีหลายขนาดและหลายเบอร์ค่ะ',
    tool_calls: [{ name: 'find_products', args: { query: 'DEERFOS SA331' } }],
  });
  assert.equal(fakeClarification.ok, false, 'clarification text must not pass without selection_required metadata');
  assert.ok(fakeClarification.failures.includes('find_products result_meta is missing'));

  const falseSelectionFlag = evaluateCase(initialCase, 200, {
    answer: 'สินค้านี้มีหลายขนาดและหลายเบอร์ค่ะ',
    tool_calls: [{
      name: 'find_products',
      args: { query: 'DEERFOS SA331' },
      result_meta: { disposition: 'needs_selection', selection_required: false, selected_skus: [] },
    }],
  });
  assert.equal(falseSelectionFlag.ok, false, 'clarification must require selection_required=true');
  assert.ok(falseSelectionFlag.failures.some((message) => message.includes('selection_required expected true')));

  const realClarification = evaluateCase(initialCase, 200, {
    answer: 'สินค้านี้มีหลายตัวเลือกค่ะ ใช้ขนาดเท่าไร และต้องการเบอร์ความละเอียดอะไรคะ',
    tool_calls: [{
      name: 'find_products',
      args: { query: 'DEERFOS SA331' },
      result_meta: {
        disposition: 'needs_selection',
        selection_required: true,
        missing_fields: ['size', 'grit'],
        selected_skus: [],
      },
    }],
  });
  assert.equal(realClarification.ok, true, realClarification.failures.join('; '));

  const droppedModel = evaluateCase(followUpCase, 200, {
    answer: 'รหัส 2020000979 SA331 เบอร์ 120',
    tool_calls: [{
      name: 'find_products',
      args: { query: '5 นิ้ว เบอร์ 120' },
      result_meta: { disposition: 'resolved', selection_required: false, selected_skus: ['2020000979'] },
    }],
  });
  assert.equal(droppedModel.ok, false, 'follow-up must not pass when find_products drops SA331');
  assert.ok(droppedModel.failures.some((message) => message.includes('missing model')));

  const prefixGrit = evaluateCase(refinedCase, 200, {
    answer: 'รหัส 2020000979 DEERFOS SA331 5 นิ้ว เบอร์ 120',
    tool_calls: [{
      name: 'find_products',
      args: { query: 'DEERFOS SA331 5 นิ้ว #1200' },
      result_meta: { disposition: 'resolved', selection_required: false, selected_skus: ['2020000979'] },
    }],
  });
  assert.equal(prefixGrit.ok, false, 'grit 120 must not match grit 1200');
  assert.ok(prefixGrit.failures.some((message) => message.includes('missing grit')));

  const wrongSku = evaluateCase(refinedCase, 200, {
    answer: 'รหัส 2020000979 DEERFOS SA331 5 นิ้ว เบอร์ 120',
    tool_calls: [{
      name: 'find_products',
      args: { query: 'DEERFOS SA331 5 นิ้ว #120' },
      result_meta: { disposition: 'resolved', selection_required: false, selected_skus: ['2020000980'] },
    }],
  });
  assert.equal(wrongSku.ok, false, 'answer text must not hide a wrong selected SKU');
  assert.ok(wrongSku.failures.some((message) => message.includes('did not select SKU')));

  const exactSelection = evaluateCase(refinedCase, 200, {
    answer: 'รหัส 2020000979 DEERFOS SA331 5 นิ้ว เบอร์ 120',
    tool_calls: [{
      name: 'find_products',
      args: { query: 'DEERFOS SA331 5 นิ้ว #120' },
      result_meta: { disposition: 'resolved', selection_required: false, selected_skus: ['2020000979'] },
    }],
  });
  assert.equal(exactSelection.ok, true, exactSelection.failures.join('; '));
  const unconfirmedReadOnly = evaluateCase({ expect: {} }, 200, {}, { requireReadOnly: true });
  assert.equal(unconfirmedReadOnly.ok, false, 'live evaluation must fail when the server does not confirm read_only');
  assert.ok(unconfirmedReadOnly.failures.includes('server did not confirm read_only mode'));

  const longInputCase = cases.find((test) => test.id === 'long-input');
  const expectedPreflight = evaluateCase(longInputCase, 413, {
    error: 'Message exceeds 4,000 characters',
  }, { requireReadOnly: true });
  assert.equal(expectedPreflight.ok, true, expectedPreflight.failures.join('; '));
  const wrongPreflightStatus = evaluateCase(longInputCase, 400, {
    error: 'Unexpected client error',
  }, { requireReadOnly: true });
  assert.equal(wrongPreflightStatus.ok, false, 'a different 4xx must not bypass read_only confirmation');
  assert.ok(wrongPreflightStatus.failures.includes('server did not confirm read_only mode'));
  console.log('PASS omnichat RAG evaluation assertions (offline)');
}

async function runLiveEvaluation(selectedCases) {
  const url = process.env.SUPABASE_URL;
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRole) {
    console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY before running the read-only evaluation.');
    process.exitCode = 2;
    return;
  }

  validateSafeSa331Cases(cases);
  let failed = 0;
  let executed = 0;
  for (const test of selectedCases) {
    executed += 1;
    const query = test.query === '__GENERATE_4001__' ? 'ก'.repeat(4001) : test.query;
    const res = await fetch(`${url}/functions/v1/rag-chat`, {
      method: 'POST',
      headers: { apikey: serviceRole, Authorization: `Bearer ${serviceRole}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query,
        history: Array.isArray(test.history) ? test.history : [],
        stream: false,
        read_only: true,
        channel: 'default',
        match_count: 5,
        match_threshold: 0.3,
      }),
    });
    let body = {};
    try { body = await res.json(); } catch { /* evaluator reports missing fields below */ }
    const outcome = evaluateCase(test, res.status, body, { requireReadOnly: true });
    if (!outcome.ok) failed += 1;
    console.log(`${outcome.ok ? 'PASS' : 'FAIL'} ${test.id} status=${res.status} tools=${outcome.calls.join(',') || '-'} sources=${body.sources?.length ?? 0}`);
    for (const failure of outcome.failures) console.log(`  - ${failure}`);
    if (body.read_only !== true && !isExpectedPreflightClientError(test, res.status)) {
      console.log('  - stopping: deployed rag-chat did not confirm read-only evaluation support');
      break;
    }
  }

  console.log(`\n${executed - failed}/${executed} passed`);
  process.exitCode = failed ? 1 : 0;
}

let cli;
try {
  cli = parseCliArgs(process.argv.slice(2));
  if (cli.help) {
    console.log(usage);
  } else if (cli.selfTest) {
    runSelfTest();
  } else {
    await runLiveEvaluation(selectCases(cases, cli.caseIds));
  }
} catch (error) {
  console.error(`ERROR: ${error.message}`);
  console.error(usage);
  process.exitCode = 2;
}
