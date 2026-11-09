'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const N = require('../src/workspace-native.js');
function event() {
  const listeners = new Set();
  return { listeners, addListener(fn) { listeners.add(fn); }, removeListener(fn) { assert.equal(listeners.delete(fn), true); }, emit(value) { for (const fn of listeners) fn(value); } };
}
function fixture() {
  const calls = [], errors = [];
  const show = request => { calls.push(request); return 'native-result'; };
  const api = { contextMenu: { show }, menubarMenu: { onAction: event(), onClose: event() } };
  let scope = 'workspace:1', time = 1000, invoked = 0;
  const bridge = N.menuBridge(api, {
    current: id => id === 10 ? { supported: true, scope } : null,
    entries: () => [{ label: 'New Folder', run: () => invoked++ }, { label: 'Move to Folder', children: [{ label: 'Research', run: () => invoked++ }] }],
    onError: error => errors.push(error.message), now: () => time,
  });
  return { api, bridge, calls, errors, show, setScope(value) { scope = value; }, setTime(value) { time = value; }, invoked: () => invoked };
}
test('native menu bridge preserves existing native entries and dispatches custom actions', async () => {
  const f = fixture(), original = { item: { id: 0, name: 'New Tab', type: 'command' } };
  f.bridge.note({ windowId: 10, scope: 'workspace:1' });
  assert.equal(f.api.contextMenu.show({ windowId: 10, children: [original] }), 'native-result');
  const menu = f.calls[0]; assert.equal(menu.children[0], original); assert.deepEqual(menu.children[1], { separator: {} });
  assert.equal(menu.children[2].item.name, 'New Folder'); assert.equal(menu.children[3].item.type, 'folder');
  f.api.menubarMenu.onAction.emit({ id: menu.children[2].item.id }); await Promise.resolve();
  assert.equal(f.invoked(), 1); assert.equal(f.bridge.dispatchAction({ id: 0 }), false);
  f.bridge.restore(); f.bridge.restore(); assert.equal(f.api.contextMenu.show, f.show);
  assert.equal(f.api.menubarMenu.onAction.listeners.size, 0); assert.equal(f.api.menubarMenu.onClose.listeners.size, 0);
});
test('unrelated windows, stale gestures and closed menus cannot run folder commands', async () => {
  const f = fixture();
  f.bridge.note({ windowId: 10, scope: 'workspace:1' }); const other = { windowId: 20, children: [] }; f.api.contextMenu.show(other); assert.equal(f.calls[0], other);
  f.bridge.note({ windowId: 10, scope: 'workspace:1' }); f.setTime(4000); const stale = { windowId: 10, children: [] }; f.api.contextMenu.show(stale); assert.equal(f.calls[1], stale);
  f.bridge.note({ windowId: 10, scope: 'workspace:1' }); f.api.contextMenu.show({ windowId: 10, children: [] });
  const id = f.bridge.snapshot().commands[0].id;
  f.setScope('workspace:2'); f.api.menubarMenu.onAction.emit({ id }); await Promise.resolve();
  assert.equal(f.invoked(), 0); assert.equal(f.errors.length, 1);
  f.api.menubarMenu.onClose.emit(); assert.equal(f.bridge.dispatchAction({ id }), false); f.bridge.restore();
});
test('folder-row context menus use the actual native popup API, not an HTML menu', () => {
  const f = fixture(); f.bridge.open({ windowId: 10, scope: 'workspace:1', x: 42, y: 70 });
  assert.equal(f.calls[0].forceViews, false); assert.equal(f.calls[0].origin, 'pointer'); assert.equal(f.calls[0].children[0].item.name, 'New Folder'); assert.equal(f.calls[0].rect.x, 42); f.bridge.restore();
});
test('restoring the bridge does not overwrite another owner of the native show method', () => {
  const f = fixture(), replacement = () => {}; f.api.contextMenu.show = replacement; f.bridge.restore(); assert.equal(f.api.contextMenu.show, replacement);
});
test('native serialized drops validate the full schema and forward only canonical native fields', () => {
  const transfer = (value, type = N.TAB_MIME) => ({ types: [type], getData: () => value });
  const valid = { ids: ['7', 8], active: 7, activeIndex: 2, dragSource: 'main', sourceWindow: 10 };
  const payload = JSON.stringify(valid), canonical = { ...valid, ids: [7, 8] };
  assert.deepEqual(N.nativeTabDrop(transfer(payload)), { ...canonical, payload: JSON.stringify(canonical) });
  for (const value of ['invalid', 'null', '[]', '{}', payload + ' '.repeat(262144)]) assert.equal(N.nativeTabDrop(transfer(value)), null);
  for (const fields of [
    { ids: [] }, { ids: ['https://example.test'] }, { ids: [7, '7'] }, { ids: [0] }, { ids: [-1] }, { ids: [9007199254740992] }, { ids: [null] },
    { active: 99 }, { active: '7' }, { activeIndex: -1 }, { activeIndex: null }, { sourceWindow: 0 }, { sourceWindow: '10' }, { dragSource: 'unknown' }, { extra: { unexpected: true } },
  ]) assert.equal(N.nativeTabDrop(transfer(JSON.stringify({ ...valid, ...fields }))), null);
  assert.equal(N.nativeTabDrop(transfer(JSON.stringify({ ids: [7], active: 7 }))), null);
  assert.equal(N.nativeTabDrop(transfer(payload, 'text/plain')), null);
  assert.equal(N.nativeTabDrop(null), null);
});

test('native drag hook handles actual dragged page IDs and uses native cleanup', () => {
  let nativeEnded = 0, cleaned = 0, accepted = true, received;
  const original = function () { nativeEnded++; };
  const controller = { state: { dragMode: 'internal', draggedPages: { toArray: () => [{ id: 7 }, { id: 8 }] } }, endInternalDragging: original, cleanupDragging() { cleaned++; } };
  const strip = { '__reactFiber$test': { stateNode: null, return: { stateNode: controller } } };
  const hook = N.hookDragController(strip, ids => { received = ids; return accepted; });
  controller.endInternalDragging(); assert.deepEqual(received, [7, 8]); assert.equal(cleaned, 1); assert.equal(nativeEnded, 0);
  accepted = false; controller.endInternalDragging(); assert.equal(nativeEnded, 1);
  controller.state.dragMode = 'detached'; controller.endInternalDragging(); assert.equal(nativeEnded, 2);
  controller.state.dragMode = undefined; controller.endInternalDragging(); assert.equal(nativeEnded, 3);
  hook.restore(); hook.restore(); assert.equal(controller.endInternalDragging, original);
  assert.equal(N.hookDragController({}, () => true), null);
});
