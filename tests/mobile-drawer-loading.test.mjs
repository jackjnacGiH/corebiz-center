import test from 'node:test';
import assert from 'node:assert/strict';
import { deferred, elements, mountComponent, settle, text } from './helpers/component-harness.mjs';

const path = 'frontend/src/components/layout/MobileSidebarDrawerHost.tsx';
test('closed mobile navigation does not load the module, and closing during load cannot reopen it', async () => {
  const module = deferred(); let imports = 0; const closes = [];
  const services = {};
  Object.defineProperty(services, './MobileSidebarDrawer', { get() { imports++; return module.promise; } });
  const props = open => ({ open, onOpenChange: value => closes.push(value), onItemClick() {} });
  const h = mountComponent(path, props(false), services);
  await settle(); assert.equal(imports, 0); assert.equal(h.tree, null);
  h.render(props(true)); await settle(); h.render();
  assert.ok(imports > 0); assert.match(text(h.tree), /กำลังโหลดเมนู/);
  const dialog = elements(h.tree, node => node.type === 'dialog')[0];
  dialog.props.onCancel({ preventDefault() {} }); assert.deepEqual(closes, [false]);
  h.render(props(false)); module.resolve({ default: 'MobileSidebarDrawer' }); await settle(); h.render();
  assert.equal(h.tree, null);
  h.render(props(true)); await settle(); h.render(); assert.equal(h.tree.type, 'MobileSidebarDrawer');
  h.render(props(false)); assert.equal(h.tree.type, 'MobileSidebarDrawer'); assert.equal(h.tree.props.open, false);
  h.unmount();
});

test('a failed optional drawer import keeps the page mounted and can retry without a page reload', async () => {
  const module = deferred(); const services = { './MobileSidebarDrawer': module.promise };
  const h = mountComponent(path, { open: true, onOpenChange() {}, onItemClick() {} }, services);
  await settle(); module.reject(new Error('chunk unavailable')); await settle(); h.render();
  assert.match(text(h.tree), /โหลดเมนูไม่สำเร็จ/);
  services['./MobileSidebarDrawer'] = Promise.resolve({ default: 'MobileSidebarDrawer' });
  const retry = elements(h.tree, node => node.type === 'button' && text(node) === 'ลองใหม่')[0];
  retry.props.onClick(); h.render(); await settle(); h.render();
  assert.equal(h.tree.type, 'MobileSidebarDrawer'); assert.equal(h.tree.props.open, true); h.unmount();
});
