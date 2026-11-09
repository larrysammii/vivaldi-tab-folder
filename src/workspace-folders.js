/* Isolated, workspace-native prototype. Never replaces Vivaldi's tab nodes. */
(() => {
  'use strict';
  const M = globalThis.ArcFoldersModel, L = globalThis.ArcWorkspaceLayout, N = globalThis.ArcWorkspaceNative;
  const api = globalThis.chrome;
  const STORAGE = 'arc-folders.workspace-prototype.v1';
  if (!globalThis.__ArcWorkspaceIsolatedPrototype || !M || !L || !N || !api?.extension?.getViews || api.extension.inIncognitoContext) {
    console.warn('[Workspace folders] Isolated non-private launcher required. Native tabs are unchanged.'); return;
  }
  globalThis.ArcFolders?.destroy(); globalThis.ArcWorkspaceFolders?.destroy();
  let nativeRequire;
  globalThis.webpackChunkgapp_browser_react?.push([[`arc-workspace-prototype-${Date.now()}`], {}, require => { nativeRequire = require; }]);
  const workspaceStore = nativeRequire?.(61685)?.Z;
  if (!workspaceStore || !['getActiveWorkspaceId', 'getWorkspaces', 'addListener', 'removeListener'].every(k => typeof workspaceStore[k] === 'function')) {
    console.warn('[Workspace folders] Unsupported native workspace store. Native tabs are unchanged.'); return;
  }
  let state = M.emptyState(), tabs = [], windows = [], side, menus;
  let stopped = false, timer, interval, refreshing = false, refreshAgain = false;
  let queue = Promise.resolve();
  const mounts = new Map(), listeners = [];
  const text = (doc, tag, className, value) => {
    const node = doc.createElement(tag); if (className) node.className = className; if (value !== undefined) node.textContent = value; return node;
  };
  const folder = id => state.folders.find(f => f.id === id);
  const scopeFor = win => win ? L.scopeKey(workspaceStore.getActiveWorkspaceId(win.id), L.metadata(win.vivExtData).ext_id) : null;
  const tabKey = (tab, scope) => L.tabKey(L.metadata(tab?.vivExtData), scope);
  const toggleFor = (mount, id) => [...mount.layer.querySelectorAll('[data-folder-toggle]')].find(node => node.dataset.folderToggle === id);
  const nativeId = node => { const id = node.querySelector('[role="tab"][data-id]')?.getAttribute('data-id'); return /^tab-\d+$/.test(id || '') ? Number(id.slice(4)) : null; };
  const ownTabs = mount => tabs.filter(t => t.windowId === mount.id && L.inWorkspace(t, workspaceStore.getActiveWorkspaceId(mount.id)));
  function notify(message) { for (const mount of mounts.values()) mount.status.textContent = message; }
  function run(action) { Promise.resolve().then(action).catch(error => { notify(error.message); console.warn('[Workspace folders]', error.message); }); }
  function listen(event, callback) { if (event?.addListener) { event.addListener(callback); listeners.push(() => event.removeListener(callback)); } }
  function schedule() { if (!stopped && !timer) timer = setTimeout(() => { timer = null; run(refresh); }, 60); }
  function button(doc, label, value, handler, className = '') {
    const node = text(doc, 'button', className, value); node.type = 'button'; node.title = label; node.setAttribute('aria-label', label);
    node.addEventListener('click', event => { event.stopPropagation(); if (className === 'awf-folder-toggle') node.focus(); run(handler); }); return node;
  }
  function currentMount(id) {
    const mount = mounts.get(id);
    if (!mount?.supported || scopeFor(windows.find(w => w.id === id)) !== mount.scope) throw new Error('Workspace changed; try the action again.');
    return mount;
  }
  function requireFolder(mount, id) {
    const value = folder(id); if (!value || value.scope !== mount.scope) throw new Error('Folder does not belong to this workspace.'); return value;
  }
  function commit(mount, change) {
    const scope = mount.scope;
    const task = async () => {
      if (stopped || currentMount(mount.id).scope !== scope) throw new Error('Workspace changed; action cancelled.');
      const previous = JSON.stringify(state);
      try { change(); await api.storage.local.set({ [STORAGE]: JSON.parse(JSON.stringify(state)) }); }
      catch (error) { state = M.normalize(JSON.parse(previous)); renderAll(); throw error; }
      renderAll(); notify('Saved in this workspace.');
    };
    const result = queue.then(task, task); queue = result.catch(() => {}); return result;
  }
  function placeNativeTabs(mount, ids, folderId, beforeKey = null) {
    if (!Array.isArray(ids) || !ids.length || new Set(ids).size !== ids.length) throw new Error('Select distinct ordinary tabs in this workspace.');
    return commit(mount, () => {
      if (folderId !== null) requireFolder(mount, folderId);
      const eligible = ownTabs(mount).filter(tab => !tab.pinned);
      const keys = ids.map(id => { const tab = eligible.find(tab => tab.id === id), key = tab && tabKey(tab, mount.scope); if (!key) throw new Error('Select an ordinary tab in this workspace; pinned tabs stay native.'); return key; });
      if (keys.length === 1 && beforeKey === keys[0]) return;
      if (beforeKey && (keys.includes(beforeKey) || !beforeKey.startsWith(`${mount.scope}/tab:`))) throw new Error('Invalid tab insertion anchor.');
      if (beforeKey && !state.tabs[beforeKey]) M.placeTab(state, beforeKey, { folderId });
      // One model change and one storage write for the whole selection. Any error
      // rolls every placement back through commit(), never a partial tab batch.
      for (const key of keys) M.placeTab(state, key, { folderId, beforeKey });
    });
  }
  function placeNativeTab(mount, id, folderId, beforeKey = null) { return placeNativeTabs(mount, [id], folderId, beforeKey); }
  function menuEntries(context) {
    const mount = currentMount(context.windowId);
    const entries = [{ label: 'New Folder', run: () => nameDialog(mount) }];
    const value = context.folderId && folder(context.folderId);
    if (value?.scope === mount.scope) entries.push(
      { label: 'New Subfolder', run: () => nameDialog(mount, value.id) },
      { label: 'Rename Folder', run: () => nameDialog(mount, null, value.id) },
      { label: 'Move Folder', run: () => moveFolderDialog(mount, value.id) },
      { label: 'Remove Folder (Keep Tabs)', run: () => commit(mount, () => M.removeFolder(state, value.id)) },
    );
    const tab = ownTabs(mount).find(t => !t.pinned && (context.tabId ? t.id === context.tabId : t.active));
    if (tab) entries.push({ label: 'Move to Folder', children: [
      { label: 'Outside Folders', run: () => placeNativeTab(mount, tab.id, null) },
      ...state.folders.filter(f => f.scope === mount.scope).map(f => ({ label: M.folderPath(state, f.id), run: () => placeNativeTab(mount, tab.id, f.id) })),
    ] });
    return entries;
  }
  function clearProjection(mount) {
    for (const node of mount.touched) { node.classList.remove('awf-tab-row', 'awf-hidden'); node.style.removeProperty('--awf-y'); node.style.removeProperty('--awf-indent'); }
    mount.touched.clear(); mount.rows = []; mount.layer.replaceChildren();
    mount.strip.classList.remove('awf-strip'); mount.strip.style.removeProperty('--awf-height'); mount.host.classList.remove('awf-scroll-host'); mount.supported = false;
  }
  function makeMount(view, win, bar, strip) {
    const controller = N.findDragController(strip);
    if (!controller || typeof controller.droppedTabHandler !== 'function') return null;
    const doc = view.document, style = text(doc, 'style'); style.dataset.arcWorkspacePrototype = 'true'; style.textContent = globalThis.ArcWorkspaceFoldersCSS; doc.head.append(style);
    const layer = text(doc, 'div', 'awf-layer'); strip.append(layer);
    const status = text(doc, 'span', 'awf-sr'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite'); bar.append(status);
    const mount = { id: win.id, view, doc, bar, strip, host: strip.parentElement, status, layer, scope: scopeFor(win), touched: new Set(), dialogs: new Set(), rows: [], supported: false, pointer: null, drops: 0 };
    const track = event => { mount.pointer = { x: event.clientX, y: event.clientY }; };
    mount.nativeDrag = N.hookDragController(strip, ids => {
      if (!mount.supported || !mount.pointer || scopeFor(windows.find(w => w.id === mount.id)) !== mount.scope) return false;
      const eligible = ownTabs(mount).filter(t => !t.pinned);
      if (!ids.every(id => eligible.some(t => t.id === id))) return false;
      const { x, y } = mount.pointer;
      const target = [...layer.querySelectorAll('.awf-folder')].find(node => { const r = node.getBoundingClientRect(); return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom; });
      if (!target) return false;
      const destination = target.dataset.folderId;
      if (folder(destination)?.scope !== mount.scope) return false;
      mount.drops++;
      run(async () => { await placeNativeTabs(mount, ids, destination); schedule(); });
      return true;
    });
    const dragOver = event => {
      if (!mount.supported || !event.target.closest('.awf-folder') || !event.dataTransfer?.types.includes(N.TAB_MIME)) return;
      event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = 'move';
    };
    const nativeDrop = event => {
      const value = N.nativeTabDrop(event.dataTransfer), target = event.target.closest('.awf-folder');
      if (!value || !target || value.sourceWindow !== mount.id || !mount.supported || scopeFor(windows.find(w => w.id === mount.id)) !== mount.scope) return;
      const eligible = ownTabs(mount).filter(tab => !tab.pinned);
      if (!value.ids.every(id => eligible.some(tab => tab.id === id))) return;
      const destination = target.dataset.folderId;
      if (folder(destination)?.scope !== mount.scope) return;
      // Let Vivaldi consume a validated, canonical payload and mark its session
      // handled. Do not consume a stale/failed drop or throw out of the DOM listener.
      try { controller.droppedTabHandler(value.payload); }
      catch (error) { notify(`Native tab drop failed: ${error.message}`); return; }
      event.preventDefault(); event.stopPropagation(); mount.drops++;
      run(async () => { await placeNativeTabs(mount, value.ids, destination); schedule(); });
    };
    layer.addEventListener('dragenter', dragOver); layer.addEventListener('dragover', dragOver); layer.addEventListener('drop', nativeDrop);
    const contextMenu = event => {
      if (!mount.supported || !bar.contains(event.target)) return;
      const native = event.target.closest('.tab-position');
      const context = { windowId: mount.id, scope: mount.scope, folderId: event.target.closest('.awf-folder')?.dataset.folderId || null, tabId: native ? nativeId(native) : null, x: event.clientX, y: event.clientY };
      if (context.folderId) { event.preventDefault(); event.stopPropagation(); menus.open(context); }
      else menus.note(context); // The existing native tab/bar menu supplies all original entries.
    };
    view.addEventListener('mousemove', track, true); view.addEventListener('mouseup', track, true); doc.addEventListener('contextmenu', contextMenu, true);
    const observer = new view.MutationObserver(records => { if (records.some(record => !record.target.closest?.('.awf-layer'))) schedule(); });
    mount.observe = () => observer.observe(strip, { childList: true, subtree: true }); mount.pause = () => observer.disconnect();
    mount.cleanup = () => {
      observer.disconnect(); mount.nativeDrag.restore();
      layer.removeEventListener('dragenter', dragOver); layer.removeEventListener('dragover', dragOver); layer.removeEventListener('drop', nativeDrop);
      view.removeEventListener('mousemove', track, true); view.removeEventListener('mouseup', track, true); doc.removeEventListener('contextmenu', contextMenu, true);
      for (const node of mount.dialogs) node.close(); clearProjection(mount); layer.remove(); status.remove(); style.remove();
    };
    mount.observe(); return mount;
  }
  function folderRow(mount, item) {
    const row = text(mount.doc, 'div', 'awf-folder'); row.dataset.folderId = item.id;
    row.style.top = `${item.y}px`; row.style.height = `${item.height}px`; row.style.paddingInlineStart = `${4 + item.depth * 16}px`;
    const toggle = button(mount.doc, `${item.collapsed ? 'Expand' : 'Collapse'} ${item.name}`, '', () => commit(mount, () => M.setCollapsed(state, item.id, !folder(item.id).collapsed)), 'awf-folder-toggle');
    toggle.dataset.folderToggle = item.id; toggle.setAttribute('aria-expanded', String(!item.collapsed));
    const chevron = text(mount.doc, 'span', '', item.collapsed ? '▸' : '▾'); chevron.setAttribute('aria-hidden', 'true');
    toggle.append(chevron, text(mount.doc, 'span', 'awf-folder-name', item.name), text(mount.doc, 'span', 'awf-folder-count', String(item.count)));
    toggle.addEventListener('keydown', event => {
      if (['ArrowLeft', 'ArrowRight'].includes(event.key)) { event.preventDefault(); event.stopPropagation(); run(() => commit(mount, () => M.setCollapsed(state, item.id, event.key === 'ArrowLeft'))); }
      else if (event.key === 'F2') { event.preventDefault(); event.stopPropagation(); run(() => nameDialog(mount, null, item.id)); }
      else if (['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) {
        event.preventDefault(); const i = mount.rows.findIndex(r => r.kind === 'folder' && r.id === item.id);
        const n = event.key === 'Home' ? 0 : event.key === 'End' ? mount.rows.length - 1 : Math.max(0, Math.min(mount.rows.length - 1, i + (event.key === 'ArrowDown' ? 1 : -1)));
        const next = mount.rows[n]; (next?.kind === 'folder' ? toggleFor(mount, next.id) : mount.strip.querySelector(`[data-id="tab-${next?.id}"]`))?.focus();
      }
    });
    row.append(toggle); return row;
  }
  function render(mount) {
    if (mount.nativeDrag.isDragging() && mount.scope === scopeFor(windows.find(w => w.id === mount.id))) return;
    mount.pause(); const focusedFolder = mount.doc.activeElement?.dataset.folderToggle;
    try {
      const nextScope = scopeFor(windows.find(w => w.id === mount.id));
      if (nextScope !== mount.scope) { for (const node of mount.dialogs) node.close(); mount.scope = nextScope; }
      clearProjection(mount);
      if (!nextScope || !['left', 'right'].includes(side) || !mount.bar.classList.contains(side)) return;
      const eligible = ownTabs(mount), ordinary = []; let baseY = 0;
      for (const node of mount.strip.querySelectorAll('.tab-position')) {
        const id = nativeId(node), tab = tabs.find(t => t.id === id && t.windowId === mount.id && !t.incognito);
        if (!tab || node.querySelectorAll('[role="tab"][data-id]').length !== 1 || node.querySelector('.tab-position')) { mount.status.textContent = 'Unknown native layout: folder projection paused.'; return; }
        const height = Number.parseFloat(node.style.getPropertyValue('--Height')) || 33;
        if (tab.pinned) { baseY = Math.max(baseY, (Number.parseFloat(node.style.getPropertyValue('--PositionY')) || 0) + height); continue; }
        if (!eligible.some(t => t.id === id)) return;
        const key = tabKey(tab, mount.scope); if (!key) return;
        ordinary.push({ id, key, index: tab.index, height, node });
      }
      const plan = L.layout(state, mount.scope, ordinary, { rowHeight: 33, baseY }), byKey = new Map(ordinary.map(t => [t.key, t]));
      for (const item of ordinary) { item.node.classList.add('awf-tab-row'); mount.touched.add(item.node); }
      for (const key of plan.hiddenTabKeys) byKey.get(key)?.node.classList.add('awf-hidden');
      for (const item of plan.rows) {
        if (item.kind === 'folder') mount.layer.append(folderRow(mount, item));
        else { const node = byKey.get(item.key).node; node.style.setProperty('--awf-y', `${item.y}px`); node.style.setProperty('--awf-indent', `${item.depth * 16}px`); }
      }
      mount.rows = plan.rows; mount.strip.style.setProperty('--awf-height', `${Math.max(1, baseY + plan.height)}px`); mount.strip.classList.add('awf-strip'); mount.host.classList.add('awf-scroll-host'); mount.supported = true;
      mount.status.textContent = 'Right-click the tab bar to create a folder.';
      if (focusedFolder) toggleFor(mount, focusedFolder)?.focus();
    } finally { mount.observe(); }
  }
  function renderAll() { if (!stopped) for (const mount of mounts.values()) render(mount); }
  function discover() {
    const views = api.extension.getViews();
    for (const [id, mount] of mounts) if (mount.view.closed || !views.includes(mount.view) || !mount.layer.isConnected || !mount.strip.isConnected || !['left', 'right'].includes(side) || !mount.bar.classList.contains(side)) { mount.cleanup(); mounts.delete(id); }
    if (!['left', 'right'].includes(side)) return;
    for (const view of views) {
      const win = windows.find(w => w.id === view.vivaldiWindowId && w.type === 'normal' && !w.incognito);
      if (!win || !scopeFor(win) || mounts.has(win.id)) continue;
      const bar = view.document.querySelector(`#tabs-tabbar-container.${side}`), strip = bar?.querySelector('#tabs-container > .resize > .tab-strip');
      if (strip) { const mount = makeMount(view, win, bar, strip); if (mount) mounts.set(win.id, mount); }
    }
  }
  async function refresh() {
    if (stopped) return; if (refreshing) { refreshAgain = true; return; } refreshing = true;
    try {
      do {
        refreshAgain = false;
        const [nextTabs, nextWindows, position] = await Promise.all([api.tabs.query({}), api.windows.getAll({ windowTypes: ['normal'] }), globalThis.vivaldi.prefs.get('vivaldi.tabs.bar.position')]);
        if (stopped) return; tabs = nextTabs; windows = nextWindows; side = position.value; discover(); renderAll();
      } while (refreshAgain && !stopped);
    } finally { refreshing = false; }
  }
  function dialog(mount, title, fill) {
    currentMount(mount.id); const scope = mount.scope, doc = mount.doc, opener = doc.activeElement;
    const node = text(doc, 'dialog', 'awf-dialog'); node.append(text(doc, 'h2', '', title));
    const error = text(doc, 'p', 'awf-dialog-error'); error.setAttribute('role', 'alert'); const form = text(doc, 'form'), close = () => node.close();
    const submit = action => async event => { event.preventDefault(); try { if (currentMount(mount.id).scope !== scope) throw new Error('Workspace changed; action cancelled.'); await action(); close(); } catch (failure) { error.textContent = failure.message; } };
    fill({ node, form, close, submit }); node.append(form, error); doc.body.append(node); mount.dialogs.add(node);
    node.addEventListener('close', () => { mount.dialogs.delete(node); node.remove(); if (opener?.isConnected) opener.focus(); }, { once: true }); node.showModal(); node.querySelector('input,select,button')?.focus(); return node;
  }
  function footer(mount, form, close, label) {
    const foot = text(mount.doc, 'footer'); foot.append(button(mount.doc, 'Cancel', 'Cancel', close)); const save = text(mount.doc, 'button', 'awf-primary', label); save.type = 'submit'; foot.append(save); form.append(foot);
  }
  function nameDialog(mount, parentId = null, renameId = null) {
    if (parentId) requireFolder(mount, parentId); const existing = renameId && requireFolder(mount, renameId);
    return dialog(mount, existing ? 'Rename Folder' : parentId ? 'New Subfolder' : 'New Folder', ({ form, close, submit }) => {
      const label = text(mount.doc, 'label', '', 'Name'), input = text(mount.doc, 'input'); input.name = 'name'; input.required = true; input.maxLength = 120; input.value = existing?.name || ''; label.append(input); form.append(label); footer(mount, form, close, existing ? 'Rename' : 'Create');
      form.addEventListener('submit', submit(() => commit(mount, () => existing ? M.renameFolder(state, existing.id, input.value) : M.createFolder(state, { id: `folder:${crypto.randomUUID()}`, name: input.value, parentId, scope: mount.scope }))));
    });
  }
  function moveFolderDialog(mount, id) {
    const value = requireFolder(mount, id), excluded = new Set([id, ...M.descendants(state, id)]);
    return dialog(mount, 'Move Folder', ({ form, close, submit }) => {
      const label = text(mount.doc, 'label', '', 'Parent folder'), select = text(mount.doc, 'select');
      for (const [key, name] of [['', 'Workspace Root'], ...state.folders.filter(f => f.scope === mount.scope && !excluded.has(f.id)).map(f => [f.id, M.folderPath(state, f.id)])]) { const option = text(mount.doc, 'option', '', name); option.value = key; select.append(option); }
      select.value = value.parentId || ''; label.append(select); form.append(label); footer(mount, form, close, 'Move'); form.addEventListener('submit', submit(() => commit(mount, () => M.moveFolder(state, id, select.value || null))));
    });
  }
  function destroy() {
    if (stopped) return; stopped = true; clearTimeout(timer); clearInterval(interval);
    for (const remove of listeners.splice(0)) remove(); for (const mount of mounts.values()) mount.cleanup(); mounts.clear(); menus?.restore();
  }
  const ready = (async () => {
    state = M.normalize((await api.storage.local.get(STORAGE))[STORAGE]); if (stopped) return;
    menus = N.menuBridge(globalThis.vivaldi, { current: id => mounts.get(id), entries: menuEntries, onError: error => notify(error.message) });
    for (const event of [api.tabs.onCreated, api.tabs.onRemoved, api.tabs.onUpdated, api.tabs.onActivated, api.tabs.onMoved, api.tabs.onAttached, api.tabs.onDetached, api.windows.onCreated, api.windows.onRemoved, globalThis.vivaldi.prefs.onChanged]) listen(event, schedule);
    workspaceStore.addListener(schedule); listeners.push(() => workspaceStore.removeListener(schedule)); await refresh(); if (!stopped) interval = setInterval(schedule, 900);
  })().catch(error => { destroy(); throw error; });
  globalThis.ArcWorkspaceFolders = {
    ready, destroy, refresh,
    get windowCount() { return [...mounts.values()].filter(m => m.supported).length; },
    snapshot: () => ({ storageKey: STORAGE, state: JSON.parse(JSON.stringify(state)), windows: [...mounts.values()].map(m => ({ id: m.id, scope: m.scope, supported: m.supported, nativeDrops: m.drops, rows: m.rows.map(({ kind, id, key, y, depth }) => ({ kind, id, key, y, depth })) })) }),
    menuSnapshot: () => menus?.snapshot(),
    dispatchMenuAction: id => menus?.dispatchAction({ id }),
    createFolder: (id, name, parentId = null) => { const mount = currentMount(id); return commit(mount, () => { if (parentId) requireFolder(mount, parentId); M.createFolder(state, { id: `folder:${crypto.randomUUID()}`, name, parentId, scope: mount.scope }); }); },
    placeTab: (id, tabId, folderId) => placeNativeTab(currentMount(id), tabId, folderId),
    placeTabs: (id, tabIds, folderId) => placeNativeTabs(currentMount(id), tabIds, folderId),
    setCollapsed: (id, folderId, collapsed) => { const mount = currentMount(id); return commit(mount, () => { requireFolder(mount, folderId); M.setCollapsed(state, folderId, collapsed); }); },
    removeFolder: (id, folderId) => { const mount = currentMount(id); return commit(mount, () => { requireFolder(mount, folderId); M.removeFolder(state, folderId); }); },
  };
})();
