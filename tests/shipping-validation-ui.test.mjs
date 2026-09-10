import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import * as domain from '../supabase/functions/_shared/shipping-domain.ts';
import { shippingTranslations } from '../frontend/src/lib/shipping-i18n.ts';

const jsx = {
  jsx: (type, props) => ({ type, props }),
  jsxs: (type, props) => ({ type, props }),
  Fragment: 'Fragment',
};
const nodes = (value, result = []) => {
  if (Array.isArray(value)) value.forEach(child => nodes(child, result));
  else if (value && typeof value === 'object') {
    if ('type' in value && value.props) result.push(value);
    for (const child of Object.values(value.props ?? {})) if (typeof child === 'object') nodes(child, result);
  }
  return result;
};
const compile = path => ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
}).outputText;

test('phone field reports punctuation and explains the provider-safe format inline', () => {
  const exports = {};
  runInNewContext(compile('../frontend/src/components/shipping/AddressFields.tsx'), {
    exports,
    require(name) {
      if (name === 'react') return {
        useEffect() {}, useRef: value => ({ current: value }), useState: value => [value, () => {}],
      };
      if (name === 'react/jsx-runtime') return jsx;
      if (name === 'lucide-react') return { Loader2: 'Loader2', Search: 'Search' };
      if (name === '@/components/ui/input') return { Input: 'Input' };
      if (name === '@/i18n') return { useLanguage: () => ({ t: { shipping: new Proxy({
        phoneDigitsOnly: 'digits-only',
      }, { get: (target, key) => key in target ? target[key] : key }) } }) };
      if (name === '@/lib/thaiAddress') return { lookupZipcode: async () => [] };
      if (name.endsWith('/shipping-domain')) return domain;
      throw new Error(`Unexpected dependency ${name}`);
    },
  });
  const render = telephone1 => exports.default({
    title: 'Recipient', prefix: 'recipient', beforeFields: null,
    value: { ...domain.emptyAddress(), telephone1 }, onChange() {},
  });

  const invalid = nodes(render('081-442-0000'));
  const phone = invalid.find(node => node.type === 'Input' && node.props.id === 'recipient-telephone1');
  assert.equal(phone.props.inputMode, 'numeric');
  assert.equal(phone.props.pattern, '[0-9]*');
  assert.equal(phone.props['aria-invalid'], true);
  assert.equal(invalid.find(node => node.props.role === 'alert').props.children, 'digits-only');

  const valid = nodes(render('0814420000'));
  assert.equal(valid.find(node => node.type === 'Input' && node.props.id === 'recipient-telephone1').props['aria-invalid'], undefined);
  assert.equal(valid.some(node => node.props.role === 'alert'), false);
});

test('parcel fields identify the exact side that exceeds 180 cm', () => {
  const exports = {};
  runInNewContext(compile('../frontend/src/components/shipping/ShippingParcels.tsx'), {
    exports,
    require(name) {
      if (name === 'react/jsx-runtime') return jsx;
      if (name === 'lucide-react') return { Copy: 'Copy' };
      if (name === '@/components/ui/input') return { Input: 'Input' };
      if (name === '@/components/ui/button') return { Button: 'Button' };
      if (name === '@/i18n') return { useLanguage: () => ({ t: { shipping: {
        parcel: 'parcel', parcelBeforeCarrier: 'guide', parcelTotal: 'count', box: 'box',
        copyPreviousBox: 'copy', parcelTotalHint: 'hint', box_width: 'width', box_height: 'height',
        box_length: 'length', box_weight: 'weight', boxWeightInvalid: 'weight-invalid',
        quoteIssues: { box_width: 'width-limit', box_height: 'height-limit', box_length: 'length-limit' },
      } } }) };
      if (name.endsWith('/shipping-domain')) return domain;
      throw new Error(`Unexpected dependency ${name}`);
    },
  });
  const draft = domain.emptyDraft();
  Object.assign(draft, { box_width: 10, box_height: 20, box_length: 200, box_weight: 500 });
  const rendered = nodes(exports.default({ draft, onChange() {} }));
  const length = rendered.find(node => node.type === 'Input' && node.props['aria-label'] === 'length box 1');
  assert.equal(length.props.max, domain.SHIPPING_BOX_DIMENSION_MAX_CM);
  assert.equal(length.props['aria-invalid'], true);
  assert.equal(rendered.find(node => node.props.role === 'alert').props.children, 'length-limit');
});

test('Thai and English summaries explain how to correct phone and dimension blockers', () => {
  for (const language of ['th', 'en']) {
    const words = shippingTranslations[language];
    assert.ok(words.submissionBlocked);
    assert.ok(words.submissionConnectionNotReady);
    assert.ok(words.submissionIssues.destination_phone);
    assert.ok(words.quoteIssues.box_length.includes('180'));
    assert.ok(words.providerIssues.invalid_phone);
    assert.ok(words.providerIssues.box_dimension_exceeded.includes('180'));
  }
  assert.match(shippingTranslations.th.submissionIssues.destination_phone, /ตัวเลข/);
  assert.match(shippingTranslations.th.providerIssues.invalid_phone, /ขีด/);
});
