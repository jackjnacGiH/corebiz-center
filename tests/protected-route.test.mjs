import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const source = readFileSync(new URL('../frontend/src/lib/ProtectedRoute.tsx', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    esModuleInterop: true,
    module: ts.ModuleKind.CommonJS,
    jsx: ts.JsxEmit.ReactJSX,
  },
}).outputText;

const Navigate = Symbol('Navigate');
const Fragment = Symbol('Fragment');
const jsx = (type, props) => ({ type, props });

function render(auth) {
  const exports = {};
  runInNewContext(compiled, {
    exports,
    require: name => {
      if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx, Fragment };
      if (name === 'react-router-dom') {
        return { Navigate, useLocation: () => ({ pathname: '/shipping' }) };
      }
      if (name === './AuthProvider') return { useAuth: () => auth };
      if (name === '../i18n') {
        return {
          useLanguage: () => ({
            t: {
              auth: {
                profileUnavailableTitle: 'unavailable title',
                profileUnavailable: 'unavailable message',
                profileMissingTitle: 'missing title',
                profileMissing: 'missing message',
                tryAgain: 'retry',
              },
            },
          }),
        };
      }
      throw new Error(`Unexpected dependency ${name}`);
    },
  });
  return exports.default({ children: 'protected content' });
}

const activeProfile = { role: 'owner', is_active: true };

test('transient profile failure stays on the protected route and offers retry', () => {
  let retries = 0;
  const result = render({
    session: { user: { id: 'owner' } },
    profile: null,
    profileIssue: 'unavailable',
    loading: false,
    refresh: async () => { retries += 1; },
  });

  assert.notEqual(result.type, Navigate);
  assert.equal(result.props.title, 'unavailable title');
  result.props.onRetry();
  assert.equal(retries, 1);
});

test('missing profile has a distinct access message instead of claiming suspension', () => {
  const result = render({
    session: { user: { id: 'unknown' } },
    profile: null,
    profileIssue: 'missing',
    loading: false,
    refresh: async () => {},
  });

  assert.notEqual(result.type, Navigate);
  assert.equal(result.props.title, 'missing title');
});

test('only a loaded inactive profile redirects to the inactive message', () => {
  const result = render({
    session: { user: { id: 'inactive' } },
    profile: { role: 'staff', is_active: false },
    profileIssue: null,
    loading: false,
    refresh: async () => {},
  });

  assert.equal(result.type, Navigate);
  assert.equal(result.props.to, '/login?error=inactive');
});

test('active staff profile renders protected content', () => {
  const result = render({
    session: { user: { id: 'owner' } },
    profile: activeProfile,
    profileIssue: null,
    loading: false,
    refresh: async () => {},
  });

  assert.equal(result.type, Fragment);
  assert.equal(result.props.children, 'protected content');
});
