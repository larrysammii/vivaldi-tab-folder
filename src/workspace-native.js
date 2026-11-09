/* Small, reversible bridges to the version-checked native menu and drag engines. */
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
    function wrapped(...args) {
      const state = this.state;
      if (state?.dragMode && state.dragMode !== 'detached') {
        const pages = state.draggedPages?.toArray?.() || (Array.isArray(state.draggedPages) ? state.draggedPages : []);
        const ids = pages.map(page => page.id).filter(Number.isSafeInteger);
        if (ids.length && onDrop(ids)) { this.cleanupDragging(); return; }
      }
      return original.apply(this, args);
    }
    controller.endInternalDragging = wrapped;
    return {
      controller,
      isDragging: () => !!controller.state?.dragMode,
      restore() {
        if (restored) return; restored = true;
        if (controller.endInternalDragging === wrapped) controller.endInternalDragging = original;
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
  return Object.freeze({ findDragController, hookDragController, menuBridge, TAB_MIME, nativeTabDrop });
});
