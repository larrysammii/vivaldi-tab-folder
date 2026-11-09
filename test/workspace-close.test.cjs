'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const N = require('../src/workspace-native.js');

function fixture() {
  let live = { id: 7, discarded: false }, allowed = true;
  const events = [], errors = [];
  const actions = {
    closePage(page, options) { events.push({ action: 'native-page', page, options, receiver: this }); if (page.id === live?.id) live = null; return 'native-result'; },
    closePageById(id) { events.push({ action: 'remove', id }); if (id === live?.id) live = null; return 'native-result'; },
  };
  const originals = { ...actions };
  const bridge = N.hookTabClose(actions, {
    targetFor(id, expected) { return allowed && live && (id === live.id || expected === 'folder:entry') ? 'folder:entry' : null; },
    async getTab() { return live; },
    async unload(tab, current) { if (current()) { events.push({ action: 'unload', id: tab.id }); live = { id: 8, discarded: true }; } },
    onError(error) { errors.push(error.message); },
  });
  return { actions, originals, bridge, events, errors, live: () => live, allow(value) { allowed = value; } };
}

test('folder close unloads, then removes the replaced native tab ID', async () => {
  const f = fixture();
  await f.actions.closePage({ id: 7 });
  assert.deepEqual(f.live(), { id: 8, discarded: true });
  await f.actions.closePageById(8);
  assert.equal(f.live(), null);
  assert.deepEqual(f.events, [{ action: 'unload', id: 7 }, { action: 'remove', id: 8 }]);
  assert.deepEqual(f.errors, []);
  f.bridge.restore();
});

test('queued close requests follow persistent identity across native replacement', async () => {
  const f = fixture();
  await Promise.all([f.bridge.close(7), f.bridge.close(7)]);
  assert.equal(f.live(), null);
  assert.deepEqual(f.events, [{ action: 'unload', id: 7 }, { action: 'remove', id: 8 }]);
  assert.deepEqual(f.errors, []);
  f.bridge.restore();
});

test('unfiled and multi-tab native actions keep their original arguments, receiver and result', () => {
  const f = fixture(); f.allow(false);
  const page = { id: 7 }, options = { bypassConfirm: true }, receiver = {};
  assert.equal(f.actions.closePage.call(receiver, page, options), 'native-result');
  assert.deepEqual(f.events, [{ action: 'native-page', page, options, receiver }]);
  f.allow(true);
  const pages = [{ id: 11 }, { id: 12 }];
  assert.equal(f.actions.closePage(pages, options), 'native-result');
  assert.equal(f.events[1].page, pages); assert.equal(f.events[1].options, options);
  f.bridge.restore();
});

test('leaving a folder or tearing down cancels queued folder closes', async () => {
  const f = fixture();
  const request = f.bridge.close(7); f.allow(false); await request;
  assert.deepEqual(f.live(), { id: 7, discarded: false }); assert.deepEqual(f.events, []);
  f.allow(true);
  const next = f.bridge.close(7); f.bridge.restore(); await next;
  assert.deepEqual(f.live(), { id: 7, discarded: false }); assert.deepEqual(f.events, []);
  assert.equal(f.actions.closePage, f.originals.closePage);
  assert.equal(f.actions.closePageById, f.originals.closePageById);
  f.bridge.restore();
});

test('after teardown, stale helper requests cancel but cached native callbacks stay native', async () => {
  const f = fixture(), cachedNativeCallback = f.actions.closePageById;
  f.bridge.restore();
  await f.bridge.close(7);
  assert.deepEqual(f.live(), { id: 7, discarded: false }); assert.deepEqual(f.events, []);
  assert.equal(cachedNativeCallback(7), 'native-result');
  assert.equal(f.live(), null); assert.deepEqual(f.events, [{ action: 'remove', id: 7 }]);
});

test('unload errors are reported without falling through to destructive close', async () => {
  const events = [], errors = [];
  const actions = { closePage() { events.push('remove'); }, closePageById() { events.push('remove'); } };
  const bridge = N.hookTabClose(actions, {
    targetFor: () => 'folder:entry', getTab: async () => ({ id: 7, discarded: false }),
    unload: async () => { throw new Error('Synthetic unload rejection'); }, onError: error => errors.push(error.message),
  });
  await actions.closePageById(7);
  assert.deepEqual(events, []); assert.deepEqual(errors, ['Synthetic unload rejection']);
  bridge.restore();
});

test('close bridge validates native APIs and restores only its own wrappers', () => {
  const f = fixture(), replacement = () => 'other-owner';
  f.actions.closePage = replacement; f.bridge.restore();
  assert.equal(f.actions.closePage, replacement);
  assert.equal(f.actions.closePageById, f.originals.closePageById);
  assert.equal(N.hookTabClose({}, { targetFor() {}, getTab() {}, unload() {} }), null);
  assert.equal(N.hookTabClose(Object.freeze(f.originals), { targetFor() {}, getTab() {}, unload() {} }), null);
});
