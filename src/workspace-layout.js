(function (root, factory) {
  'use strict';

  const model = typeof module === 'object' && module && module.exports
    ? require('./model.js')
    : root && root.ArcFoldersModel;
  const api = factory(model);
  if (root) root.ArcWorkspaceLayout = api;
  if (typeof module === 'object' && module && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (M) {
  'use strict';

  const RESERVED_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
  const MISSING = Symbol('missing');
  const MAX_SCOPE_LENGTH = 256;
  const MAX_EXT_ID_LENGTH = 199;
  const MAX_TAB_KEY_LENGTH = 511;
  const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

  if (
    !M || typeof M.children !== 'function' || typeof M.tabFolder !== 'function'
  ) throw new Error('ArcWorkspaceLayout requires ArcFoldersModel');

  function isPlainObject(value) {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
    try {
      const prototype = Object.getPrototypeOf(value);
      return prototype === Object.prototype || prototype === null;
    } catch (_) {
      return false;
    }
  }

  function ownData(value, key) {
    if (value === null || (typeof value !== 'object' && typeof value !== 'function')) return MISSING;
    try {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) return MISSING;
      return descriptor.value;
    } catch (_) {
      return MISSING;
    }
  }

  function metadata(value) {
    let parsed = value;
    if (typeof value === 'string') {
      try {
        parsed = JSON.parse(value);
      } catch (_) {
        return {};
      }
    }
    return isPlainObject(parsed) ? parsed : {};
  }

  function tabMetadata(tab) {
    return metadata(ownData(tab, 'vivExtData'));
  }

  function workspaceStatus(value) {
    if (value === MISSING || value === undefined || value === null || value === 0) return { valid: true, id: null };
    if (Number.isSafeInteger(value) && value > 0) return { valid: true, id: value };
    return { valid: false, id: null };
  }

  function rawWorkspaceStatus(tab) {
    return workspaceStatus(ownData(tabMetadata(tab), 'workspaceId'));
  }

  function workspaceId(tab) {
    const status = rawWorkspaceStatus(tab);
    return status.valid ? status.id : null;
  }

  function isWindowPersistentId(value) {
    return typeof value === 'string' && value.length > 0 && value.length < 200 &&
      /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value);
  }

  function scopeKey(activeWorkspaceId, windowPersistentId) {
    const workspace = workspaceStatus(activeWorkspaceId);
    if (!workspace.valid) return null;
    if (workspace.id !== null) return `workspace:${workspace.id}`;
    if (!isWindowPersistentId(windowPersistentId)) return null;
    return `home:${windowPersistentId}`;
  }

  function isSafeOpaqueString(value, maxLength) {
    return typeof value === 'string' && value.length > 0 && value.length <= maxLength &&
      value.trim().length > 0 && !RESERVED_KEYS.has(value) && !CONTROL_CHARACTERS.test(value);
  }

  function isScopeString(value) {
    return isSafeOpaqueString(value, MAX_SCOPE_LENGTH);
  }

  function tabKey(tab, scope) {
    const extId = ownData(tab, 'ext_id');
    if (!isSafeOpaqueString(extId, MAX_EXT_ID_LENGTH) || !isScopeString(scope)) return null;
    const key = `${scope}/tab:${extId}`;
    return key.length <= MAX_TAB_KEY_LENGTH ? key : null;
  }

  function isPanelTab(tab, meta) {
    const panelId = ownData(meta, 'panelId');
    return ownData(tab, 'isPanel') === true || ownData(tab, 'panel') === true ||
      ownData(tab, 'type') === 'panel' || ownData(tab, 'type') === 'vivaldi_panel' ||
      (panelId !== MISSING && Boolean(panelId));
  }

  function inWorkspace(tab, activeWorkspaceId) {
    if (!isPlainObject(tab)) return false;
    if (ownData(tab, 'incognito') === true || ownData(tab, 'isIncognito') === true || ownData(tab, 'private') === true) return false;
    const meta = tabMetadata(tab);
    if (isPanelTab(tab, meta)) return false;

    const active = workspaceStatus(activeWorkspaceId);
    const tabWorkspace = workspaceStatus(ownData(meta, 'workspaceId'));
    return active.valid && tabWorkspace.valid && active.id === tabWorkspace.id;
  }

  function requireLayoutInputs(state, scope, liveTabs, options) {
    if (!isScopeString(scope)) throw new TypeError('scope must be a safe non-empty string');
    if (!Array.isArray(liveTabs)) throw new TypeError('liveTabs must be an array');
    if (options === undefined) options = {};
    if (!isPlainObject(options)) throw new TypeError('layout options must be a plain object');

    const rowHeightValue = ownData(options, 'rowHeight');
    const baseYValue = ownData(options, 'baseY');
    const rowHeight = rowHeightValue === MISSING || rowHeightValue === undefined ? 33 : rowHeightValue;
    const baseY = baseYValue === MISSING || baseYValue === undefined ? 0 : baseYValue;
    if (!Number.isFinite(rowHeight) || rowHeight < 20 || rowHeight > 128) {
      throw new RangeError('rowHeight must be finite and between 20 and 128');
    }
    if (!Number.isFinite(baseY) || baseY < 0) throw new RangeError('baseY must be finite and non-negative');

    const seenKeys = new Set();
    const tabs = [];
    for (let index = 0; index < liveTabs.length; index += 1) {
      const liveTab = ownData(liveTabs, String(index));
      if (!isPlainObject(liveTab)) throw new TypeError('each live tab must be a plain object');
      const key = ownData(liveTab, 'key');
      const id = ownData(liveTab, 'id');
      const nativeIndex = ownData(liveTab, 'index');
      const heightValue = ownData(liveTab, 'height');
      if (!isSafeOpaqueString(key, MAX_TAB_KEY_LENGTH)) throw new TypeError('live tab key must be a safe non-empty string');
      if (seenKeys.has(key)) throw new TypeError(`duplicate live tab key: ${key}`);
      seenKeys.add(key);
      if (!(typeof id === 'string' && id.length > 0) && !Number.isSafeInteger(id)) {
        throw new TypeError('live tab id must be a non-empty string or safe integer');
      }
      if (!Number.isSafeInteger(nativeIndex) || nativeIndex < 0) {
        throw new TypeError('live tab index must be a non-negative safe integer');
      }
      const height = heightValue === MISSING || heightValue === undefined ? rowHeight : heightValue;
      if (!Number.isFinite(height) || height < 20 || height > 512) {
        throw new RangeError('tab height must be finite and between 20 and 512');
      }
      tabs.push({ key, id, index: nativeIndex, height });
    }

    return { rowHeight, baseY, tabs };
  }

  function placementOrder(state, key, folderId) {
    const stateTabs = ownData(state, 'tabs');
    const record = ownData(stateTabs, key);
    if (!isPlainObject(record)) return null;
    const savedFolderId = ownData(record, 'folderId');
    if (folderId === null) {
      if (savedFolderId !== null) return null;
    } else if (savedFolderId !== folderId) {
      return null;
    }
    const order = ownData(record, 'order');
    return Number.isSafeInteger(order) && order >= 0 ? order : null;
  }

  function compareText(left, right) {
    return left < right ? -1 : left > right ? 1 : 0;
  }

  function sortTabs(state, tabs, folderId) {
    return tabs.map((tab) => ({
      ...tab,
      order: placementOrder(state, tab.key, folderId),
    })).sort((left, right) => {
      if (left.order !== right.order) {
        if (left.order === null) return 1;
        if (right.order === null) return -1;
        return left.order - right.order;
      }
      return left.index - right.index || compareText(left.key, right.key);
    });
  }

  function layout(state, scope, liveTabs, options) {
    const inputs = requireLayoutInputs(state, scope, liveTabs, options);
    const { rowHeight, baseY, tabs } = inputs;
    const rootsFromModel = M.children(state, scope);
    const roots = rootsFromModel.map((folder) => ({ folder, children: [], depth: 0 }));
    const folderNodes = [];
    const seenFolderIds = new Set();
    const pending = roots.slice().reverse();

    while (pending.length > 0) {
      const node = pending.pop();
      if (seenFolderIds.has(node.folder.id)) throw new TypeError('state contains an invalid folder tree');
      seenFolderIds.add(node.folder.id);
      folderNodes.push(node);
      const children = M.children(state, scope, node.folder.id);
      node.children = children.map((folder) => ({ folder, children: [], depth: node.depth + 1 }));
      for (let index = node.children.length - 1; index >= 0; index -= 1) pending.push(node.children[index]);
    }

    const byFolder = new Map();
    const unfiled = [];
    for (const tab of tabs) {
      const folderId = M.tabFolder(state, tab.key, scope);
      const order = placementOrder(state, tab.key, folderId);
      const placed = { ...tab, folderId, order };
      if (folderId === null) unfiled.push(placed);
      else {
        const list = byFolder.get(folderId) || [];
        list.push(placed);
        byFolder.set(folderId, list);
      }
    }

    for (const [folderId, list] of byFolder) byFolder.set(folderId, sortTabs(state, list, folderId));
    const sortedUnfiled = sortTabs(state, unfiled, null);

    for (let index = folderNodes.length - 1; index >= 0; index -= 1) {
      const node = folderNodes[index];
      node.count = (byFolder.get(node.folder.id) || []).length +
        node.children.reduce((total, child) => total + child.count, 0);
    }

    const rows = [];
    const hiddenTabKeys = [];
    let y = baseY;
    let totalHeight = 0;

    function appendRow(row) {
      const nextY = y + row.height;
      const nextTotalHeight = totalHeight + row.height;
      if (!Number.isFinite(y) || !Number.isFinite(nextY) || !Number.isFinite(nextTotalHeight)) {
        throw new RangeError('layout geometry must remain finite');
      }
      rows.push({ ...row, y });
      y = nextY;
      totalHeight = nextTotalHeight;
    }

    function appendHiddenTabs(folderNode) {
      const stack = [{ node: folderNode, afterChildren: false }];
      while (stack.length > 0) {
        const item = stack.pop();
        if (item.afterChildren) {
          for (const tab of byFolder.get(item.node.folder.id) || []) hiddenTabKeys.push(tab.key);
        } else {
          stack.push({ node: item.node, afterChildren: true });
          for (let index = item.node.children.length - 1; index >= 0; index -= 1) {
            stack.push({ node: item.node.children[index], afterChildren: false });
          }
        }
      }
    }

    const render = [];
    for (let index = roots.length - 1; index >= 0; index -= 1) render.push({ kind: 'folder', node: roots[index] });
    while (render.length > 0) {
      const item = render.pop();
      if (item.kind === 'tab') {
        const tab = item.tab;
        appendRow({ kind: 'tab', key: tab.key, id: tab.id, folderId: tab.folderId, depth: item.depth, height: tab.height });
        continue;
      }

      const node = item.node;
      const folder = node.folder;
      appendRow({
        kind: 'folder',
        id: folder.id,
        parentId: folder.parentId,
        name: folder.name,
        collapsed: folder.collapsed,
        depth: node.depth,
        height: rowHeight,
        count: node.count,
      });
      if (folder.collapsed) {
        appendHiddenTabs(node);
        continue;
      }

      const directTabs = byFolder.get(folder.id) || [];
      for (let index = directTabs.length - 1; index >= 0; index -= 1) {
        render.push({ kind: 'tab', tab: directTabs[index], depth: node.depth + 1 });
      }
      for (let index = node.children.length - 1; index >= 0; index -= 1) {
        render.push({ kind: 'folder', node: node.children[index] });
      }
    }

    for (const tab of sortedUnfiled) {
      appendRow({ kind: 'tab', key: tab.key, id: tab.id, folderId: null, depth: 0, height: tab.height });
    }

    return { rows, hiddenTabKeys, height: totalHeight };
  }

  return Object.freeze({ metadata, workspaceId, scopeKey, tabKey, inWorkspace, layout });
});
