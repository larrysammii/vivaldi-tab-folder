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
  const pageActions = nativeRequire?.(67251)?.ZP, pageStoreModule = nativeRequire?.(70406), pageStore = pageStoreModule?.ZP;
  if (!['closePage', 'closePageById', 'activateTab'].every(name => typeof pageActions?.[name] === 'function') || !['getPageById', 'getStartpage'].every(name => typeof pageStore?.[name] === 'function') || typeof pageStoreModule?.yz !== 'function' || typeof api.tabs?.discard !== 'function') {
    console.warn('[Workspace folders] Native close/unload APIs are unavailable. Native tabs are unchanged.'); return;
  }
  let state = M.emptyState(), tabs = [], windows = [], side, menus, closeHooks;
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
    const entries = [{ label: 'New Folder', run: () => beginNameEdit(mount) }];
    const value = context.folderId && folder(context.folderId);
    if (value?.scope === mount.scope) entries.push(
      { label: 'New Subfolder', run: () => beginNameEdit(mount, value.id) },
      { label: 'Rename Folder', run: () => beginNameEdit(mount, null, value.id) },
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
  function closeTargetFor(id, expected = null) {
    if (expected) return tabs.some(tab => closeTargetFor(tab.id) === expected) ? expected : null;
    const tab = tabs.find(value => value.id === id), mount = tab && mounts.get(tab.windowId), win = tab && windows.find(value => value.id === tab.windowId);
    if (stopped || !tab || tab.incognito || tab.pinned || !mount?.supported || !win || !['left', 'right'].includes(side)) return null;
    const meta = L.metadata(tab.vivExtData);
    if (meta.group || !L.inWorkspace(tab, meta.workspaceId)) return null;
    const scope = L.scopeKey(meta.workspaceId, L.metadata(win.vivExtData).ext_id), key = scope && tabKey(tab, scope), destination = key && state.tabs[key]?.folderId;
    if (mount.scope !== scope || scopeFor(win) !== scope || !destination || folder(destination)?.scope !== scope) return null;
    return JSON.stringify([tab.windowId, key, destination]);
  }
  async function getCloseTab(id, target) {
    const [windowId, key] = JSON.parse(target), win = windows.find(win => win.id === windowId);
    const live = await api.tabs.query({ windowId });
    return live.find(tab => {
      const meta = L.metadata(tab.vivExtData), scope = L.scopeKey(meta.workspaceId, L.metadata(win?.vivExtData).ext_id);
      return !tab.incognito && !tab.pinned && !meta.group && L.inWorkspace(tab, meta.workspaceId) && tabKey(tab, scope) === key;
    });
  }
  async function unloadFolderTab(tab, current) {
    if (!current()) return;
    if (tab.active) {
      const page = pageStore.getPageById(tab.id);
      if (!page || page.windowId !== tab.windowId) throw new Error('Tab changed before unloading; try again.');
      const next = pageStoreModule.yz(page);
      if (next && next.id !== tab.id) pageActions.activateTab(next.id, tab.windowId);
      else await api.tabs.create({ windowId: tab.windowId, url: pageStore.getStartpage(tab.windowId), workspaceId: L.metadata(tab.vivExtData).workspaceId, active: true });
      let inactive = false;
      for (let attempt = 0; attempt < 40; attempt++) {
        if (!(await api.tabs.get(tab.id)).active) { inactive = true; break; }
        await new Promise(resolve => setTimeout(resolve, 25));
      }
      if (!inactive) throw new Error('Vivaldi could not select another tab; the folder tab was kept open.');
    }
    if (!current()) return;
    const discarded = await api.tabs.discard(tab.id);
    // Vivaldi replaces the transient tab ID on discard; its persistent ext_id
    // and folder placement remain unchanged. The old ID is no longer live.
    const live = discarded?.id && await api.tabs.get(discarded.id);
    if (!live?.discarded || L.metadata(live.vivExtData).ext_id !== L.metadata(tab.vivExtData).ext_id) throw new Error('Vivaldi did not retain the unloaded folder entry.');
    await refresh(); notify('Page unloaded. Close the folder tab again to remove it.');
  }
  function eligibleDrag(mount, ids) {
    if (stopped || !mount.supported || scopeFor(windows.find(win => win.id === mount.id)) !== mount.scope || !Array.isArray(ids) || !ids.length || new Set(ids).size !== ids.length) return false;
    const eligible = ownTabs(mount).filter(tab => !tab.pinned);
    return ids.every(id => Number.isSafeInteger(id) && eligible.some(tab => tab.id === id));
  }
  function setDropTarget(mount, id = null, ids = []) {
    if (id && (folder(id)?.scope !== mount.scope || !mount.folderNodes.get(id)?.row.isConnected || !eligibleDrag(mount, ids))) id = null;
    if (mount.dropTarget === id && (!id || String(mount.dropIds) === String(ids))) return;
    for (const entry of mount.folderNodes.values()) entry.row.classList.toggle('awf-drop-target', !!id && entry.row.dataset.folderId === id);
    mount.dropTarget = id; mount.dropIds = id ? ids.slice() : [];
    if (id) mount.status.textContent = `Move ${ids.length} ${ids.length === 1 ? 'tab' : 'tabs'} into ${folder(id).name}`;
    else if (!mount.edit?.error) mount.status.textContent = 'Right-click the tab bar to create a folder.';
  }
  function resetDragRows(mount) {
    for (const row of mount.dragRows) { row.classList.remove('awf-dragging'); row.style.removeProperty('--awf-drag-y'); }
    mount.dragRows.clear();
  }
  function endPointerDrag(mount) {
    if (mount.dragFrame !== null) mount.view.cancelAnimationFrame(mount.dragFrame);
    mount.dragFrame = null; mount.pointerDown = false; mount.dragAnchor = null; resetDragRows(mount);
  }
  function updateDragVisual(mount) {
    const anchor = mount.dragAnchor, session = mount.nativeDrag.session();
    if (!mount.pointerDown || !anchor || !mount.pointer || anchor.scope !== mount.scope || !session || session.mode === 'detached' || !eligibleDrag(mount, session.ids)) { resetDragRows(mount); return; }
    const delta = mount.pointer.y - anchor.y + mount.host.scrollTop - anchor.scrollTop;
    const moving = new Set();
    for (const id of session.ids) {
      const initial = anchor.positions.get(id);
      if (!initial?.row.isConnected) continue;
      // Native tab coordinates describe the unmodified list and can be clamped
      // before the projected folder position. Preserve the grab offset instead.
      initial.row.style.setProperty('--awf-drag-y', `${initial.y + delta}px`);
      initial.row.classList.add('awf-dragging'); moving.add(initial.row);
    }
    for (const row of mount.dragRows) if (!moving.has(row)) { row.classList.remove('awf-dragging'); row.style.removeProperty('--awf-drag-y'); }
    mount.dragRows = moving;
  }
  function queueDragVisual(mount) {
    if (mount.dragFrame !== null || !mount.pointerDown) return;
    mount.dragFrame = mount.view.requestAnimationFrame(() => { mount.dragFrame = null; updateDragVisual(mount); });
  }
  function endDropFeedback(mount) { mount.osDrag = false; setDropTarget(mount); }
  function folderAtPoint(mount, point) {
    if (!point) return null;
    return [...mount.folderNodes.values()].find(({ row }) => { const r = row.getBoundingClientRect(); return row.isConnected && point.x >= r.left && point.x <= r.right && point.y >= r.top && point.y <= r.bottom; })?.row.dataset.folderId || null;
  }
  function clearProjection(mount, keepFolders = false) {
    if (!keepFolders) endPointerDrag(mount); else resetDragRows(mount);
    endDropFeedback(mount);
    for (const node of mount.touched) { node.classList.remove('awf-tab-row', 'awf-hidden'); node.style.removeProperty('--awf-y'); node.style.removeProperty('--awf-indent'); }
    mount.touched.clear(); mount.rows = [];
    if (!keepFolders) { mount.layer.replaceChildren(); mount.folderNodes.clear(); }
    mount.strip.classList.remove('awf-strip'); mount.strip.style.removeProperty('--awf-height'); mount.host.classList.remove('awf-scroll-host'); mount.supported = false;
  }
  function makeMount(view, win, bar, strip) {
    const controller = N.findDragController(strip);
    if (!controller || typeof controller.droppedTabHandler !== 'function') return null;
    const doc = view.document, style = text(doc, 'style'); style.dataset.arcWorkspacePrototype = 'true'; style.textContent = globalThis.ArcWorkspaceFoldersCSS; doc.head.append(style);
    const layer = text(doc, 'div', 'awf-layer'); strip.append(layer);
    const status = text(doc, 'span', 'awf-sr'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite'); bar.append(status);
    status.id = `awf-status-${win.id}`;
    const mount = { id: win.id, view, doc, bar, strip, host: strip.parentElement, status, layer, scope: scopeFor(win), touched: new Set(), dialogs: new Set(), folderNodes: new Map(), edit: null, rendering: false, dropTarget: null, dropIds: [], osDrag: false, dragRows: new Set(), dragAnchor: null, pointerDown: false, dragFrame: null, rows: [], supported: false, pointer: null, drops: 0 };
    const startPointer = event => {
      endPointerDrag(mount);
      const row = event.target.closest?.('.awf-tab-row');
      if (event.button !== 0 || !row || !mount.touched.has(row) || !eligibleDrag(mount, [nativeId(row)])) return;
      const positions = new Map();
      for (const node of mount.touched) {
        const id = nativeId(node), y = Number.parseFloat(node.style.getPropertyValue('--awf-y'));
        if (id && Number.isFinite(y) && !node.classList.contains('awf-hidden')) positions.set(id, { row: node, y });
      }
      mount.pointerDown = true; mount.pointer = { x: event.clientX, y: event.clientY };
      mount.dragAnchor = { scope: mount.scope, y: event.clientY, scrollTop: mount.host.scrollTop, positions };
    };
    const track = event => {
      mount.pointer = { x: event.clientX, y: event.clientY };
      if (event.type === 'mouseup') { endPointerDrag(mount); endDropFeedback(mount); return; }
      updateDragVisual(mount); queueDragVisual(mount);
      const session = mount.nativeDrag.session();
      if (session && session.mode !== 'detached' && (event.buttons & 1)) setDropTarget(mount, folderAtPoint(mount, mount.pointer), session.ids);
      else if (!mount.osDrag) setDropTarget(mount);
    };
    mount.nativeDrag = N.hookDragController(strip, ids => {
      endPointerDrag(mount); endDropFeedback(mount);
      if (!eligibleDrag(mount, ids)) return false;
      const destination = folderAtPoint(mount, mount.pointer);
      if (!destination || folder(destination)?.scope !== mount.scope) return false;
      mount.drops++;
      run(async () => { await placeNativeTabs(mount, ids, destination); schedule(); });
      return true;
    });
    const dragOver = event => {
      if (mount.nativeDrag.session()?.mode === 'detached') resetDragRows(mount);
      const target = event.target.closest?.('.awf-folder');
      if (!target || !layer.contains(target) || !event.dataTransfer?.types.includes(N.TAB_MIME)) { endDropFeedback(mount); return; }
      // Native OS drag data is protected during hover. When unreadable, use the
      // source controller's validated selection; never advertise a generic MIME as valid.
      let readable = false;
      try { readable = !!event.dataTransfer.getData(N.TAB_MIME); } catch {}
      const value = readable ? N.nativeTabDrop(event.dataTransfer) : null;
      const ids = readable ? (value?.sourceWindow === mount.id ? value.ids : []) : mount.nativeDrag.session()?.ids || [];
      setDropTarget(mount, target.dataset.folderId, ids);
      if (!mount.dropTarget) { mount.osDrag = false; return; }
      mount.osDrag = true;
      event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = 'move';
    };
    const dragLeave = event => {
      const row = event.target.closest?.('.awf-folder');
      if (row?.contains(event.relatedTarget)) return;
      endDropFeedback(mount);
    };
    const clearDrag = event => {
      if (event?.type === 'keydown' && event.key !== 'Escape') return;
      if (event?.type === 'mouseout' && event.relatedTarget) return;
      endPointerDrag(mount); endDropFeedback(mount); schedule();
    };
    const nativeDrop = event => {
      endPointerDrag(mount); endDropFeedback(mount);
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
    doc.addEventListener('dragenter', dragOver, true); doc.addEventListener('dragover', dragOver, true); doc.addEventListener('dragleave', dragLeave, true);
    doc.addEventListener('drop', clearDrag, true); doc.addEventListener('dragend', clearDrag, true);
    layer.addEventListener('drop', nativeDrop);
    view.addEventListener('keydown', clearDrag, true); view.addEventListener('mouseout', clearDrag, true); view.addEventListener('blur', clearDrag);
    globalThis.vivaldi.tabsPrivate.onDragEnd.addListener(clearDrag);
    const finishEditOnPointer = event => {
      const edit = mount.edit;
      if (!edit || edit.input.contains(event.target) || ![0, 2].includes(event.button)) return;
      // Native tab mousedown prevents the browser's default focus/blur. An actual
      // click outside the input must still finish naming without stealing that click.
      edit.restoreFocus = false; run(() => finishNameEdit(mount, edit, 'blur'));
    };
    const closePointer = event => {
      if (event.altKey || event.shiftKey || event.ctrlKey || event.metaKey) return;
      const middle = event.button === 1, closeButton = event.type === 'click' && event.button === 0 && event.target.closest?.('button.close');
      if (!middle && !closeButton) return;
      const row = event.target.closest?.('.tab-position'), id = row && nativeId(row);
      if (!row || !strip.contains(row) || !closeTargetFor(id)) return;
      // Native React rows can retain a pre-hook close function in their props.
      // Gate the gesture before that function runs; keep the actual rows/handlers.
      event.preventDefault(); event.stopImmediatePropagation();
      if (closeButton || event.type === 'mouseup') run(() => closeHooks.close(id));
    };
    const contextMenu = event => {
      if (!mount.supported || !bar.contains(event.target) || event.target.closest?.('.awf-name-input')) return;
      const native = event.target.closest('.tab-position');
      const context = { windowId: mount.id, scope: mount.scope, folderId: event.target.closest('.awf-folder')?.dataset.folderId || null, tabId: native ? nativeId(native) : null, x: event.clientX, y: event.clientY };
      if (context.folderId) { event.preventDefault(); event.stopPropagation(); menus.open(context); }
      else menus.note(context); // The existing native tab/bar menu supplies all original entries.
    };
    view.addEventListener('mousemove', track, true); view.addEventListener('mouseup', track, true); doc.addEventListener('contextmenu', contextMenu, true); doc.addEventListener('mousedown', finishEditOnPointer, true); doc.addEventListener('mousedown', startPointer, true);
    for (const type of ['click', 'mousedown', 'mouseup', 'auxclick']) doc.addEventListener(type, closePointer, true);
    mount.host.addEventListener('scroll', queueVisualOnScroll, { passive: true });
    function queueVisualOnScroll() { queueDragVisual(mount); }
    const observer = new view.MutationObserver(records => { if (records.some(record => !record.target.closest?.('.awf-layer'))) schedule(); });
    mount.observe = () => observer.observe(strip, { childList: true, subtree: true }); mount.pause = () => observer.disconnect();
    mount.cleanup = () => {
      observer.disconnect(); mount.nativeDrag.restore();
      doc.removeEventListener('dragenter', dragOver, true); doc.removeEventListener('dragover', dragOver, true); doc.removeEventListener('dragleave', dragLeave, true);
      doc.removeEventListener('drop', clearDrag, true); doc.removeEventListener('dragend', clearDrag, true); layer.removeEventListener('drop', nativeDrop);
      for (const type of ['click', 'mousedown', 'mouseup', 'auxclick']) doc.removeEventListener(type, closePointer, true);
      view.removeEventListener('keydown', clearDrag, true); view.removeEventListener('mouseout', clearDrag, true); view.removeEventListener('blur', clearDrag);
      globalThis.vivaldi.tabsPrivate.onDragEnd.removeListener(clearDrag);
      view.removeEventListener('mousemove', track, true); view.removeEventListener('mouseup', track, true); doc.removeEventListener('contextmenu', contextMenu, true); doc.removeEventListener('mousedown', finishEditOnPointer, true); doc.removeEventListener('mousedown', startPointer, true);
      mount.host.removeEventListener('scroll', queueVisualOnScroll);
      cancelNameEdit(mount, false, false);
      for (const node of mount.dialogs) node.close(); clearProjection(mount); layer.remove(); status.remove(); style.remove();
    };
    mount.observe(); return mount;
  }
  function folderRow(mount, item) {
    let entry = mount.folderNodes.get(item.id);
    if (!entry) {
      const row = text(mount.doc, 'div', 'awf-folder'); row.dataset.folderId = item.id;
      const toggle = button(mount.doc, '', '', () => commit(mount, () => { const value = requireFolder(mount, item.id); M.setCollapsed(state, item.id, !value.collapsed); }), 'awf-folder-toggle');
      toggle.dataset.folderToggle = item.id;
      const chevron = text(mount.doc, 'span'); chevron.setAttribute('aria-hidden', 'true');
      const label = text(mount.doc, 'span', 'awf-folder-name'), count = text(mount.doc, 'span', 'awf-folder-count');
      toggle.append(chevron, label, count); row.append(toggle);
      toggle.addEventListener('keydown', event => {
        if (['ArrowLeft', 'ArrowRight'].includes(event.key)) { event.preventDefault(); event.stopPropagation(); run(() => commit(mount, () => M.setCollapsed(state, item.id, event.key === 'ArrowLeft'))); }
        else if (event.key === 'F2') { event.preventDefault(); event.stopPropagation(); run(() => beginNameEdit(mount, null, item.id)); }
        else if (['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) {
          event.preventDefault(); const i = mount.rows.findIndex(r => r.kind === 'folder' && r.id === item.id);
          const n = event.key === 'Home' ? 0 : event.key === 'End' ? mount.rows.length - 1 : Math.max(0, Math.min(mount.rows.length - 1, i + (event.key === 'ArrowDown' ? 1 : -1)));
          const next = mount.rows[n]; (next?.kind === 'folder' ? toggleFor(mount, next.id) : mount.strip.querySelector(`[data-id="tab-${next?.id}"]`))?.focus();
        }
      });
      entry = { row, toggle, chevron, label, count }; mount.folderNodes.set(item.id, entry);
    }
    const { row, toggle, chevron, label, count } = entry;
    row.style.top = `${item.y}px`; row.style.height = `${item.height}px`; row.style.paddingInlineStart = `${4 + item.depth * 16}px`;
    toggle.title = `${item.collapsed ? 'Expand' : 'Collapse'} ${item.name}`; toggle.setAttribute('aria-label', toggle.title); toggle.setAttribute('aria-expanded', String(!item.collapsed));
    chevron.textContent = item.collapsed ? '▸' : '▾'; label.textContent = item.name; count.textContent = String(item.count);
    const editing = mount.edit?.id === item.id && mount.edit.scope === mount.scope;
    toggle.hidden = editing; row.classList.toggle('awf-editing', editing);
    if (editing) { if (mount.edit.input.parentElement !== row) row.append(mount.edit.input); }
    else row.querySelector('.awf-name-input')?.remove();
    return row;
  }
  function projectionState(mount) {
    const edit = mount.edit;
    if (!edit) return state;
    const projected = { ...state, folders: state.folders.map(value => ({ ...value })) };
    if (edit.isNew && !folder(edit.id)) M.createFolder(projected, { id: edit.id, name: 'Untitled', parentId: edit.parentId, scope: edit.scope });
    let parent = projected.folders.find(value => value.id === edit.id)?.parentId;
    while (parent) { const value = projected.folders.find(value => value.id === parent); if (!value) break; value.collapsed = false; parent = value.parentId; }
    return projected;
  }
  function render(mount) {
    const nextScope = scopeFor(windows.find(w => w.id === mount.id)), scopeChanged = nextScope !== mount.scope;
    if (scopeChanged) { cancelNameEdit(mount, false, false); for (const node of mount.dialogs) node.close(); mount.scope = nextScope; clearProjection(mount); }
    if (mount.edit && ((!mount.edit.isNew && folder(mount.edit.id)?.scope !== mount.scope) || (mount.edit.parentId && folder(mount.edit.parentId)?.scope !== mount.scope))) cancelNameEdit(mount, false, false);
    if ((mount.nativeDrag.isDragging() || mount.osDrag) && !scopeChanged) {
      if (mount.dropTarget && (folder(mount.dropTarget)?.scope !== mount.scope || !eligibleDrag(mount, mount.dropIds))) endDropFeedback(mount);
      return;
    }
    mount.pause(); mount.rendering = true;
    const focusedFolder = mount.doc.activeElement?.dataset.folderToggle, edit = mount.edit;
    if (edit?.input === mount.doc.activeElement) edit.restoreFocus = true;
    try {
      if (!nextScope || !['left', 'right'].includes(side) || !mount.bar.classList.contains(side)) { clearProjection(mount); return; }
      const eligible = ownTabs(mount), ordinary = []; let baseY = 0;
      for (const node of mount.strip.querySelectorAll('.tab-position')) {
        const id = nativeId(node), tab = tabs.find(t => t.id === id && t.windowId === mount.id && !t.incognito);
        if (!tab || node.querySelectorAll('[role="tab"][data-id]').length !== 1 || node.querySelector('.tab-position') || (!tab.pinned && !eligible.some(t => t.id === id))) { clearProjection(mount); mount.status.textContent = 'Unknown native layout: folder projection paused.'; return; }
        const height = Number.parseFloat(node.style.getPropertyValue('--Height')) || 33;
        if (tab.pinned) { baseY = Math.max(baseY, (Number.parseFloat(node.style.getPropertyValue('--PositionY')) || 0) + height); continue; }
        const key = tabKey(tab, mount.scope); if (!key) { clearProjection(mount); return; }
        ordinary.push({ id, key, index: tab.index, height, node });
      }
      const plan = L.layout(projectionState(mount), mount.scope, ordinary, { rowHeight: 33, baseY }), byKey = new Map(ordinary.map(t => [t.key, t]));
      clearProjection(mount, true);
      for (const item of ordinary) { item.node.classList.add('awf-tab-row'); mount.touched.add(item.node); }
      for (const key of plan.hiddenTabKeys) byKey.get(key)?.node.classList.add('awf-hidden');
      const folderRows = [];
      for (const item of plan.rows) {
        if (item.kind === 'folder') folderRows.push(folderRow(mount, item));
        else { const node = byKey.get(item.key).node; node.style.setProperty('--awf-y', `${item.y}px`); node.style.setProperty('--awf-indent', `${item.depth * 16}px`); }
      }
      const visible = new Set(folderRows);
      for (const [id, entry] of mount.folderNodes) if (!visible.has(entry.row)) { entry.row.remove(); mount.folderNodes.delete(id); }
      let next = null;
      for (const row of folderRows.slice().reverse()) { if (row.parentElement !== mount.layer || row.nextElementSibling !== next) mount.layer.insertBefore(row, next); next = row; }
      mount.rows = plan.rows; mount.strip.style.setProperty('--awf-height', `${Math.max(1, baseY + plan.height)}px`); mount.strip.classList.add('awf-strip'); mount.host.classList.add('awf-scroll-host'); mount.supported = true;
      if (!edit?.error) mount.status.textContent = 'Right-click the tab bar to create a folder.';
      if (edit?.restoreFocus && edit.input.isConnected && mount.doc.activeElement !== edit.input) { edit.input.focus(); edit.restoreFocus = false; }
      else if (!edit && focusedFolder) toggleFor(mount, focusedFolder)?.focus();
    } catch (error) {
      clearProjection(mount); mount.status.textContent = `Native tab layout is unavailable; folders paused: ${error.message}`;
    } finally { mount.rendering = false; mount.observe(); }
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
  function cancelNameEdit(mount, rerender = true, focus = true) {
    const edit = mount.edit; if (!edit) return;
    mount.edit = null; edit.restoreFocus = false; edit.input.remove();
    if (rerender && !stopped) { render(mount); if (focus) { const target = toggleFor(mount, edit.isNew ? edit.parentId : edit.id) || edit.opener; if (target?.isConnected) target.focus(); } }
  }
  async function finishNameEdit(mount, edit, reason = 'enter') {
    if (mount.edit !== edit || stopped) return false;
    if (edit.saving) return edit.pending;
    if (edit.composing) { if (reason === 'blur') edit.blurPending = true; return false; }
    const value = edit.input.value.trim(), name = value || (reason === 'blur' && edit.isNew ? 'Untitled' : '');
    const fail = message => { edit.error = message; edit.input.setAttribute('aria-invalid', 'true'); mount.status.textContent = message; edit.input.focus(); };
    if (!name) { fail('Enter a folder name.'); return false; }
    if (edit.scope !== scopeFor(windows.find(w => w.id === mount.id))) { cancelNameEdit(mount); return false; }
    edit.saving = true; edit.input.readOnly = true;
    edit.pending = (async () => {
      try {
        await commit(mount, () => {
          if (mount.edit !== edit || mount.scope !== edit.scope) throw new Error('Naming was cancelled; no folder changes saved.');
          if (edit.isNew) {
            if (edit.parentId) requireFolder(mount, edit.parentId);
            M.createFolder(state, { id: edit.id, name, parentId: edit.parentId, scope: edit.scope });
            let parent = edit.parentId; while (parent) { const ancestor = requireFolder(mount, parent); M.setCollapsed(state, parent, false); parent = ancestor.parentId; }
          } else { requireFolder(mount, edit.id); M.renameFolder(state, edit.id, name); }
        });
        if (mount.edit === edit) { mount.edit = null; renderAll(); if (reason !== 'blur') toggleFor(mount, edit.id)?.focus(); }
        return true;
      } catch (error) { if (mount.edit === edit) { edit.saving = false; edit.input.readOnly = false; fail(error.message); } return false; }
    })();
    return edit.pending;
  }
  async function beginNameEdit(mount, parentId = null, renameId = null) {
    currentMount(mount.id); const scope = mount.scope;
    if (mount.edit) { if (renameId === mount.edit.id) { mount.edit.input.focus(); return; } if (!await finishNameEdit(mount, mount.edit, 'blur')) return; }
    if (stopped || currentMount(mount.id).scope !== scope) return;
    if (parentId) requireFolder(mount, parentId); const existing = renameId && requireFolder(mount, renameId);
    const input = text(mount.doc, 'input', 'awf-name-input'); input.type = 'text'; input.maxLength = 120; input.value = existing?.name || 'Untitled'; input.spellcheck = false; input.setAttribute('aria-label', existing ? 'Rename folder' : 'New folder name'); input.setAttribute('aria-describedby', mount.status.id);
    const edit = { id: existing?.id || `folder:${crypto.randomUUID()}`, parentId: existing?.parentId ?? parentId, scope, isNew: !existing, original: existing?.name, opener: mount.doc.activeElement, input, composing: false, blurPending: false, saving: false, restoreFocus: false, error: null };
    if (edit.isNew) M.createFolder({ ...state, folders: state.folders.map(value => ({ ...value })) }, { id: edit.id, name: 'Untitled', parentId, scope });
    mount.edit = edit;
    input.addEventListener('input', () => { edit.error = null; input.removeAttribute('aria-invalid'); });
    for (const type of ['pointerdown', 'mousedown', 'click', 'dblclick', 'keyup']) input.addEventListener(type, event => event.stopPropagation());
    input.addEventListener('keydown', event => {
      event.stopPropagation();
      if (event.isComposing || edit.composing || event.keyCode === 229) return;
      if (event.key === 'Enter') { event.preventDefault(); run(() => finishNameEdit(mount, edit)); }
      else if (event.key === 'Escape') { event.preventDefault(); if (!edit.saving) cancelNameEdit(mount); }
    });
    input.addEventListener('compositionstart', () => { edit.composing = true; });
    input.addEventListener('compositionend', () => { edit.composing = false; if (edit.blurPending) { edit.blurPending = false; run(() => finishNameEdit(mount, edit, 'blur')); } });
    input.addEventListener('blur', () => {
      // Native window deactivation can emit blur while this remains the focused
      // element. That is not a click-away edit and must not save/discard a draft.
      if (mount.doc.activeElement === input) return;
      if (mount.edit === edit && !mount.rendering && !edit.saving && !stopped) { edit.restoreFocus = false; run(() => finishNameEdit(mount, edit, 'blur')); }
    });
    render(mount); input.focus(); input.select();
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
    if (stopped) return; stopped = true; clearTimeout(timer); clearInterval(interval); closeHooks?.restore();
    for (const remove of listeners.splice(0)) remove(); for (const mount of mounts.values()) mount.cleanup(); mounts.clear(); menus?.restore();
  }
  const ready = (async () => {
    state = M.normalize((await api.storage.local.get(STORAGE))[STORAGE]); if (stopped) return;
    closeHooks = N.hookTabClose(pageActions, { targetFor: closeTargetFor, getTab: getCloseTab, unload: unloadFolderTab, onError: error => { notify(error.message); console.warn('[Workspace folders]', error.message); } });
    if (!closeHooks) throw new Error('Native close actions cannot be safely extended.');
    menus = N.menuBridge(globalThis.vivaldi, { current: id => mounts.get(id), entries: menuEntries, onError: error => notify(error.message) });
    for (const event of [api.tabs.onCreated, api.tabs.onRemoved, api.tabs.onUpdated, api.tabs.onActivated, api.tabs.onMoved, api.tabs.onAttached, api.tabs.onDetached, api.tabs.onReplaced, api.windows.onCreated, api.windows.onRemoved, globalThis.vivaldi.prefs.onChanged]) listen(event, schedule);
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
