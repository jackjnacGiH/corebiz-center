import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const compiled = ts.transpileModule(
  readFileSync(new URL('../frontend/src/components/layout/Layout.tsx', import.meta.url), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } },
).outputText;

function prefetchesAt(pathname) {
  const effects = [], timers = [], warmed = [];
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
    setTimeout: callback => { timers.push(callback); return timers.length; },
    clearTimeout: () => {},
    require(name) {
      if (name === 'react') return { ...react, default: react };
      if (name === 'react/jsx-runtime') return { jsx: () => null, jsxs: () => null };
      if (name === 'react-router-dom') return { Outlet: 'Outlet', useLocation: () => ({ pathname }) };
      if (name === '@/components/ui/sheet') return { Sheet: 'Sheet', SheetContent: 'SheetContent', SheetTitle: 'SheetTitle' };
      if (name === '@/hooks/useSidebar') return { useSidebar: () => ({
        collapsed: false, mobileOpen: false, isMobile: false,
        toggleCollapsed() {}, openMobile() {}, closeMobile() {}, setMobileOpen() {},
      }) };
      if (name === './Sidebar' || name === './TopBar' || name === '../BackToTop') return { default: name };
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
  for (const setup of effects) setup();
  for (const timer of timers) timer();
  return warmed;
}

test('Shipping does not start full-list background prefetches', () => {
  assert.deepEqual(prefetchesAt('/shipping'), []);
  assert.deepEqual(prefetchesAt('/shipping/'), []);
});

test('other routes keep the existing background cache warm-up', () => {
  assert.deepEqual(prefetchesAt('/inventory'), ['products', 'categories', 'warehouses', 'customers']);
});
