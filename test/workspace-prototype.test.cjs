'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../src/workspace-folders.js'), 'utf8');
const M = require('../src/model.js');
const N = require('../src/workspace-native.js');

test('prototype cannot initialize without the isolated launcher flag', () => {
  const context = vm.createContext({ console: { warn() {} } });
  vm.runInContext(source, context);
  assert.equal(context.ArcWorkspaceFolders, undefined);
});

test('private-main initialization does not touch native stores or render folders', () => {
  const context = vm.createContext({
    __ArcWorkspaceIsolatedPrototype: true, ArcFoldersModel: M, ArcWorkspaceLayout: {}, ArcWorkspaceNative: N,
    console: { warn() {} }, chrome: { extension: { getViews() { throw new Error('Private views must not be inspected'); }, inIncognitoContext: true } },
    webpackChunkgapp_browser_react: { push() { throw new Error('Private native store must not be read'); } },
  });
  vm.runInContext(source, context);
  assert.equal(context.ArcWorkspaceFolders, undefined);
});

test('destroy is idempotent and releases the native store listener exactly once', async () => {
  const callbacks = new Set();
  let added = 0, removed = 0;
  const store = {
    getActiveWorkspaceId() {}, getWorkspaces() { return []; },
    addListener(fn) { callbacks.add(fn); added++; },
    removeListener(fn) { assert.equal(callbacks.delete(fn), true, 'listener was registered'); removed++; },
  };
  const context = vm.createContext({
    __ArcWorkspaceIsolatedPrototype: true,
    ArcFoldersModel: M,
    ArcWorkspaceLayout: {}, ArcWorkspaceNative: N,
    console: { warn() {} },
    chrome: { extension: { getViews() { return []; } }, tabs: { query: async () => [], discard: async () => {} }, windows: { getAll: async () => [] }, storage: { local: { get: async () => ({}) } } },
    vivaldi: { prefs: { get: async () => ({ value: 'left' }) }, contextMenu: { show() {} }, menubarMenu: { onAction: { addListener() {}, removeListener() {} }, onClose: { addListener() {}, removeListener() {} } } },
    webpackChunkgapp_browser_react: { push([, , callback]) { callback(id => ({
      61685: { Z: store },
      67251: { ZP: { closePage() {}, closePageById() {}, activateTab() {} } },
      70406: { ZP: { getPageById() {}, getStartpage() {} }, yz() {} },
    })[id]); } },
    setInterval() { return 1; }, clearInterval() {}, setTimeout() { return 1; }, clearTimeout() {},
  });
  vm.runInContext(source, context);
  await context.ArcWorkspaceFolders.ready;
  context.ArcWorkspaceFolders.destroy();
  context.ArcWorkspaceFolders.destroy();
  assert.equal(added, 1); assert.equal(removed, 1); assert.equal(callbacks.size, 0);
});
