(function (root, factory) {
  'use strict';

  const api = factory();
  if (root) root.ArcFoldersModel = api;
  if (typeof module === 'object' && module && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const MAX_DEPTH = 16;
  const MAX_FOLDERS = 2000;
  const MAX_TABS = 10000;
  const MAX_ID_LENGTH = 256;
  const MAX_SCOPE_LENGTH = 256;
  const MAX_TAB_KEY_LENGTH = 512;
  const RESERVED_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
  const MISSING = Symbol('missing');

  function emptyState() {
    return { version: 1, folders: [], tabs: {} };
  }

  function isPlainObject(value) {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
    try {
      const prototype = Object.getPrototypeOf(value);
      return prototype === Object.prototype || prototype === null;
    } catch (_) {
      return false;
    }
  }

  function isPlainArray(value) {
    if (!Array.isArray(value)) return false;
    try {
      return Object.getPrototypeOf(value) === Array.prototype;
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

  function safeSet(object, key, value) {
    Object.defineProperty(object, key, {
      value,
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }

  function compareText(left, right) {
    return left < right ? -1 : left > right ? 1 : 0;
  }

  function isSafeIdentifier(value, maxLength) {
    return typeof value === 'string' && value.length > 0 && value.length <= maxLength && !RESERVED_KEYS.has(value);
  }

  function requireIdentifier(value, label, maxLength) {
    if (!isSafeIdentifier(value, maxLength)) throw new TypeError(`${label} must be a safe non-empty string`);
    return value;
  }

  function requireScope(value) {
    if (typeof value !== 'string' || value.length > MAX_SCOPE_LENGTH) {
      throw new TypeError(`scope must be a string of at most ${MAX_SCOPE_LENGTH} characters`);
    }
    return value;
  }

  function requireName(value) {
    if (typeof value !== 'string') throw new TypeError('name must be a string');
    const name = value.trim();
    if (name.length < 1 || name.length > 120) throw new RangeError('name must contain 1 to 120 trimmed characters');
    return name;
  }

  function optionValue(options, key, fallback) {
    const value = ownData(options, key);
    return value === MISSING || value === undefined ? fallback : value;
  }

  function requireOptions(options, label) {
    if (options === undefined) return {};
    if (!isPlainObject(options)) throw new TypeError(`${label} options must be a plain object`);
    return options;
  }

  function stateParts(state) {
    if (!isPlainObject(state)) throw new TypeError('state must be a plain object');
    const version = ownData(state, 'version');
    const folders = ownData(state, 'folders');
    const tabs = ownData(state, 'tabs');
    if (version !== 1 || !isPlainArray(folders) || folders.length > MAX_FOLDERS || !isPlainObject(tabs)) {
      throw new TypeError('state must be a version 1 ArcFolders model state');
    }
    return { folders, tabs };
  }

  function folderFields(folder) {
    if (!isPlainObject(folder)) return null;
    const id = ownData(folder, 'id');
    const name = ownData(folder, 'name');
    const parentId = ownData(folder, 'parentId');
    const scope = ownData(folder, 'scope');
    const collapsed = ownData(folder, 'collapsed');
    const order = ownData(folder, 'order');
    if (
      !isSafeIdentifier(id, MAX_ID_LENGTH) ||
      typeof name !== 'string' || name !== name.trim() || name.length < 1 || name.length > 120 ||
      (parentId !== null && !isSafeIdentifier(parentId, MAX_ID_LENGTH)) ||
      typeof scope !== 'string' || scope.length > MAX_SCOPE_LENGTH ||
      typeof collapsed !== 'boolean' || !Number.isSafeInteger(order) || order < 0
    ) return null;
    return { id, name, parentId, scope, collapsed, order };
  }

  function folderList(state) {
    const { folders } = stateParts(state);
    const result = [];
    const ids = new Set();
    for (let index = 0; index < folders.length; index += 1) {
      const folder = ownData(folders, String(index));
      const fields = folderFields(folder);
      if (!fields || ids.has(fields.id)) throw new TypeError('state contains an invalid or duplicate folder');
      ids.add(fields.id);
      result.push(folder);
    }
    return result;
  }

  function folderMap(folders) {
    const result = new Map();
    for (const folder of folders) result.set(folder.id, folder);
    return result;
  }

  function findFolder(folders, id) {
    for (const folder of folders) {
      if (folder.id === id) return folder;
    }
    return null;
  }

  function requireFolder(folders, id) {
    const folder = findFolder(folders, id);
    if (!folder) throw new RangeError(`folder not found: ${String(id)}`);
    return folder;
  }

  function sortedFolderChildren(folders, scope, parentId) {
    return folders
      .filter((folder) => folder.scope === scope && folder.parentId === parentId)
      .sort((left, right) => left.order - right.order || compareText(left.id, right.id));
  }

  function assignFolderOrders(folders) {
    folders.forEach((folder, index) => {
      folder.order = index;
    });
  }

  function depthOf(folders, id) {
    const byId = folderMap(folders);
    const seen = new Set();
    let folder = byId.get(id);
    let depth = 0;
    while (folder) {
      if (seen.has(folder.id)) throw new TypeError('state contains a folder cycle');
      seen.add(folder.id);
      depth += 1;
      if (folder.parentId === null) break;
      folder = byId.get(folder.parentId);
      if (!folder) throw new TypeError('state contains a missing parent folder');
    }
    return depth;
  }

  function descendantsFor(folders, id) {
    const rootFolder = findFolder(folders, id);
    if (!rootFolder) throw new RangeError(`folder not found: ${String(id)}`);
    const result = new Set([id]);
    const queue = [id];
    for (let index = 0; index < queue.length; index += 1) {
      const parent = findFolder(folders, queue[index]);
      if (!parent) continue;
      for (const child of sortedFolderChildren(folders, parent.scope, parent.id)) {
        if (!result.has(child.id)) {
          result.add(child.id);
          queue.push(child.id);
        }
      }
    }
    return result;
  }

  function subtreeHeight(folders, id) {
    const root = requireFolder(folders, id);
    const stack = [{ folder: root, depth: 1 }];
    let maximum = 1;
    while (stack.length > 0) {
      const current = stack.pop();
      maximum = Math.max(maximum, current.depth);
      const children = sortedFolderChildren(folders, root.scope, current.folder.id);
      for (const child of children) stack.push({ folder: child, depth: current.depth + 1 });
    }
    return maximum;
  }

  function tabRecords(tabs) {
    const records = [];
    let keys;
    try {
      keys = Object.keys(tabs).slice(0, MAX_TABS);
    } catch (_) {
      return records;
    }
    for (let index = 0; index < keys.length; index += 1) {
      const key = keys[index];
      if (!isSafeIdentifier(key, MAX_TAB_KEY_LENGTH)) continue;
      const record = ownData(tabs, key);
      if (!isPlainObject(record)) continue;
      const folderId = ownData(record, 'folderId');
      const order = ownData(record, 'order');
      if ((folderId !== null && !isSafeIdentifier(folderId, MAX_ID_LENGTH)) || !Number.isSafeInteger(order) || order < 0) continue;
      records.push({ key, folderId, order, inputIndex: index });
    }
    return records;
  }

  function sortedTabKeys(tabs, folderId) {
    return tabRecords(tabs)
      .filter((record) => record.folderId === folderId)
      .sort((left, right) => left.order - right.order || compareText(left.key, right.key))
      .map((record) => record.key);
  }

  function assignTabOrders(tabs, keys, folderId) {
    keys.forEach((key, index) => {
      const record = ownData(tabs, key);
      if (!isPlainObject(record)) throw new TypeError('state contains an invalid tab placement');
      record.folderId = folderId;
      record.order = index;
    });
  }

  function normalizeFolders(value) {
    if (!isPlainArray(value)) return [];
    let length;
    try {
      length = Math.min(value.length, MAX_FOLDERS);
    } catch (_) {
      return [];
    }

    const folders = [];
    const byId = new Map();
    for (let index = 0; index < length; index += 1) {
      const source = ownData(value, String(index));
      if (!isPlainObject(source)) continue;
      const id = ownData(source, 'id');
      const nameValue = ownData(source, 'name');
      const parentValue = ownData(source, 'parentId');
      const scope = ownData(source, 'scope');
      const collapsedValue = ownData(source, 'collapsed');
      const orderValue = ownData(source, 'order');
      if (!isSafeIdentifier(id, MAX_ID_LENGTH) || byId.has(id)) continue;
      if (typeof nameValue !== 'string') continue;
      const name = nameValue.trim();
      if (name.length < 1 || name.length > 120) continue;
      if (typeof scope !== 'string' || scope.length > MAX_SCOPE_LENGTH) continue;

      const folder = {
        id,
        name,
        parentId: parentValue === null || parentValue === MISSING ? null : parentValue,
        scope,
        collapsed: typeof collapsedValue === 'boolean' ? collapsedValue : false,
        order: Number.isSafeInteger(orderValue) ? orderValue : index,
        inputIndex: index,
      };
      folders.push(folder);
      byId.set(id, folder);
    }

    for (const folder of folders) {
      if (
        folder.parentId !== null &&
        (!isSafeIdentifier(folder.parentId, MAX_ID_LENGTH) || !byId.has(folder.parentId) || folder.parentId === folder.id || byId.get(folder.parentId).scope !== folder.scope)
      ) folder.parentId = null;
    }

    const sortedById = folders.slice().sort((left, right) => compareText(left.id, right.id));
    const completed = new Set();
    for (const start of sortedById) {
      if (completed.has(start.id)) continue;
      const path = [];
      const positions = new Map();
      let current = start;
      while (current && !completed.has(current.id)) {
        if (positions.has(current.id)) {
          const cycle = path.slice(positions.get(current.id));
          cycle.sort((left, right) => compareText(left.id, right.id));
          cycle[0].parentId = null;
          break;
        }
        positions.set(current.id, path.length);
        path.push(current);
        current = current.parentId === null ? null : byId.get(current.parentId);
      }
      for (const folder of path) completed.add(folder.id);
    }

    for (const folder of sortedById) {
      let depth = 0;
      let current = folder;
      const visited = new Set();
      while (current) {
        if (visited.has(current.id)) break;
        visited.add(current.id);
        depth += 1;
        current = current.parentId === null ? null : byId.get(current.parentId);
      }
      if (depth > MAX_DEPTH) folder.parentId = null;
    }

    const comparePosition = (left, right) => {
      const scopeOrder = compareText(left.scope, right.scope);
      if (scopeOrder) return scopeOrder;
      if (left.parentId === null && right.parentId !== null) return -1;
      if (left.parentId !== null && right.parentId === null) return 1;
      const parentOrder = left.parentId === null ? 0 : compareText(left.parentId, right.parentId);
      if (parentOrder) return parentOrder;
      return left.order - right.order || compareText(left.id, right.id) || left.inputIndex - right.inputIndex;
    };

    folders.sort(comparePosition);
    let priorScope = null;
    let priorParent = MISSING;
    let position = 0;
    for (const folder of folders) {
      if (folder.scope !== priorScope || folder.parentId !== priorParent) {
        priorScope = folder.scope;
        priorParent = folder.parentId;
        position = 0;
      }
      folder.order = position;
      position += 1;
    }
    folders.sort((left, right) => {
      const scopeOrder = compareText(left.scope, right.scope);
      if (scopeOrder) return scopeOrder;
      if (left.parentId === null && right.parentId !== null) return -1;
      if (left.parentId !== null && right.parentId === null) return 1;
      const parentOrder = left.parentId === null ? 0 : compareText(left.parentId, right.parentId);
      return parentOrder || left.order - right.order || compareText(left.id, right.id);
    });
    return folders.map(({ id, name, parentId, scope, collapsed, order }) => ({ id, name, parentId, scope, collapsed, order }));
  }

  function normalizeTabs(value, folders) {
    if (!isPlainObject(value)) return {};
    let keys;
    try {
      keys = Object.keys(value).slice(0, MAX_TABS);
    } catch (_) {
      return {};
    }

    const byFolder = new Map();
    const validFolders = folderMap(folders);
    for (let index = 0; index < keys.length; index += 1) {
      const key = keys[index];
      if (!isSafeIdentifier(key, MAX_TAB_KEY_LENGTH)) continue;
      const source = ownData(value, key);
      if (!isPlainObject(source)) continue;
      const folderValue = ownData(source, 'folderId');
      const orderValue = ownData(source, 'order');
      const folderId = folderValue === null || folderValue === MISSING || !validFolders.has(folderValue) ? null : folderValue;
      const order = Number.isSafeInteger(orderValue) ? orderValue : index;
      const list = byFolder.get(folderId) || [];
      list.push({ key, folderId, order, inputIndex: index });
      byFolder.set(folderId, list);
    }

    const result = {};
    for (const records of byFolder.values()) {
      records.sort((left, right) => left.order - right.order || compareText(left.key, right.key) || left.inputIndex - right.inputIndex);
      records.forEach((record, index) => {
        safeSet(result, record.key, { folderId: record.folderId, order: index });
      });
    }
    return result;
  }

  function normalize(input) {
    if (!isPlainObject(input)) return emptyState();
    const rawFolders = ownData(input, 'folders');
    const rawTabs = ownData(input, 'tabs');
    let folders;
    try {
      folders = normalizeFolders(rawFolders);
    } catch (_) {
      folders = [];
    }
    let tabs;
    try {
      tabs = normalizeTabs(rawTabs, folders);
    } catch (_) {
      tabs = {};
    }
    return { version: 1, folders, tabs };
  }

  function createFolder(state, options) {
    const folders = folderList(state);
    const input = requireOptions(options, 'createFolder');
    const id = requireIdentifier(ownData(input, 'id'), 'id', MAX_ID_LENGTH);
    const name = requireName(ownData(input, 'name'));
    const scope = requireScope(ownData(input, 'scope'));
    const parentValue = optionValue(input, 'parentId', null);
    const parentId = parentValue === null ? null : requireIdentifier(parentValue, 'parentId', MAX_ID_LENGTH);
    if (findFolder(folders, id)) throw new RangeError(`folder id already exists: ${id}`);
    if (folders.length >= MAX_FOLDERS) throw new RangeError(`folder count cannot exceed ${MAX_FOLDERS}`);

    if (parentId !== null) {
      const parent = requireFolder(folders, parentId);
      if (parent.scope !== scope) throw new RangeError('parent folder must belong to the same scope');
      if (depthOf(folders, parentId) >= MAX_DEPTH) throw new RangeError(`folder depth cannot exceed ${MAX_DEPTH}`);
    }

    const folder = {
      id,
      name,
      parentId,
      scope,
      collapsed: false,
      order: sortedFolderChildren(folders, scope, parentId).length,
    };
    state.folders.push(folder);
    return folder;
  }

  function renameFolder(state, idValue, nameValue) {
    const folders = folderList(state);
    const id = requireIdentifier(idValue, 'id', MAX_ID_LENGTH);
    const folder = requireFolder(folders, id);
    folder.name = requireName(nameValue);
    return folder;
  }

  function moveFolder(state, idValue, parentValue, options) {
    const folders = folderList(state);
    const id = requireIdentifier(idValue, 'id', MAX_ID_LENGTH);
    const folder = requireFolder(folders, id);
    const parentId = parentValue === null ? null : requireIdentifier(parentValue, 'parentId', MAX_ID_LENGTH);
    const input = requireOptions(options, 'moveFolder');
    const beforeValue = optionValue(input, 'beforeId', null);
    const beforeId = beforeValue === null ? null : requireIdentifier(beforeValue, 'beforeId', MAX_ID_LENGTH);
    const parent = parentId === null ? null : requireFolder(folders, parentId);
    if (parent && parent.scope !== folder.scope) throw new RangeError('parent folder must belong to the same scope');
    if (parentId === id || (parentId !== null && descendantsFor(folders, id).has(parentId))) {
      throw new RangeError('a folder cannot be moved into itself or its descendant');
    }

    const depthBelow = subtreeHeight(folders, id);
    const parentDepth = parentId === null ? 0 : depthOf(folders, parentId);
    if (parentDepth + depthBelow > MAX_DEPTH) throw new RangeError(`folder depth cannot exceed ${MAX_DEPTH}`);

    if (beforeId === id) {
      if (folder.parentId === parentId) return folder;
      throw new RangeError('beforeId must be a sibling in the destination position');
    }
    const targetSiblings = sortedFolderChildren(folders, folder.scope, parentId).filter((item) => item.id !== id);
    if (beforeId !== null) {
      const before = requireFolder(folders, beforeId);
      if (before.scope !== folder.scope || before.parentId !== parentId || before.id === id) {
        throw new RangeError('beforeId must identify a destination sibling');
      }
    }

    const oldParentId = folder.parentId;
    const oldSiblings = oldParentId === parentId
      ? targetSiblings
      : sortedFolderChildren(folders, folder.scope, oldParentId).filter((item) => item.id !== id);
    let insertionIndex = targetSiblings.length;
    if (beforeId !== null) insertionIndex = targetSiblings.findIndex((item) => item.id === beforeId);
    if (insertionIndex < 0) throw new RangeError('beforeId must identify a destination sibling');
    targetSiblings.splice(insertionIndex, 0, folder);
    folder.parentId = parentId;
    assignFolderOrders(targetSiblings);
    if (oldParentId !== parentId) assignFolderOrders(oldSiblings);
    return folder;
  }

  function removeFolder(state, idValue) {
    const folders = folderList(state);
    const { tabs } = stateParts(state);
    const id = requireIdentifier(idValue, 'id', MAX_ID_LENGTH);
    const folder = requireFolder(folders, id);
    const oldSiblings = sortedFolderChildren(folders, folder.scope, folder.parentId);
    const removedIndex = oldSiblings.findIndex((item) => item.id === id);
    const childFolders = sortedFolderChildren(folders, folder.scope, id);
    const reparentedSiblings = oldSiblings.slice(0, removedIndex)
      .concat(childFolders, oldSiblings.slice(removedIndex + 1));
    for (const child of childFolders) child.parentId = folder.parentId;

    const destinationTabKeys = sortedTabKeys(tabs, folder.parentId);
    const movedTabKeys = sortedTabKeys(tabs, id);
    for (const key of movedTabKeys) {
      const record = ownData(tabs, key);
      record.folderId = folder.parentId;
    }
    assignTabOrders(tabs, destinationTabKeys.concat(movedTabKeys), folder.parentId);

    const folderIndex = folders.findIndex((item) => item.id === id);
    state.folders.splice(folderIndex, 1);
    assignFolderOrders(reparentedSiblings);
    return folder;
  }

  function setCollapsed(state, idValue, collapsedValue) {
    const folders = folderList(state);
    const id = requireIdentifier(idValue, 'id', MAX_ID_LENGTH);
    if (typeof collapsedValue !== 'boolean') throw new TypeError('collapsed must be a boolean');
    const folder = requireFolder(folders, id);
    folder.collapsed = collapsedValue;
    return folder;
  }

  function placeTab(state, keyValue, options) {
    const { folders, tabs } = stateParts(state);
    const id = requireIdentifier(keyValue, 'tab key', MAX_TAB_KEY_LENGTH);
    const input = requireOptions(options, 'placeTab');
    const folderValue = optionValue(input, 'folderId', null);
    const folderId = folderValue === null ? null : requireIdentifier(folderValue, 'folderId', MAX_ID_LENGTH);
    if (folderId !== null) requireFolder(folderList(state), folderId);
    const beforeValue = optionValue(input, 'beforeKey', null);
    const beforeKey = beforeValue === null ? null : requireIdentifier(beforeValue, 'beforeKey', MAX_TAB_KEY_LENGTH);
    const current = ownData(tabs, id);
    const exists = current !== MISSING;
    if (!exists && Object.keys(tabs).length >= MAX_TABS) throw new RangeError(`tab placement count cannot exceed ${MAX_TABS}`);
    if (exists && !isPlainObject(current)) throw new TypeError('existing tab placement must be a plain object');
    const sourceFolderId = exists ? ownData(current, 'folderId') : null;
    if (exists && (sourceFolderId === MISSING || (sourceFolderId !== null && !isSafeIdentifier(sourceFolderId, MAX_ID_LENGTH)))) {
      throw new TypeError('existing tab placement has an invalid folderId');
    }

    if (beforeKey === id) {
      if (exists && sourceFolderId === folderId) return current;
      throw new RangeError('beforeKey must identify a different tab in the destination folder');
    }

    const destinationKeys = sortedTabKeys(tabs, folderId).filter((key) => key !== id);
    if (beforeKey !== null) {
      const before = ownData(tabs, beforeKey);
      if (!isSafeIdentifier(beforeKey, MAX_TAB_KEY_LENGTH) || !isPlainObject(before) || before.folderId !== folderId) {
        throw new RangeError('beforeKey must identify a tab in the destination folder');
      }
    }
    let insertionIndex = destinationKeys.length;
    if (beforeKey !== null) insertionIndex = destinationKeys.indexOf(beforeKey);
    if (insertionIndex < 0) throw new RangeError('beforeKey must identify a tab in the destination folder');
    destinationKeys.splice(insertionIndex, 0, id);

    let sourceKeys = [];
    if (exists && sourceFolderId !== folderId) sourceKeys = sortedTabKeys(tabs, sourceFolderId).filter((key) => key !== id);
    if (!exists) safeSet(tabs, id, { folderId, order: 0 });
    assignTabOrders(tabs, destinationKeys, folderId);
    if (sourceKeys.length > 0) assignTabOrders(tabs, sourceKeys, sourceFolderId);
    return ownData(tabs, id);
  }

  function children(state, scopeValue, parentValue) {
    const folders = folderList(state);
    const scope = requireScope(scopeValue);
    const parentId = parentValue === undefined || parentValue === null
      ? null
      : requireIdentifier(parentValue, 'parentId', MAX_ID_LENGTH);
    if (parentId !== null) {
      const parent = findFolder(folders, parentId);
      if (!parent || parent.scope !== scope) return [];
    }
    return sortedFolderChildren(folders, scope, parentId);
  }

  function descendants(state, idValue) {
    const folders = folderList(state);
    const id = requireIdentifier(idValue, 'id', MAX_ID_LENGTH);
    return descendantsFor(folders, id);
  }

  function folderPath(state, idValue) {
    const folders = folderList(state);
    if (!isSafeIdentifier(idValue, MAX_ID_LENGTH)) return null;
    const byId = folderMap(folders);
    let folder = byId.get(idValue);
    if (!folder) return null;
    const path = [];
    const seen = new Set();
    while (folder) {
      if (seen.has(folder.id)) return null;
      seen.add(folder.id);
      path.push(folder.name);
      if (folder.parentId === null) break;
      folder = byId.get(folder.parentId);
      if (!folder) return null;
    }
    return path.reverse().join(' / ');
  }

  function tabFolder(state, keyValue, scopeValue) {
    const { tabs } = stateParts(state);
    if (!isSafeIdentifier(keyValue, MAX_TAB_KEY_LENGTH) || typeof scopeValue !== 'string') return null;
    const record = ownData(tabs, keyValue);
    if (!isPlainObject(record)) return null;
    const folderId = ownData(record, 'folderId');
    if (!isSafeIdentifier(folderId, MAX_ID_LENGTH)) return null;
    const folder = findFolder(folderList(state), folderId);
    return folder && folder.scope === scopeValue ? folder.id : null;
  }

  return Object.freeze({
    MAX_DEPTH,
    MAX_FOLDERS,
    MAX_TABS,
    emptyState,
    normalize,
    createFolder,
    renameFolder,
    moveFolder,
    removeFolder,
    setCollapsed,
    placeTab,
    children,
    descendants,
    folderPath,
    tabFolder,
  });
});
