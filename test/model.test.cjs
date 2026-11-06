const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const Model = require('../src/model.js');

test('exports a browser global and a CommonJS API', () => {
  assert.equal(globalThis.ArcFoldersModel, Model);
  const browserContext = {};
  vm.runInNewContext(fs.readFileSync(require.resolve('../src/model.js'), 'utf8'), browserContext);
  assert.equal(browserContext.ArcFoldersModel.emptyState().version, 1);
});

test('empty state has the versioned persistence shape', () => {
  assert.deepEqual(Model.emptyState(), { version: 1, folders: [], tabs: {} });
});

test('creates and queries a scoped hierarchy', () => {
  const state = Model.emptyState();
  Model.createFolder(state, { id: 'work', name: ' Work ', scope: 'window-1' });
  Model.createFolder(state, { id: 'projects', name: 'Projects', parentId: 'work', scope: 'window-1' });
  Model.createFolder(state, { id: 'home', name: 'Home', scope: 'window-1' });

  assert.deepEqual(Model.children(state, 'window-1').map((folder) => folder.id), ['work', 'home']);
  assert.deepEqual(Model.children(state, 'window-1', 'work').map((folder) => folder.id), ['projects']);
  assert.deepEqual([...Model.descendants(state, 'work')].sort(), ['projects', 'work']);
  assert.equal(Model.folderPath(state, 'projects'), 'Work / Projects');
  assert.equal(Model.folderPath(state, 'missing'), null);
});

test('capacity limits reject new entries without corrupting existing state', () => {
  const state = Model.emptyState();
  state.folders = Array.from({ length: Model.MAX_FOLDERS }, (_, index) => ({ id: `f-${index}`, name: `Folder ${index}`, scope: 's', parentId: null, collapsed: false, order: index }));
  assert.throws(() => Model.createFolder(state, { id: 'overflow', name: 'Overflow', scope: 's' }), /count cannot exceed/);
  assert.equal(state.folders.length, Model.MAX_FOLDERS);
  state.tabs = Object.fromEntries(Array.from({ length: Model.MAX_TABS }, (_, index) => [`tab-${index}`, { folderId: null, order: index }]));
  assert.throws(() => Model.placeTab(state, 'overflow'), /count cannot exceed/);
  assert.equal(Object.keys(state.tabs).length, Model.MAX_TABS);
  assert.equal(Model.placeTab(state, 'tab-0', { folderId: null }).folderId, null);
});

test('validates and trims folder names', () => {
  const state = Model.emptyState();
  const folder = Model.createFolder(state, { id: 'one', name: '  Reading  ', scope: 'window-1' });
  assert.equal(folder.name, 'Reading');
  assert.throws(() => Model.createFolder(state, { id: 'two', name: '  ', scope: 'window-1' }));
  assert.throws(() => Model.createFolder(state, { id: 'three', name: 'x'.repeat(121), scope: 'window-1' }));
  assert.throws(() => Model.renameFolder(state, 'one', ''));
  assert.equal(Model.renameFolder(state, 'one', '  Articles  ').name, 'Articles');
});

test('reorders siblings and rejects cycles, descendants, and invalid targets', () => {
  const state = Model.emptyState();
  Model.createFolder(state, { id: 'parent', name: 'Parent', scope: 's' });
  Model.createFolder(state, { id: 'a', name: 'A', parentId: 'parent', scope: 's' });
  Model.createFolder(state, { id: 'b', name: 'B', parentId: 'parent', scope: 's' });
  Model.createFolder(state, { id: 'c', name: 'C', scope: 's' });

  Model.moveFolder(state, 'b', 'parent', { beforeId: 'a' });
  assert.deepEqual(Model.children(state, 's', 'parent').map((folder) => folder.id), ['b', 'a']);
  Model.moveFolder(state, 'a', null, { beforeId: 'c' });
  assert.deepEqual(Model.children(state, 's').map((folder) => folder.id), ['parent', 'a', 'c']);

  assert.throws(() => Model.moveFolder(state, 'parent', 'b'));
  assert.throws(() => Model.moveFolder(state, 'parent', 'parent'));
  assert.throws(() => Model.moveFolder(state, 'a', 'missing'));
});

