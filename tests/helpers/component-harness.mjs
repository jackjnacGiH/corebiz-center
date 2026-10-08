import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { createAsyncScope } from '../../frontend/src/lib/async-scope.ts';

export const settle = async () => { await new Promise(resolve => setImmediate(resolve)); };
export const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };

// Evaluate actual TSX, keeping only the DOM/external services fake. Effects and
// deferred promises remain separate so tests can force A/B responses out of order.
export function mountComponent(path, initialProps, services = {}) {
  const slots = [], effects = [];
  let cursor = 0, props = initialProps, tree;
  const sameDeps = (a, b) => a && b && a.length === b.length && a.every((value, i) => Object.is(value, b[i]));
  const memo = (factory, deps) => { const index = cursor++; if (!slots[index] || !sameDeps(slots[index].deps, deps)) slots[index] = { value: factory(), deps }; return slots[index].value; };
  const effect = (setup, deps) => { const index = cursor++; if (!slots[index] || !sameDeps(slots[index].deps, deps)) effects.push(() => { slots[index]?.cleanup?.(); slots[index] = { deps, cleanup: setup() }; }); };
  const react = {
    useState: initial => { const index = cursor++; if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial; return [slots[index], value => { slots[index] = typeof value === 'function' ? value(slots[index]) : value; }]; },
    useRef: value => { const index = cursor++; slots[index] ??= { current: value }; return slots[index]; },
    useEffect: effect, useLayoutEffect: effect, useMemo: memo, useCallback: (callback, deps) => memo(() => callback, deps),
  };
  const scopeExports = {};
  const scopeSource = readFileSync(new URL('../../frontend/src/lib/useAsyncScope.ts', import.meta.url), 'utf8');
  runInNewContext(ts.transpileModule(scopeSource, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText,
    { exports: scopeExports, require: name => name === 'react' ? react : { createAsyncScope } });
  const stub = new Proxy({ __esModule: true, default: 'stub' }, { get: (object, key) => object[key] ?? key });
  const translation = { chat: { title: 'Chat', subtitle: '', statusFilter: { inbox: 'Inbox', unread: 'Unread', inProgress: 'In progress', resolved: 'Resolved' } }, shipping: {}, orders: {}, common: {} };
  const alerts = [];
  const globals = {
    exports: {}, URL, URLSearchParams, AbortController, performance, setTimeout, clearTimeout, setInterval, clearInterval,
    AUDIT_ENV: { VITE_CHAT_PERSISTENT_CACHE_ENABLED: 'false', VITE_CHAT_FAST_LOAD_ENABLED: 'false' },
    window: { setTimeout, clearTimeout }, console: { info() {}, error() {}, warn() {} }, alert: value => alerts.push(value),
    require: name => {
      if (name === 'react') return react;
      if (name === 'react/jsx-runtime') return { jsx: (type, values) => ({ type, props: values }), jsxs: (type, values) => ({ type, props: values }) };
      if (services[name]) return services[name];
      if (name.endsWith('useAsyncScope')) return scopeExports;
      if (name === 'react-router-dom') return { useNavigate: () => () => {}, useOutletContext: () => ({ setTopBarContent() {} }), useSearchParams: () => [new URLSearchParams(), () => {}] };
      if (name.endsWith('i18n')) return { useLanguage: () => ({ t: translation }) };
      if (name.endsWith('AuthProvider')) return { useAuth: () => ({ profile: { id: 'staff', role: 'owner', is_active: true }, session: null }) };
      if (name.endsWith('/utils')) return { cn: (...values) => values.filter(value => typeof value === 'string').join(' ') };
      if (name.endsWith('chatAutoTags')) return { computeAutoTags: () => [], daysSince: () => 1 };
      if (name.endsWith('QuoteDocument')) return { default: 'QuoteDocument', formatThaiAddress: () => '' };
      if (name.endsWith('EditableQuoteItems')) return { default: 'EditableQuoteItems' };
      return stub;
    },
  };
  const source = readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8').replace(/import\.meta\.env/g, 'AUDIT_ENV');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
  runInNewContext(compiled, globals);
  const render = nextProps => { if (nextProps) props = nextProps; cursor = 0; tree = globals.exports.default(props); while (effects.length) effects.shift()(); return tree; };
  render();
  return { render, alerts, get tree() { return tree; }, unmount() { for (const slot of slots) slot?.cleanup?.(); } };
}

export function elements(tree, predicate) {
  const found = [];
  const visit = node => { if (Array.isArray(node)) { node.forEach(visit); return; } if (!node || typeof node !== 'object') return; if (node.props) { if (predicate(node)) found.push(node); visit(node.props.children); } };
  visit(tree); return found;
}
export function text(tree) { if (Array.isArray(tree)) return tree.map(text).join(' '); return tree?.props ? text(tree.props.children) : typeof tree === 'string' || typeof tree === 'number' ? String(tree) : ''; }
