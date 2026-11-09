/* Reversible bridges to version-checked native menu, drag and tab-close engines. */
(function (root, factory) {
  const value = factory();
  if (root) root.ArcWorkspaceNative = value;
  if (typeof module === 'object' && module.exports) module.exports = value;
})(typeof globalThis === 'undefined' ? null : globalThis, function () {
  'use strict';
  function findDragController(strip) {
    const key = Object.keys(strip).find(k => k.startsWith('__reactFiber$'));
    for (let fiber = strip[key], n = 0; fiber && n < 80; fiber = fiber.return, n++) {
      const instance = fiber.stateNode;
      if (typeof instance?.endInternalDragging === 'function' && typeof instance?.cleanupDragging === 'function') return instance;
    }
    return null;
  }
  function hookDragController(strip, onDrop) {
    const controller = findDragController(strip);
    if (!controller) return null;
    const original = controller.endInternalDragging;
    let restored = false;
    function dragSession(source) {
      try {
        const state = source?.state;
        const mode = state?.dragMode;
        if (!mode) return null;
        const collection = state.draggedPages;
        const pages = Array.isArray(collection) ? collection : collection?.toArray?.();
        if (!Array.isArray(pages) || !pages.length) return null;
        const ids = [], seen = new Set();
        for (const page of pages) {
          if (!page || typeof page !== 'object' || Array.isArray(page)) return null;
          const id = page.id;
          if (!Number.isSafeInteger(id) || id <= 0 || seen.has(id)) return null;
          seen.add(id); ids.push(id);
        }
        return { mode, ids };
      } catch { return null; }
    }
    function wrapped(...args) {
      const session = dragSession(this);
      if (session && session.mode !== 'detached' && onDrop(session.ids)) { this.cleanupDragging(); return; }
      return original.apply(this, args);
    }
    controller.endInternalDragging = wrapped;
    return {
      controller,
      isDragging: () => !!controller.state?.dragMode,
      session: () => dragSession(controller),
      restore() {
        if (restored) return; restored = true;
        if (controller.endInternalDragging === wrapped) controller.endInternalDragging = original;
      },
    };
  }
  function hookTabClose(actions, { targetFor, getTab, unload, onError = () => {} }) {
    const names = ['closePage', 'closePageById'];
    if (!actions || !names.every(name => typeof actions[name] === 'function' && Object.getOwnPropertyDescriptor(actions, name)?.writable) || ![targetFor, getTab, unload].every(value => typeof value === 'function')) return null;
    const original = new Map(names.map(name => [name, actions[name]])), pending = new Map(), wrappers = new Map();
    let restored = false;
    function singleId(value) {
      try {
        const page = Array.isArray(value) ? (value.length === 1 ? value[0] : null) : value?.size === 1 && typeof value.first === 'function' ? value.first() : value;
        return Number.isSafeInteger(page?.id) && page.id > 0 ? page.id : null;
      } catch { return null; }
    }
    function request(id, invoke) {
      if (restored) return Promise.resolve();
      if (!Number.isSafeInteger(id) || id <= 0) return invoke(id);
      let target;
      try { target = targetFor(id); } catch (error) { onError(error); return Promise.resolve(); }
      if (!target) return invoke(id);
      const current = () => !restored && targetFor(id, target) === target;
      const task = (pending.get(target) || Promise.resolve()).then(async () => {
        if (!current()) return;
        const tab = await getTab(id, target);
        if (!tab || !current()) return;
        // Serialize by persistent entry, not a transient ID that discard replaces.
        if (tab.discarded) return invoke(tab.id);
        await unload(tab, current);
      }).catch(onError);
      pending.set(target, task);
      const settled = () => { if (pending.get(target) === task) pending.delete(target); };
      task.then(settled, settled);
      return task;
    }
    for (const name of names) {
      function wrapped(...args) {
        if (restored) return original.get(name).apply(this, args);
        const id = name === 'closePageById' ? args[0] : singleId(args[0]);
        return request(id, liveId => liveId === id ? original.get(name).apply(this, args) : original.get('closePageById').call(actions, liveId));
      }
      actions[name] = wrapped; wrappers.set(name, wrapped);
    }
    return {
      close(id) { return request(id, liveId => original.get('closePageById').call(actions, liveId)); },
      restore() {
        if (restored) return; restored = true;
        for (const name of names) if (actions[name] === wrappers.get(name)) actions[name] = original.get(name);
      },
    };
  }
  const TAB_MIME = 'vivaldi/x-tab-entries';
  function nativeTabDrop(dataTransfer) {
    if (!dataTransfer?.types?.includes(TAB_MIME)) return null;
    try {
      const raw = dataTransfer.getData(TAB_MIME);
      if (typeof raw !== 'string' || raw.length > 262144) return null;
      const value = JSON.parse(raw);
      const fields = ['ids', 'active', 'activeIndex', 'dragSource', 'sourceWindow'];
      if (!value || Array.isArray(value) || Object.keys(value).length !== fields.length || !fields.every(key => Object.hasOwn(value, key))) return null;
      if (!Array.isArray(value.ids) || !value.ids.length || value.ids.length > 10000) return null;
      if (!value.ids.every(id => (typeof id === 'number' || (typeof id === 'string' && /^\d+$/.test(id))) && Number.isSafeInteger(Number(id)) && Number(id) > 0)) return null;
      const ids = value.ids.map(Number);
      if (new Set(ids).size !== ids.length || !Number.isSafeInteger(value.active) || !ids.includes(value.active)) return null;
      if (!Number.isSafeInteger(value.activeIndex) || value.activeIndex < 0 || !Number.isSafeInteger(value.sourceWindow) || value.sourceWindow <= 0) return null;
      if (!['main', 'stack'].includes(value.dragSource)) return null;
      const { active, activeIndex, dragSource, sourceWindow } = value;
      // Forward a canonical native schema, never an untrusted raw object/string.
      const payload = JSON.stringify({ ids, active, activeIndex, dragSource, sourceWindow });
      return { ids, active, activeIndex, dragSource, sourceWindow, payload };
    } catch { return null; }
  }
  function menuBridge(api, { current, entries, onError = () => {}, now = Date.now }) {
    const original = api?.contextMenu?.show;
    if (typeof original !== 'function' || !api?.menubarMenu?.onAction?.addListener || !api?.menubarMenu?.onClose?.addListener) throw new Error('Native context-menu APIs are unavailable');
    let context;
    let last = null;
    let nextId = 1900000000;
    let restored = false;
    const commands = new Map();
    const valid = value => {
      const mount = value && current(value.windowId);
      return !!mount?.supported && mount.scope === value.scope;
    };
    function serialize(list, captured) {
      return list.map(entry => {
        if (entry.separator) return { separator: {} };
        const id = ++nextId;
        if (nextId >= 2000000000) throw new Error('Native menu ID range exhausted');
        const node = { item: { id, name: entry.label, type: entry.children ? 'folder' : 'command', enabled: entry.enabled !== false } };
        if (entry.children) node.children = serialize(entry.children, captured);
        else commands.set(id, { run: entry.run, context: captured });
        return node;
      });
    }
    function wrapped(request, ...args) {
      commands.clear(); last = null;
      if (context && now() - context.at < 1500 && request.windowId === context.windowId && valid(context)) {
        const captured = context;
        const custom = serialize(entries(captured), captured);
        captured.shown = true;
        const children = request.children || [];
        request = { ...request, children: [...children, ...(children.length && custom.length ? [{ separator: {} }] : []), ...custom] };
        last = { windowId: request.windowId, scope: captured.scope, commands: [...commands].map(([id, command]) => ({ id, label: findLabel(custom, id) })) };
      }
      return original.call(api.contextMenu, request, ...args);
    }
    function findLabel(nodes, id) {
      for (const node of nodes) { if (node.item?.id === id) return node.item.name; const value = node.children && findLabel(node.children, id); if (value) return value; }
      return null;
    }
    function dispatchAction(event) {
      const command = commands.get(event.id);
      if (!command) return false;
      if (!valid(command.context)) { onError(new Error('Workspace changed; menu action cancelled.')); return true; }
      Promise.resolve().then(command.run).catch(onError); return true;
    }
    function close() { commands.clear(); context = null; }
    api.contextMenu.show = wrapped;
    api.menubarMenu.onAction.addListener(dispatchAction); api.menubarMenu.onClose.addListener(close);
    return {
      note(value) { context = { ...value, at: now(), shown: false }; return context; },
      open(value) {
        context = { ...value, at: now(), shown: false };
        return wrapped({ windowId: value.windowId, documentId: -1, forceViews: false, origin: 'pointer', rect: { x: value.x, y: value.y, width: 0, height: 0 }, icons: [], children: [] });
      },
      dispatchAction,
      snapshot: () => last && JSON.parse(JSON.stringify(last)),
      restore() {
        if (restored) return; restored = true;
        if (api.contextMenu.show === wrapped) api.contextMenu.show = original;
        api.menubarMenu.onAction.removeListener(dispatchAction); api.menubarMenu.onClose.removeListener(close);
        close();
      },
    };
  }
  return Object.freeze({ findDragController, hookDragController, hookTabClose, menuBridge, TAB_MIME, nativeTabDrop });
});