test('enforces scopes and maximum folder depth', () => {
  const state = Model.emptyState();
  Model.createFolder(state, { id: 'root', name: 'Root', scope: 'one' });
  Model.createFolder(state, { id: 'other-root', name: 'Other', scope: 'two' });
  assert.throws(() => Model.createFolder(state, { id: 'bad', name: 'Bad', parentId: 'root', scope: 'two' }));
  assert.throws(() => Model.moveFolder(state, 'root', 'other-root'));

  let parentId = null;
  for (let depth = 1; depth <= Model.MAX_DEPTH; depth += 1) {
    const id = `depth-${depth}`;
    Model.createFolder(state, { id, name: id, parentId, scope: 'deep' });
    parentId = id;
  }
  assert.throws(() => Model.createFolder(state, { id: 'too-deep', name: 'Too deep', parentId, scope: 'deep' }));
});

test('places and reorders tabs without storing metadata', () => {
  const state = Model.emptyState();
  Model.createFolder(state, { id: 'saved', name: 'Saved', scope: 's' });
  Model.placeTab(state, 'tab-a');
  Model.placeTab(state, 'tab-b');
  Model.placeTab(state, 'tab-c', { beforeKey: 'tab-a' });
  Model.placeTab(state, 'tab-a', { folderId: 'saved' });
  Model.placeTab(state, 'tab-b', { folderId: 'saved', beforeKey: 'tab-a' });

  assert.deepEqual(Object.keys(state.tabs), ['tab-a', 'tab-b', 'tab-c']);
  assert.equal(state.tabs['tab-b'].folderId, 'saved');
  assert.equal(state.tabs['tab-b'].order, 0);
  assert.equal(state.tabs['tab-a'].order, 1);
  assert.equal(state.tabs['tab-c'].folderId, null);
  assert.equal(Model.tabFolder(state, 'tab-a', 's'), 'saved');
  assert.equal(Model.tabFolder(state, 'tab-a', 'other'), null);
  assert.equal(Model.tabFolder(state, null, 's'), null);
  assert.throws(() => Model.placeTab(state, 'new-tab', { folderId: 'missing' }));
  assert.throws(() => Model.placeTab(state, 'tab-c', { beforeKey: 'tab-a' }));
  assert.deepEqual(Object.keys(state.tabs['tab-a']).sort(), ['folderId', 'order']);
});

test('removing a folder unwraps its children and tab assignments', () => {
  const state = Model.emptyState();
  Model.createFolder(state, { id: 'parent', name: 'Parent', scope: 's' });
  Model.createFolder(state, { id: 'remove', name: 'Remove', parentId: 'parent', scope: 's' });
  Model.createFolder(state, { id: 'child-a', name: 'Child A', parentId: 'remove', scope: 's' });
  Model.createFolder(state, { id: 'child-b', name: 'Child B', parentId: 'remove', scope: 's' });
  Model.createFolder(state, { id: 'sibling', name: 'Sibling', parentId: 'parent', scope: 's' });
  Model.placeTab(state, 'kept-tab', { folderId: 'remove' });
  Model.placeTab(state, 'child-tab', { folderId: 'child-a' });

  Model.removeFolder(state, 'remove');

  assert.deepEqual(Model.children(state, 's', 'parent').map((folder) => folder.id), ['child-a', 'child-b', 'sibling']);
  assert.equal(state.tabs['kept-tab'].folderId, 'parent');
  assert.equal(state.tabs['child-tab'].folderId, 'child-a');
  assert.equal(Model.tabFolder(state, 'kept-tab', 's'), 'parent');
  assert.equal(state.folders.some((folder) => folder.id === 'remove'), false);
});

