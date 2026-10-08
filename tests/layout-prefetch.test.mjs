import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const compiled = ts.transpileModule(
  readFileSync(new URL('../frontend/src/components/layout/Layout.tsx', import.meta.url), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } },
).outputText;

async function prefetchesAt(pathname, cancel = null) {
  const effects = [], timers = new Map(), warmed = [];
  let nextTimer = 0;
  const react = {
    useState: initial => [initial, () => {}],
    useRef: initial => ({ current: initial }),
    useMemo: factory => factory(),
    useEffect: setup => effects.push(setup),
  };
  const api = name => ({ list: () => Promise.resolve(name) });
  const exports = {};
  runInNewContext(compiled, {
    exports,
    setTimeout: (callback, delay) => { timers.set(++nextTimer, { callback, delay }); return nextTimer; },
    clearTimeout: id => timers.delete(id),
    require(name) {
      if (name === 'react') return { ...react, default: react };
      if (name === 'react/jsx-runtime') return { jsx: () => null, jsxs: () => null };
      if (name === 'react-router-dom') return { Outlet: 'Outlet', useLocation: () => ({ pathname }) };
      if (name === '@/components/ui/sheet') return { Sheet: 'Sheet', SheetContent: 'SheetContent', SheetTitle: 'SheetTitle' };
      if (name === '@/hooks/useSidebar') return { useSidebar: () => ({
        collapsed: false, mobileOpen: false, isMobile: false,
        toggleCollapsed() {}, openMobile() {}, closeMobile() {}, setMobileOpen() {},
      }) };
      if (name === '../../lib/AuthProvider') return { useAuth: () => ({
        session: { user: { id: 'user-1' } }, profile: { role: 'owner' },
      }) };
      if (name === '../../lib/shipping-api') return {
        shippingApi: { initial: () => { warmed.push('shipping:initial'); return Promise.resolve(); } },
      };
      if (name === './Sidebar' || name === './TopBar' || name === '../BackToTop' || name === './MobileSidebarDrawerHost') return { default: name };
      if (name === '@/lib/utils') return { cn: (...values) => values.filter(Boolean).join(' ') };
      if (name === '../../lib/cache') return {
        CK: { products: 'products', categories: 'categories', warehouses: 'warehouses', customers: 'customers' },
        prefetchList: key => warmed.push(key),
      };
      if (name === '../../lib/api') return {
        productsApi: api('products'), customersApi: api('customers'),
        categoriesApi: api('categories'), warehousesApi: api('warehouses'),
      };
      throw new Error(`Unexpected dependency ${name}`);
    },
  });
  exports.default();
  const cleanups = effects.map(setup => setup());
  const dispose = () => { for (const cleanup of cleanups) cleanup?.(); };
  if (cancel === 'before-timer') dispose();
  for (const [id, timer] of [...timers.entries()].sort((a, b) => a[1].delay - b[1].delay)) {
    if (!timers.has(id)) continue;
    timers.delete(id);
    const request = timer.callback();
    if (cancel === 'during-import') dispose();
    await request;
  }
  return warmed;
}

test('Shipping does not start full-list background prefetches', async () => {
  assert.deepEqual(await prefetchesAt('/shipping'), []);
  assert.deepEqual(await prefetchesAt('/shipping/'), []);
});

test('other routes keep the existing background cache warm-up', async () => {
  assert.deepEqual(await prefetchesAt('/inventory'), [
    'shipping:initial', 'products', 'categories', 'warehouses', 'customers',
  ]);
});

test('route/auth effect cancellation prevents shipping and full-list reads before or during its optional import', async () => {
  assert.deepEqual(await prefetchesAt('/inventory', 'before-timer'), []);
  assert.deepEqual(await prefetchesAt('/inventory', 'during-import'), []);
});
