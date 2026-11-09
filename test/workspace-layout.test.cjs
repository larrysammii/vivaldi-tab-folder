const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const Model = require('../src/model.js');
const Layout = require('../src/workspace-layout.js');

const WINDOW_A = '1f8b1a20-37e0-4a11-a139-aed2747826a1';
const WINDOW_B = 'b9b30e0a-0c65-41b9-9d19-14671d819f70';

function createFolder(state, { id, name = id, scope, parentId = null }) {
  return Model.createFolder(state, { id, name, scope, parentId });
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

test('exports the CommonJS API and browser global', () => {
  assert.equal(globalThis.ArcWorkspaceLayout, Layout);
  const browserContext = {};
  vm.runInNewContext(fs.readFileSync(require.resolve('../src/model.js'), 'utf8'), browserContext);
  vm.runInNewContext(fs.readFileSync(require.resolve('../src/workspace-layout.js'), 'utf8'), browserContext);
  assert.equal(typeof browserContext.ArcWorkspaceLayout.layout, 'function');
  assert.equal(browserContext.ArcWorkspaceLayout.scopeKey(42, WINDOW_A), 'workspace:42');
});

test('creates independent placement keys for the same native tab in two workspaces', () => {
  const state = Model.emptyState();
  const scopeA = Layout.scopeKey(1700000000000, WINDOW_A);
  const scopeB = Layout.scopeKey(1800000000000, WINDOW_A);
  const tab = { ext_id: 'stable-native-tab', id: 73 };
  const keyA = Layout.tabKey(tab, scopeA);
  const keyB = Layout.tabKey(tab, scopeB);
  assert.notEqual(keyA, keyB);

  createFolder(state, { id: 'folder-a', scope: scopeA });
  createFolder(state, { id: 'folder-b', scope: scopeB });
  Model.placeTab(state, keyA, { folderId: 'folder-a' });
  Model.placeTab(state, keyB, { folderId: 'folder-b' });

  const rowA = Layout.layout(state, scopeA, [{ key: keyA, id: tab.id, index: 0 }]).rows.find((row) => row.kind === 'tab');
  const rowB = Layout.layout(state, scopeB, [{ key: keyB, id: tab.id, index: 0 }]).rows.find((row) => row.kind === 'tab');
  assert.equal(rowA.folderId, 'folder-a');
  assert.equal(rowB.folderId, 'folder-b');
});

test('scopes home placements by persistent window identity', () => {
  assert.equal(Layout.scopeKey(undefined, WINDOW_A), `home:${WINDOW_A}`);
  assert.equal(Layout.scopeKey(null, WINDOW_A), `home:${WINDOW_A}`);
  assert.equal(Layout.scopeKey(0, WINDOW_A), `home:${WINDOW_A}`);
  assert.equal(Layout.scopeKey(null, WINDOW_B), `home:${WINDOW_B}`);
  assert.notEqual(Layout.scopeKey(null, WINDOW_A), Layout.scopeKey(null, WINDOW_B));
  assert.equal(Layout.scopeKey(null, ''), null);
  assert.equal(Layout.scopeKey(null, 'not a window id'), null);
  assert.equal(Layout.scopeKey(null, 'x'.repeat(200)), null);
});

test('safely handles malformed metadata and rejects malformed workspace identities', () => {
  assert.deepEqual(Layout.metadata('{'), {});
  assert.deepEqual(Layout.metadata('[]'), {});
  assert.deepEqual(Layout.metadata('null'), {});
  assert.deepEqual(Layout.metadata(null), {});
  assert.deepEqual(Layout.metadata('{"workspaceId":7}'), { workspaceId: 7 });

  assert.equal(Layout.workspaceId({ vivExtData: '{"workspaceId":7}' }), 7);
  assert.equal(Layout.workspaceId({ vivExtData: '{}' }), null);
  assert.equal(Layout.workspaceId({ vivExtData: '{"workspaceId":"7"}' }), null);
  assert.equal(Layout.workspaceId({ vivExtData: '{"workspaceId":9007199254740992}' }), null);
  assert.equal(Layout.scopeKey('7', WINDOW_A), null);
  assert.equal(Layout.scopeKey(Number.MAX_SAFE_INTEGER + 1, WINDOW_A), null);
  assert.equal(Layout.tabKey({ ext_id: '' }, `workspace:7`), null);
  assert.equal(Layout.tabKey({ ext_id: 'x'.repeat(200) }, `workspace:7`), null);

  assert.equal(Layout.inWorkspace({ vivExtData: '{}' }, null), true);
  assert.equal(Layout.inWorkspace({ vivExtData: '{"workspaceId":"7"}' }, null), false);
  assert.equal(Layout.inWorkspace({ vivExtData: '{"workspaceId":7}' }, '7'), false);
  assert.equal(Layout.inWorkspace({ vivExtData: '{"workspaceId":7}', incognito: true }, 7), false);
  assert.equal(Layout.inWorkspace({ vivExtData: '{"panelId":3}' }, null), false);
  assert.equal(Layout.inWorkspace({ vivExtData: '{}', isPanel: true }, null), false);
});

test('keeps folder trees isolated and treats a foreign-scope placement as unfiled', () => {
  const state = Model.emptyState();
  const scopeA = Layout.scopeKey(100, WINDOW_A);
  const scopeB = Layout.scopeKey(200, WINDOW_A);
  createFolder(state, { id: 'a-root', scope: scopeA });
  createFolder(state, { id: 'a-child', scope: scopeA, parentId: 'a-root' });
  createFolder(state, { id: 'b-root', scope: scopeB });

  const inScopeKey = 'workspace:100/tab:in-scope';
  const foreignPlacementKey = 'workspace:100/tab:foreign-placement';
  Model.placeTab(state, inScopeKey, { folderId: 'a-child' });
  Model.placeTab(state, foreignPlacementKey, { folderId: 'b-root' });
  const result = Layout.layout(state, scopeA, [
    { key: inScopeKey, id: 1, index: 0 },
    { key: foreignPlacementKey, id: 2, index: 1 },
  ]);

  assert.deepEqual(result.rows.filter((row) => row.kind === 'folder').map((row) => row.id), ['a-root', 'a-child']);
  assert.equal(result.rows.find((row) => row.key === inScopeKey).folderId, 'a-child');
  assert.equal(result.rows.find((row) => row.key === foreignPlacementKey).folderId, null);
});

test('recursively collapses folders and reports all hidden descendant tabs', () => {
  const state = Model.emptyState();
  const scope = 'workspace:300';
  createFolder(state, { id: 'root', scope });
  createFolder(state, { id: 'child', scope, parentId: 'root' });
  createFolder(state, { id: 'grandchild', scope, parentId: 'child' });
  const tabs = [
    { key: `${scope}/tab:root-tab`, id: 1, index: 0, folderId: 'root' },
    { key: `${scope}/tab:child-tab`, id: 2, index: 1, folderId: 'child' },
    { key: `${scope}/tab:grandchild-tab`, id: 3, index: 2, folderId: 'grandchild' },
  ];
  for (const tab of tabs) Model.placeTab(state, tab.key, { folderId: tab.folderId });

  Model.setCollapsed(state, 'root', true);
  let result = Layout.layout(state, scope, tabs.map(({ key, id, index }) => ({ key, id, index })));
  assert.deepEqual(result.rows.map((row) => [row.kind, row.id]), [['folder', 'root']]);
  assert.equal(result.rows[0].count, 3);
  assert.deepEqual(result.hiddenTabKeys, [tabs[2].key, tabs[1].key, tabs[0].key]);

  Model.setCollapsed(state, 'root', false);
  Model.setCollapsed(state, 'child', true);
  result = Layout.layout(state, scope, tabs.map(({ key, id, index }) => ({ key, id, index })));
  assert.deepEqual(result.rows.map((row) => row.kind === 'folder' ? row.id : row.key), [
    'root', 'child', tabs[0].key,
  ]);
  assert.equal(result.rows.find((row) => row.id === 'root').count, 3);
  assert.equal(result.rows.find((row) => row.id === 'child').count, 2);
  assert.deepEqual(result.hiddenTabKeys, [tabs[2].key, tabs[1].key]);

  Model.setCollapsed(state, 'child', false);
  result = Layout.layout(state, scope, tabs.map(({ key, id, index }) => ({ key, id, index })));
  assert.deepEqual(result.rows.map((row) => row.kind === 'folder' ? row.id : row.key), [
    'root', 'child', 'grandchild', tabs[2].key, tabs[1].key, tabs[0].key,
  ]);
  assert.deepEqual(result.rows.map((row) => row.depth), [0, 1, 2, 3, 2, 1]);
  assert.deepEqual(result.hiddenTabKeys, []);
});

test('orders tabs by saved placement and native fallback, with variable row geometry', () => {
  const state = Model.emptyState();
  const scope = 'workspace:400';
  createFolder(state, { id: 'ordered', scope });
  const keyA = `${scope}/tab:a`;
  const keyB = `${scope}/tab:b`;
  const keyC = `${scope}/tab:c`;
  Model.placeTab(state, keyA, { folderId: 'ordered' });
  Model.placeTab(state, keyB, { folderId: 'ordered' });
  Model.placeTab(state, keyC, { folderId: 'ordered', beforeKey: keyA });

  const result = Layout.layout(state, scope, [
    { key: keyA, id: 1, index: 0, height: 45 },
    { key: keyB, id: 2, index: 1 },
    { key: keyC, id: 3, index: 2, height: 25 },
    { key: `${scope}/tab:z`, id: 4, index: 5 },
    { key: `${scope}/tab:d`, id: 5, index: 4 },
    { key: `${scope}/tab:c-fallback`, id: 6, index: 4 },
  ], { rowHeight: 40, baseY: 100 });

  assert.deepEqual(result.rows.map((row) => row.kind === 'folder' ? row.id : row.key), [
    'ordered', keyC, keyA, keyB, `${scope}/tab:c-fallback`, `${scope}/tab:d`, `${scope}/tab:z`,
  ]);
  assert.deepEqual(result.rows.map((row) => row.y), [100, 140, 165, 210, 250, 290, 330]);
  assert.deepEqual(result.rows.map((row) => row.height), [40, 25, 45, 40, 40, 40, 40]);
  assert.equal(result.height, 270);
});

test('does not mutate state, live tabs, or options', () => {
  const state = Model.emptyState();
  const scope = 'workspace:500';
  createFolder(state, { id: 'folder', scope });
  const key = `${scope}/tab:one`;
  Model.placeTab(state, key, { folderId: 'folder' });
  const liveTabs = [{ key, id: 1, index: 0, height: 37 }];
  const options = { rowHeight: 35, baseY: 12 };
  const before = JSON.stringify({ state, liveTabs, options });
  deepFreeze(state);
  deepFreeze(liveTabs);
  deepFreeze(options);

  Layout.layout(state, scope, liveTabs, options);
  assert.equal(JSON.stringify({ state, liveTabs, options }), before);
});

test('rejects duplicate live keys and invalid geometry', () => {
  const state = Model.emptyState();
  const scope = 'workspace:600';
  const tab = { key: `${scope}/tab:one`, id: 1, index: 0 };
  assert.throws(() => Layout.layout(state, scope, [tab, { ...tab, index: 1 }]), /duplicate live tab key/);
  assert.throws(() => Layout.layout(state, scope, [tab], { rowHeight: 19 }), /rowHeight/);
  assert.throws(() => Layout.layout(state, scope, [tab], { rowHeight: 129 }), /rowHeight/);
  assert.throws(() => Layout.layout(state, scope, [tab], { rowHeight: NaN }), /rowHeight/);
  assert.throws(() => Layout.layout(state, scope, [tab], { baseY: -1 }), /baseY/);
  assert.throws(() => Layout.layout(state, scope, [tab], { baseY: Infinity }), /baseY/);
  assert.throws(() => Layout.layout(state, scope, [{ ...tab, height: 19 }]), /tab height/);
  assert.throws(() => Layout.layout(state, scope, [{ ...tab, height: 513 }]), /tab height/);
  assert.throws(() => Layout.layout(state, scope, [{ ...tab, height: NaN }]), /tab height/);
  assert.throws(() => Layout.layout(state, scope, [{ ...tab, index: Infinity }]), /index/);
  assert.throws(() => Layout.layout(state, scope, [{ ...tab, key: '' }]), /tab key/);
});
