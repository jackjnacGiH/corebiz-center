// Fixed-latency fixture: measure request waterfalls without production writes.
import { readFileSync, existsSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { performance } from 'node:perf_hooks';
import ts from 'typescript';

const source = readFileSync(new URL('../frontend/src/lib/api.ts', import.meta.url), 'utf8').replace(/\r/g, '');
const flightPath = new URL('../frontend/src/lib/read-flight.ts', import.meta.url);
const flights = existsSync(flightPath) ? await import(flightPath.href) : {};
function api(start, end, supabase) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from);
  if (from < 0 || to < 0) throw new Error(`Missing method: ${start}`);
  const body = source.slice(from, to);
  const compiled = ts.transpileModule(`export const api = { ${body} };`, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  runInNewContext(compiled, { exports, supabase, ...flights, Date, AbortController });
  return exports.api;
}
function fixture() {
  const calls = [];
  return { calls, supabase: { from(table) {
    const query = new Proxy({}, { get: (_, key) => key === 'then'
      ? (yes, no) => {
        calls.push(table);
        return new Promise(resolve => setTimeout(() => resolve({
          data: table === 'inventory' ? [{ product_id: 'p1', quantity: 1, reorder_level: 2 }] : [],
          count: 2, error: null,
        }), 60)).then(yes, no);
      }
      : () => query });
    return query;
  } } };
}
for (const [name, start, end, method, twice] of [
  ['dashboardKPI', 'async getKPI()', '/**\n   * Returns last 7 months', 'getKPI', false],
  ['dashboardActivity', 'async getRecentActivity(', '\n};', 'getRecentActivity', false],
  ['chatConcurrentPage', 'async listMessages(', '/** Admin sends a reply.', 'listMessages', true],
]) {
  const f = fixture(), client = api(start, end, f.supabase), begin = performance.now();
  await Promise.all(Array.from({ length: twice ? 2 : 1 }, () => client[method]('room1')));
  console.log(JSON.stringify({ name, fixtureLatencyMs: 60, elapsedMs: Math.round(performance.now() - begin), requests: f.calls.length }));
}
