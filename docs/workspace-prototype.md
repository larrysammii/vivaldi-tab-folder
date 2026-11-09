# Workspace-native prototype

This is the replacement design for the original standalone sidebar: **Workspace → Folders → Native tabs**. It is an isolated prototype, not a persistent app patch.

## Interaction contract

- Right-click the existing vertical tab bar to create a folder. Existing native menu entries remain available.
- Folder rows live in that same strip, without a second panel, `+ Folder` toolbar, or custom tab drag handles.
- Right-click a folder for nesting, rename, move-parent, and removal. Removal preserves open tabs.
- Actual native tabs can be assigned through native drag/drop or the native context menu's **Move to Folder** submenu.
- Changing workspace changes the folder tree. Private contexts and unsupported layouts are left alone.

## Source boundaries

| File | Responsibility |
| --- | --- |
| `src/model.js` | Existing pure tree model; unchanged storage shape |
| `src/workspace-layout.js` | Metadata validation, workspace/tab key namespacing, visible/hidden rows, deterministic geometry |
| `src/workspace-native.js` | Reversible native menu and drag bridges; native serialized-drop validation |
| `src/workspace-folders.js` | Window discovery, workspace scopes, storage queue, native-row projection, dialogs and lifecycle |
| `src/workspace-folders.css` | Scoped theme-token styles; no standalone-panel layout |

`tools/build-workspace.mjs` assembles these sources into ignored `.local/workspace-folders.js`. `tools/launch-workspace.mjs` verifies Vivaldi 8.3.4191.26, creates `.local/workspace-profile`, starts that isolated browser with a random loopback debugging endpoint, sets its vertical-tab side, and injects the prototype in memory. It does not write inside the installed app.

The CDP connector permits only the explicitly named project test profiles and validates each profile's debugging endpoint identity before attaching. It is not a general normal-profile/browser connector.

## Identity and persistence

Native workspace IDs come from Vivaldi's workspace store, rather than inferring scope from an active tab. That distinction matters with pinned tabs and empty workspaces. On the verified build, the store is the shape-checked webpack module `61685`; the launcher refuses other browser versions.

The scope is `workspace:<native ID>`, or `home:<persistent window UUID>` for the default/home view. A tab-placement key combines that scope with its existing `vivExtData.ext_id`. Native transient `tab.id` values are used only for live API operations. No tab URLs/titles or browser content are persisted.

Folder data uses `arc-folders.workspace-prototype.v1`. The old `arc-folders.state.v1` remains untouched. No speculative migration is performed because old window-wide folders contain no workspace mapping. Trial and normal profiles do not share this storage.

## Native ownership

Vivaldi/React retains ownership of its actual tab elements. The projection adds only folder headers and scoped position/indent variables. It does not rebuild a parallel tab list or replace the native strip's children. Native stacks or unknown row structures cause the projection to pause and restore original tab styling.

Menu integration extends the native `contextMenu.show` request and listens for its native action IDs. A right-click on a folder uses that same native popup API. Command context is bound to a window and workspace; stale menu/dialog actions cannot write into a different workspace.

Native dragging is not HTML dragging on the tab title. The bridge handles both the native internal-drag controller and OS/native `vivaldi/x-tab-entries` drops. Serialized drops must match the complete native schema, name the current source window, and contain unique positive IDs belonging to ordinary tabs in the current workspace. The active ID must be one of those tabs. Unknown fields and oversized payloads are rejected; only a canonical native payload is forwarded. Stale destinations and synchronous native-handler failures reject the drop without throwing out of its DOM listener. Each selected tab batch uses one model transaction and storage write, so a failed save rolls the entire folder assignment back.

Vivaldi's own `droppedTabHandler` consumes accepted external/native drops so its drag session is marked handled instead of accidentally detaching a new window. Cross-window/workspace drops are not implemented by this prototype.

Teardown removes listeners, dialogs, folder nodes, and projection styles, and restores native methods only while the prototype still owns those methods. Repeated teardown is safe. Native hooks remain private, version-specific interfaces and can break after a browser update.

## Run and verify

```sh
npm run try                       # isolated native-workspace trial
npm run try:workspace -- --side=right
npm run check
npm run check:workspace
npm run test:workspace-browser
```

The browser suite restores its temporary folder state and native API hooks after testing. It retains the dedicated synthetic workspaces for further trial use. It never attaches to the normal browsing profile. Captures and logs stay under ignored `.local/` unless a reviewed synthetic screenshot is deliberately copied into documentation.

### Test evidence boundary

Real CDP pointer/keyboard input exercises tab-bar context-menu requests, dialogs, tab-title drag initiation, native tab activation/close, and folder interaction. The suite intercepts platform popup selection and OS drag start, then dispatches the captured native command and tab-drop payload. Native lifecycle callbacks are completed and restored during test cleanup.

Those checks do not constitute verification of physical-mouse OS drag completion or platform-menu selection. Manually check both in the disposable window before considering broader use. Process-restart behavior, native-stack combinations, large-tab performance, other Vivaldi versions, and persistent normal-profile installation remain unverified or unsupported.

## Legacy separation

`npm run try:legacy`, `tools/build.mjs`, `src/sidebar.*`, and `tools/install.py` remain the older window-wide sidebar path. The legacy installer does not install this prototype. Normal Vivaldi should remain unpatched while this design is evaluated.