test('normalize repairs invalid links, cross-scope links, cycles, and bad tab references', () => {
  const state = Model.normalize({
    version: 999,
    folders: [
      { id: 'a', name: ' A ', scope: 's', parentId: 'b', order: 4 },
      { id: 'b', name: 'B', scope: 's', parentId: 'a', order: 2 },
      { id: 'c', name: 'C', scope: 'other', parentId: 'a', order: 0 },
      { id: 'd', name: 'D', scope: 's', parentId: 'missing', order: 0 },
      { id: 'e', name: 'E', scope: 's', parentId: null, order: 0 },
      { id: 'invalid-name', name: '   ', scope: 's' },
      { id: 'bad-id', name: 'Bad', scope: 3 },
    ],
    tabs: {
      valid: { folderId: 'a', order: 9 },
      missing: { folderId: 'missing', order: 0 },
      malformed: { folderId: 4, order: 1 },
    },
  });

  assert.deepEqual(state.folders.map((folder) => folder.id).sort(), ['a', 'b', 'c', 'd', 'e']);
  assert.equal(state.folders.find((folder) => folder.id === 'a').parentId, null);
  assert.equal(state.folders.find((folder) => folder.id === 'b').parentId, 'a');
  assert.equal(state.folders.find((folder) => folder.id === 'c').parentId, null);
  assert.equal(state.folders.find((folder) => folder.id === 'd').parentId, null);
  assert.equal(state.tabs.valid.folderId, 'a');
  assert.equal(state.tabs.missing.folderId, null);
  assert.equal(state.tabs.malformed.folderId, null);
  assert.deepEqual(state.folders.filter((folder) => folder.parentId === null && folder.scope === 's').map((folder) => folder.order), [0, 1, 2]);
});

test('normalize bounds depth and accepts only safe plain records', () => {
  const folders = [];
  for (let index = 0; index < 20; index += 1) {
    folders.push({ id: `f${index}`, name: `Folder ${index}`, scope: 's', parentId: index ? `f${index - 1}` : null, order: index });
  }
  folders.push({ id: 'constructor', name: 'Unsafe key', scope: 's' });
  const normalized = Model.normalize({ folders, tabs: new Date() });
  assert.equal(normalized.folders.length, 20);
  assert.ok(normalized.folders.every((folder) => Model.folderPath(normalized, folder.id) !== null));
  assert.ok(Math.max(...normalized.folders.map((folder) => Model.folderPath(normalized, folder.id).split(' / ').length)) <= Model.MAX_DEPTH);
  assert.deepEqual(normalized.tabs, {});
  assert.deepEqual(Model.normalize(new Date()), { version: 1, folders: [], tabs: {} });
});

test('rejects prototype keys and never pollutes Object.prototype', () => {
  const maliciousTabs = JSON.parse('{"__proto__":{"folderId":null,"order":0},"constructor":{"folderId":null,"order":1},"prototype":{"folderId":null,"order":2},"safe":{"folderId":null,"order":3}}');
  const normalized = Model.normalize({ folders: [], tabs: maliciousTabs });
  assert.deepEqual(Object.keys(normalized.tabs), ['safe']);
  assert.equal(({}).polluted, undefined);
  assert.throws(() => Model.placeTab(Model.emptyState(), '__proto__'));
  assert.throws(() => Model.createFolder(Model.emptyState(), { id: 'constructor', name: 'Unsafe', scope: 's' }));
});

test('normalized state survives a JSON persistence roundtrip', () => {
  const state = Model.emptyState();
  Model.createFolder(state, { id: 'root', name: 'Root', scope: 's' });
  Model.createFolder(state, { id: 'child', name: 'Child', parentId: 'root', scope: 's' });
  Model.placeTab(state, 'tab-x', { folderId: 'child' });
  const restored = Model.normalize(JSON.parse(JSON.stringify(state)));
  assert.deepEqual(restored, state);
});
