/* Runs once in Vivaldi's main.html. Browser windows are same-extension views. */
(() => {
  'use strict';
  const M = globalThis.ArcFoldersModel;
  const api = globalThis.chrome;
  const STORAGE_KEY = 'arc-folders.state.v1';
  const MIME = 'application/x-vivaldi-arc-folders';
  if (!M || !api?.tabs || !api?.extension?.getViews || !api?.storage?.local) {
    console.error('[Tab Folders] Required Vivaldi UI APIs are unavailable. Native tabs are unchanged.');
    return;
  }
  globalThis.ArcFolders?.destroy();
  let state = M.emptyState();
  let tabs = [];
  let windows = [];
  let stopped = false;
  let dragging = false;
  let refreshTimer;
  let discoveryTimer;
  let refreshing = false;
  let refreshAgain = false;
  let changeQueue = Promise.resolve();
  const mounts = new Map();
  const listeners = [];
  const metadata = value => { try { return JSON.parse(value?.vivExtData || '{}') || {}; } catch { return {}; } };
  const tabKey = tab => {
    const id = metadata(tab).ext_id;
    return typeof id === 'string' && id.length < 200 ? `tab:${id}` : null;
  };
  const scopeKey = win => {
    const id = metadata(win).ext_id;
    return typeof id === 'string' && id.length < 200 ? `window:${id}` : null;
  };
  const folder = id => state.folders.find(f => f.id === id);
  const ownTabs = mount => tabs.filter(t => t.windowId === mount.id && !t.incognito && !metadata(t).panelId);
  const title = tab => tab.title || tab.pendingUrl || tab.url || 'New tab';
  const listen = (event, callback) => { if (event?.addListener) { event.addListener(callback); listeners.push(() => event.removeListener(callback)); } };

  function element(doc, tag, className, text) {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function icon(doc, name) {
    const paths = {
      plus: 'M8 3v10M3 8h10',
      folder: 'M2 4h4l1.5 2H14v7H2z',
      chevron: 'm6 4 4 4-4 4',
      more: 'M3 8h.01M8 8h.01M13 8h.01',
      close: 'm4 4 8 8M12 4l-8 8',
      move: 'M2 8h11M9 4l4 4-4 4',
    };
    const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 16 16');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '1.5');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');
    const path = doc.createElementNS(svg.namespaceURI, 'path');
    path.setAttribute('d', paths[name] || paths.folder);
    svg.append(path);
    return svg;
  }
  function button(doc, label, glyph, handler, className = 'af-icon-button') {
    const node = element(doc, 'button', className);
    node.type = 'button';
    node.title = label;
    node.setAttribute('aria-label', label);
    if (glyph) node.append(icon(doc, glyph));
    else node.textContent = label;
    node.addEventListener('click', event => { event.stopPropagation(); run(handler); });
    return node;
  }
  function notify(message, error = false) {
    for (const mount of mounts.values()) {
      mount.status.textContent = message;
      mount.status.classList.toggle('af-error', error);
    }
  }
  function run(fn) {
    Promise.resolve().then(fn).catch(error => {
      notify(error?.message || 'Action failed. Native tabs are still available.', true);
      console.error('[Tab Folders]', error?.message || 'Action failed');
    });
  }
  function commit(change) {
    const task = async () => {
      if (stopped) return;
      const previous = JSON.stringify(state);
      try {
        change();
        // Serialize before awaiting so a later operation cannot change this write.
        const snapshot = JSON.parse(JSON.stringify(state));
        await api.storage.local.set({ [STORAGE_KEY]: snapshot });
      } catch (error) {
        state = M.normalize(JSON.parse(previous));
        renderAll();
        throw error;
      }
      renderAll();
      notify('Saved on this device');
    };
    const result = changeQueue.then(task, task);
    changeQueue = result.catch(() => {});
    return result;
  }
  function schedule() {
    if (!stopped && !refreshTimer) refreshTimer = setTimeout(() => { refreshTimer = null; run(refresh); }, 70);
  }
  async function refresh() {
    if (refreshing) { refreshAgain = true; return; }
    refreshing = true;
    try {
      do {
        refreshAgain = false;
        const [nextTabs, nextWindows] = await Promise.all([api.tabs.query({}), api.windows.getAll({ windowTypes: ['normal'] })]);
        if (stopped) return;
        tabs = nextTabs;
        windows = nextWindows;
        discover();
        if (!dragging) renderAll();
      } while (refreshAgain && !stopped);
    } finally { refreshing = false; }
  }
  function discover() {
    if (stopped) return;
    const views = api.extension.getViews();
    for (const [id, mount] of mounts) {
      if (mount.view.closed || !views.includes(mount.view) || !mount.root.isConnected) {
        mount.cleanup();
        mounts.delete(id);
      }
    }
    for (const view of views) {
      const id = view.vivaldiWindowId;
      const win = windows.find(w => w.id === id && !w.incognito && w.type === 'normal');
      if (!win || !scopeKey(win) || mounts.has(id)) continue;
      const parent = view.document.querySelector('#main > .inner');
      if (parent) {
        const mount = mountSidebar(view, win, parent);
        mounts.set(id, mount);
        render(mount);
      }
    }
  }
  function mountSidebar(view, win, parent) {
    const doc = view.document;
    const style = element(doc, 'style');
    style.dataset.arcFolders = 'true';
    style.textContent = globalThis.ArcFoldersCSS || '';
    doc.head.append(style);
    const root = element(doc, 'aside');
    root.id = 'arc-folders';
    root.setAttribute('aria-label', 'Tab folders');
    const header = element(doc, 'div', 'af-header');
    header.append(element(doc, 'h2', '', 'Folders'));
    const tree = element(doc, 'div', 'af-tree');
    tree.setAttribute('role', 'tree');
    tree.setAttribute('aria-label', 'Folders and open tabs');
    const status = element(doc, 'div', 'af-status');
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    status.textContent = 'Saved on this device';
    const mount = { id: win.id, scope: scopeKey(win), view, doc, root, tree, status, dialogs: new Set() };
    header.append(button(doc, 'New folder', 'plus', () => nameDialog(mount)));
    const newTab = button(doc, 'New tab', 'plus', () => createTab(mount, null), 'af-new-tab');
    newTab.append(element(doc, 'span', '', 'New tab'));
    root.append(header, element(doc, 'p', 'af-subtitle', 'This window · all workspaces'), tree, newTab, status);
    parent.prepend(root);
    tree.addEventListener('keydown', event => treeKeys(mount, event));
    tree.addEventListener('dragstart', event => {
      const row = event.target.closest('[data-drag]');
      if (!row || !event.dataTransfer) return;
      dragging = true;
      event.dataTransfer.setData(MIME, JSON.stringify({ kind: row.dataset.drag, key: row.dataset.key }));
      event.dataTransfer.effectAllowed = 'move';
      event.stopPropagation();
    });
    tree.addEventListener('dragover', event => {
      if (!Array.from(event.dataTransfer?.types || []).includes(MIME)) return;
      const target = event.target.closest('[data-drop]');
      if (!target) return;
      event.preventDefault(); event.stopPropagation();
      event.dataTransfer.dropEffect = 'move';
      tree.querySelectorAll('.af-drop').forEach(n => n.classList.remove('af-drop'));
      target.classList.add('af-drop');
    });
    tree.addEventListener('dragleave', event => { if (!tree.contains(event.relatedTarget)) tree.querySelectorAll('.af-drop').forEach(n => n.classList.remove('af-drop')); });
    tree.addEventListener('drop', event => {
      const raw = event.dataTransfer?.getData(MIME);
      const target = event.target.closest('[data-drop]');
      if (!raw || !target) return;
      event.preventDefault(); event.stopPropagation();
      run(async () => {
        const payload = JSON.parse(raw);
        const parentId = target.dataset.drop || null;
        if (payload.kind === 'folder') {
          if (folder(payload.key)?.scope !== mount.scope) throw new Error('Folders can only move within their window.');
          await commit(() => { M.moveFolder(state, payload.key, parentId); if (parentId) M.setCollapsed(state, parentId, false); });
        } else if (payload.kind === 'tab') {
          const tab = ownTabs(mount).find(t => tabKey(t) === payload.key);
          if (!tab) throw new Error('That tab is no longer in this window.');
          await commit(() => { placeLiveTab(mount, payload.key, parentId, target.dataset.beforeKey || null); if (parentId) M.setCollapsed(state, parentId, false); });
        }
      });
    });
    tree.addEventListener('dragend', () => { dragging = false; renderAll(); });
    mount.cleanup = () => { for (const dialog of mount.dialogs) dialog.remove(); root.remove(); style.remove(); };
    return mount;
  }
  function sortedTabs(mount, parentId) {
    return ownTabs(mount).filter(t => M.tabFolder(state, tabKey(t), mount.scope) === parentId)
      .sort((a, b) => (state.tabs[tabKey(a)]?.order ?? (1000000 + a.index)) - (state.tabs[tabKey(b)]?.order ?? (1000000 + b.index)) || a.index - b.index);
  }
  function placeLiveTab(mount, key, folderId, beforeKey = null) {
    // Native loose tabs have no saved placement yet. Materialize their visible
    // order before requesting a beforeKey, so first-use reorder also works.
    for (const tab of sortedTabs(mount, folderId)) {
      const liveKey = tabKey(tab);
      if (liveKey && (!state.tabs[liveKey] || state.tabs[liveKey].folderId !== folderId)) M.placeTab(state, liveKey, { folderId });
    }
    M.placeTab(state, key, { folderId, beforeKey });
  }
  function renderAll() { if (!stopped && !dragging) for (const mount of mounts.values()) render(mount); }
  function render(mount) {
    const { doc, tree } = mount;
    const focused = tree.contains(doc.activeElement) ? doc.activeElement.dataset.focusKey : null;
    const fragment = doc.createDocumentFragment();
    // Build one scoped index per render rather than repeatedly validating and
    // walking the complete model for every tab inside every folder.
    const scoped = state.folders.filter(f => f.scope === mount.scope);
    const ids = new Set(scoped.map(f => f.id));
    const children = new Map();
    const groupedTabs = new Map();
    const counts = new Map();
    for (const f of scoped) { const list = children.get(f.parentId) || []; list.push(f); children.set(f.parentId, list); }
    for (const list of children.values()) list.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
    for (const tab of ownTabs(mount)) {
      const placement = state.tabs[tabKey(tab)];
      const parent = ids.has(placement?.folderId) ? placement.folderId : null;
      const list = groupedTabs.get(parent) || []; list.push(tab); groupedTabs.set(parent, list);
    }
    for (const list of groupedTabs.values()) list.sort((a, b) => (state.tabs[tabKey(a)]?.order ?? (1000000 + a.index)) - (state.tabs[tabKey(b)]?.order ?? (1000000 + b.index)) || a.index - b.index);
    const countTabs = id => {
      const count = (groupedTabs.get(id)?.length || 0) + (children.get(id) || []).reduce((sum, child) => sum + countTabs(child.id), 0);
      counts.set(id, count); return count;
    };
    countTabs(null);
    const walk = (parentId, depth, container) => {
      for (const item of children.get(parentId) || []) {
        const row = element(doc, 'div', 'af-row af-folder');
        row.style.setProperty('--af-depth', depth);
        Object.assign(row.dataset, { expanded: String(!item.collapsed), drag: 'folder', key: item.id, drop: item.id });
        row.draggable = true;
        const main = button(doc, item.name, null, () => commit(() => M.setCollapsed(state, item.id, !folder(item.id).collapsed)), 'af-item');
        main.textContent = '';
        Object.assign(main.dataset, { focusKey: `folder:${item.id}`, folderId: item.id, parentId: item.parentId || '' });
        main.setAttribute('role', 'treeitem');
        main.setAttribute('aria-expanded', String(!item.collapsed));
        main.setAttribute('aria-level', depth + 1);
        const chevron = icon(doc, 'chevron'); chevron.classList.add('af-chevron');
        const count = counts.get(item.id) || 0;
        main.append(chevron, icon(doc, 'folder'), element(doc, 'span', 'af-label', item.name), element(doc, 'span', 'af-count', String(count)));
        main.addEventListener('dblclick', () => nameDialog(mount, item.parentId, item.id));
        const actions = element(doc, 'div', 'af-actions');
        const more = button(doc, `Options for ${item.name}`, 'more', () => folderMenu(mount, item.id));
        more.dataset.focusKey = `options:${item.id}`;
        actions.append(more);
        row.append(main, actions); container.append(row);
        if (!item.collapsed) {
          const group = element(doc, 'div', 'af-group');
          group.setAttribute('role', 'group');
          walk(item.id, depth + 1, group);
          for (const tab of groupedTabs.get(item.id) || []) group.append(tabRow(mount, tab, depth + 1, item.id));
          if (!group.childNodes.length) group.append(element(doc, 'div', 'af-empty', 'Drop tabs here'));
          container.append(group);
        }
      }
    };
    walk(null, 0, fragment);
    if (!children.get(null)?.length) fragment.append(element(doc, 'div', 'af-empty', 'Create a folder with +, then drag tabs into it.'));
    const loose = element(doc, 'div', 'af-section', 'Loose tabs');
    loose.dataset.drop = '';
    loose.title = 'Drop here to move a tab or folder to the top level';
    fragment.append(loose);
    for (const tab of groupedTabs.get(null) || []) fragment.append(tabRow(mount, tab, 0, null));
    tree.replaceChildren(fragment);
    const items = [...tree.querySelectorAll('.af-item')];
    for (const item of items) item.tabIndex = -1;
    const restore = focused && [...tree.querySelectorAll('[data-focus-key]')].find(n => n.dataset.focusKey === focused);
    const current = restore?.classList.contains('af-item') ? restore : items.find(n => n.getAttribute('aria-selected') === 'true') || items[0];
    if (current) current.tabIndex = 0;
    if (restore) restore.focus({ preventScroll: true });
    else if (focused && current) current.focus({ preventScroll: true });
  }
  function tabRow(mount, tab, depth, parentId) {
    const { doc } = mount;
    const key = tabKey(tab);
    const row = element(doc, 'div', `af-row af-tab${tab.active ? ' af-active' : ''}${tab.pinned ? ' af-pinned' : ''}`);
    row.style.setProperty('--af-depth', depth);
    row.dataset.drop = parentId || '';
    if (key) { Object.assign(row.dataset, { drag: 'tab', key, beforeKey: key }); row.draggable = true; }
    const name = title(tab);
    const main = button(doc, name, null, () => api.tabs.update(tab.id, { active: true }), 'af-item');
    main.textContent = '';
    Object.assign(main.dataset, { focusKey: `tab:${key || tab.id}`, tabId: String(tab.id), parentId: parentId || '' });
    main.setAttribute('role', 'treeitem');
    main.setAttribute('aria-selected', String(tab.active));
    main.setAttribute('aria-level', depth + 1);
    const mark = element(doc, 'span', 'af-tab-mark', tab.pinned ? '•' : name.slice(0, 1).toLocaleUpperCase());
    mark.setAttribute('aria-hidden', 'true');
    main.append(mark, element(doc, 'span', 'af-label', name));
    if (tab.audible) { const audio = element(doc, 'span', 'af-count', '♪'); audio.setAttribute('aria-label', 'Playing audio'); main.append(audio); }
    const actions = element(doc, 'div', 'af-actions');
    const move = button(doc, `Move ${name} to folder`, 'move', () => moveDialog(mount, { tabId: tab.id, key }));
    move.dataset.focusKey = `move:${key || tab.id}`;
    const close = button(doc, `Close ${name}`, 'close', () => api.tabs.remove(tab.id));
    close.dataset.focusKey = `close:${key || tab.id}`;
    actions.append(move, close); row.append(main, actions);
    row.addEventListener('auxclick', event => { if (event.button === 1) { event.preventDefault(); run(() => api.tabs.remove(tab.id)); } });
    return row;
  }
  function treeKeys(mount, event) {
    const item = event.target.closest('.af-item');
    if (!item) return;
    const items = [...mount.tree.querySelectorAll('.af-item')];
    const index = items.indexOf(item);
    const id = item.dataset.folderId;
    let next;
    if (event.key === 'ArrowDown') next = items[Math.min(index + 1, items.length - 1)];
    else if (event.key === 'ArrowUp') next = items[Math.max(0, index - 1)];
    else if (event.key === 'Home') next = items[0];
    else if (event.key === 'End') next = items.at(-1);
    else if (event.key === 'ArrowRight') {
      if (id && folder(id)?.collapsed) run(() => commit(() => M.setCollapsed(state, id, false)));
      else if (id) next = items[index + 1];
    } else if (event.key === 'ArrowLeft') {
      if (id && !folder(id)?.collapsed) run(() => commit(() => M.setCollapsed(state, id, true)));
      else next = items.find(n => n.dataset.folderId === item.dataset.parentId);
    } else if (event.key === 'F2' && id) nameDialog(mount, folder(id)?.parentId, id);
    else if (event.key === 'F10' && event.shiftKey) {
      if (id) folderMenu(mount, id);
      else moveDialog(mount, { tabId: Number(item.dataset.tabId), key: tabKey(tabs.find(t => t.id === Number(item.dataset.tabId))) });
    } else return;
    event.preventDefault(); event.stopPropagation();
    if (next) { items.forEach(n => { n.tabIndex = -1; }); next.tabIndex = 0; next.focus(); }
  }
  function dialogBase(mount, heading) {
    const { doc } = mount;
    const previous = doc.activeElement;
    const previousKey = previous?.dataset.focusKey;
    const dialog = element(doc, 'dialog', 'af-dialog');
    const titleNode = element(doc, 'h3', '', heading);
    titleNode.id = `af-dialog-${crypto.randomUUID()}`;
    dialog.setAttribute('aria-labelledby', titleNode.id);
    dialog.append(titleNode);
    doc.querySelector('#browser').append(dialog);
    mount.dialogs.add(dialog);
    dialog.addEventListener('close', () => {
      dialog.remove(); mount.dialogs.delete(dialog);
      if (!doc.querySelector('.af-dialog[open]') && mount.root.isConnected) {
        const logical = previousKey && [...mount.root.querySelectorAll('[data-focus-key]')].find(n => n.dataset.focusKey === previousKey);
        const target = previous?.isConnected ? previous : logical || mount.tree.querySelector('.af-item') || mount.root.querySelector('button');
        target?.focus();
      }
    });
    // Explicit wrapping avoids focus escaping to browser chrome at either edge.
    dialog.addEventListener('keydown', event => {
      if (event.key !== 'Tab') return;
      const focusable = [...dialog.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled)')];
      const first = focusable[0], last = focusable.at(-1);
      if ((event.shiftKey && doc.activeElement === first) || (!event.shiftKey && doc.activeElement === last)) {
        event.preventDefault(); (event.shiftKey ? last : first)?.focus();
      }
    });
    return dialog;
  }
  function formDialog(mount, heading, populate, submit) {
    const { doc } = mount;
    const dialog = dialogBase(mount, heading);
    const form = element(doc, 'form');
    const field = populate(form);
    const error = element(doc, 'div', 'af-dialog-error'); error.setAttribute('role', 'alert');
    const actions = element(doc, 'div', 'af-dialog-actions');
    const cancel = button(doc, 'Cancel', null, () => dialog.close());
    const save = element(doc, 'button', 'af-primary', 'Save'); save.type = 'submit';
    actions.append(cancel, save); form.append(error, actions); dialog.append(form);
    form.addEventListener('submit', event => {
      event.preventDefault();
      save.disabled = true;
      Promise.resolve().then(() => submit(field.value, field)).then(() => dialog.close()).catch(reason => {
        error.textContent = reason?.message || 'Unable to save'; save.disabled = false; field.focus();
      });
    });
    dialog.showModal(); field.focus(); if (field.select) field.select();
    return dialog;
  }
  function nameDialog(mount, parentId = null, id = null) {
    return formDialog(mount, id ? 'Rename folder' : 'New folder', form => {
      const label = element(mount.doc, 'label', '', 'Folder name');
      const input = element(mount.doc, 'input'); input.name = 'folder-name'; input.required = true; input.maxLength = 120;
      input.value = id ? folder(id)?.name || '' : '';
      label.append(input); form.append(label); return input;
    }, name => commit(() => {
      if (id) M.renameFolder(state, id, name);
      else { M.createFolder(state, { id: crypto.randomUUID(), name, parentId, scope: mount.scope }); if (parentId) M.setCollapsed(state, parentId, false); }
    }));
  }
  function folderMenu(mount, id) {
    const item = folder(id); if (!item) return;
    const dialog = dialogBase(mount, item.name);
    const entries = [
      ['New subfolder', () => nameDialog(mount, id)],
      ['New tab here', () => createTab(mount, id)],
      ['Rename', () => nameDialog(mount, item.parentId, id)],
      ['Move folder', () => moveDialog(mount, { folderId: id })],
      ['Remove folder (keep tabs)', () => commit(() => M.removeFolder(state, id))],
    ];
    for (const [label, handler] of entries) dialog.append(button(mount.doc, label, null, () => { dialog.close(); return handler(); }, 'af-menu-button'));
    dialog.append(button(mount.doc, 'Cancel', null, () => dialog.close()));
    dialog.showModal();
  }
  function moveDialog(mount, source) {
    const excluded = source.folderId ? M.descendants(state, source.folderId) : new Set();
    let position;
    return formDialog(mount, source.folderId ? 'Move folder' : 'Move tab', form => {
      const label = element(mount.doc, 'label', '', 'Destination');
      const select = element(mount.doc, 'select'); select.name = 'destination';
      const root = element(mount.doc, 'option', '', 'Top level / loose tabs'); root.value = ''; select.append(root);
      const choices = state.folders.filter(f => f.scope === mount.scope && !excluded.has(f.id))
        .sort((a, b) => M.folderPath(state, a.id).localeCompare(M.folderPath(state, b.id)));
      for (const f of choices) { const option = element(mount.doc, 'option', '', M.folderPath(state, f.id)); option.value = f.id; select.append(option); }
      select.value = source.folderId ? folder(source.folderId)?.parentId || '' : M.tabFolder(state, source.key, mount.scope) || '';
      label.append(select); form.append(label);
      const positionLabel = element(mount.doc, 'label', '', 'Position');
      position = element(mount.doc, 'select'); position.name = 'position';
      positionLabel.append(position); form.append(positionLabel);
      const updatePositions = () => {
        position.replaceChildren();
        const last = element(mount.doc, 'option', '', 'Last'); last.value = ''; position.append(last);
        const siblings = source.folderId
          ? M.children(state, mount.scope, select.value || null).filter(f => f.id !== source.folderId).map(f => ({ key: f.id, name: f.name }))
          : sortedTabs(mount, select.value || null).filter(t => tabKey(t) && tabKey(t) !== source.key).map(t => ({ key: tabKey(t), name: title(t) }));
        for (const sibling of siblings) { const option = element(mount.doc, 'option', '', `Before ${sibling.name}`); option.value = sibling.key; position.append(option); }
      };
      select.addEventListener('change', updatePositions); updatePositions();
      return select;
    }, parent => commit(() => {
      const parentId = parent || null;
      if (source.folderId) M.moveFolder(state, source.folderId, parentId, { beforeId: position.value || null });
      else {
        if (!source.key || !ownTabs(mount).some(t => t.id === source.tabId && tabKey(t) === source.key)) throw new Error('Tab is not ready or has moved. Try again.');
        placeLiveTab(mount, source.key, parentId, position.value || null);
      }
      if (parentId) M.setCollapsed(state, parentId, false);
    }));
  }
  async function createTab(mount, folderId) {
    const created = await api.tabs.create({ windowId: mount.id, active: true });
    if (folderId) {
      let key = tabKey(created);
      for (let attempt = 0; !key && attempt < 20; attempt++) {
        await new Promise(resolve => setTimeout(resolve, 50));
        key = tabKey(await api.tabs.get(created.id));
      }
      if (!key) throw new Error('New tab opened, but Vivaldi has not assigned its persistent ID. Move it into the folder manually.');
      await commit(() => { M.placeTab(state, key, { folderId }); M.setCollapsed(state, folderId, false); });
    }
    await refresh();
  }
  const controller = {
    get state() { return JSON.parse(JSON.stringify(state)); },
    get windowCount() { return mounts.size; },
    refresh,
    destroy() {
      stopped = true;
      clearInterval(discoveryTimer); clearTimeout(refreshTimer);
      listeners.forEach(remove => remove());
      mounts.forEach(mount => mount.cleanup()); mounts.clear();
    },
  };
  globalThis.ArcFolders = controller;
  controller.ready = (async () => {
    const stored = await api.storage.local.get(STORAGE_KEY);
    if (stopped) return;
    state = M.normalize(stored[STORAGE_KEY]);
    for (const name of ['onCreated', 'onUpdated', 'onRemoved', 'onActivated', 'onMoved', 'onAttached', 'onDetached', 'onReplaced']) listen(api.tabs[name], schedule);
    listen(api.windows.onCreated, schedule); listen(api.windows.onRemoved, schedule);
    await refresh();
    discoveryTimer = setInterval(() => { discover(); if (!mounts.size && !api.extension.inIncognitoContext) schedule(); }, 1000);
  })().catch(error => { controller.destroy(); console.error('[Tab Folders] Startup failed:', error?.message); throw error; });
  // Keep startup failures visible in DevTools without an unhandled rejection.
  controller.ready.catch(() => {});
})();
