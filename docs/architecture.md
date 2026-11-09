# How the legacy sidebar works

> This page documents the earlier window-wide sidebar, retained for regression checks. The default trial now uses the [workspace-native prototype](workspace-prototype.md), not this standalone panel.

## Boundaries

This repository contains a DOM sidebar mod and its tooling. It does not contain Vivaldi's application code, rebuild Chromium, register a normal web-content extension, or change the native tab-group model.

| File | Responsibility |
| --- | --- |
| `src/model.js` | Dependency-free tree model, normalization, cycle/depth checks, ordering, and safe folder removal; browser global plus CommonJS export |
| `src/sidebar.js` | One shared controller, native tab/window events, local persistence, per-window DOM mounts, keyboard/dialog/drag interactions |
| `src/sidebar.css` | Scoped styles using Vivaldi theme tokens; no external assets |
| `tools/build.mjs` | Deterministic concatenation into `dist/arc-folders.js`, with a SHA-256 digest |
| `tools/install.py` | Version-checked read-only plan, explicit startup-hook installation, and hash-guarded rollback |

## UI integration

In the verified build, Vivaldi loads its React/browser UI from a shared `main.html` context. Rendered `window.html` views expose `vivaldiWindowId`. The controller discovers these views with `chrome.extension.getViews()` and inserts its own sidebar under `#main > .inner`.

The sidebar is an added DOM sibling, not a replacement for the page webview or native tab bar. Mounts are reconciled as windows appear or disappear. A discovery timer covers delayed window rendering; native events coalesce data refreshes. Reloading the mod destroys the old controller, listeners, timers, styles, dialogs, and mounts before creating another.

Private browsing uses a separate main context. Mounting also explicitly excludes windows marked incognito. The current implementation does not provide private folder persistence.

## State and identity

The local extension-storage key is `arc-folders.state.v1`:

```js
{
  version: 1,
  folders: [
    { id, name, parentId, scope, collapsed, order }
  ],
  tabs: {
    [stableTabKey]: { folderId, order }
  }
}
```

Folder IDs are mod-owned UUIDs. Window scopes and tab keys use the existing `vivExtData.ext_id` UUIDs provided by Vivaldi. **The mod reads that metadata but does not change it.** Numeric tab/window IDs are used only for current native API actions, not as persisted identity.

Scopes are per window, across all workspaces in that window. If a tab's saved folder belongs to another window scope, it appears unfiled in the current sidebar. Assignments do not use URL matching. The restored native IDs survived an actual isolated browser-process restart in the verified build; fresh profiles and newly created identities are a separate case.

Persisted folder state contains names, hierarchy, order, collapsed flags, and ID assignments. It does not copy tab titles, URLs, page contents, cookies, or passwords. Native tab information is read in memory to render the current sidebar.

## Mutations and refresh

1. A user action requests a model mutation or a native tab operation.
2. Model operations validate names, ownership scope, destinations, cycles, and depth before changing the tree.
3. Serialized commits capture a snapshot and write it to local storage. A failed write rolls back the in-memory model and exposes an error.
4. The controller renders the current live tabs through the saved hierarchy, using a per-render index rather than repeated full-model lookups.
5. Native tab/window events schedule coalesced refreshes; refresh is deferred during an active drag.

Model normalization repairs invalid persisted links and tab references, handles cycles, and rejects unsafe records. The current limits are 16 folder levels, 2,000 folders, and 10,000 saved tab placements. Closed-tab placements can remain so restoring an existing identity can retain its assignment; reaching the placement limit is an error, not an instruction to erase user data.

Removing a folder unwraps it: direct child folders and assigned tabs move to its parent. It does not call the tab-close API. The tab row's separate close control does.

## Interaction details

HTML drag data contains only a mod item kind and stable ID. Drops resolve against current live tabs and the model's destination rules. For first-use reordering of loose tabs, the controller first materializes their visible order, because those tabs may not yet have saved placements.

Move dialogs provide parent and position controls without dragging. Tree navigation uses arrow keys, Home/End, F2, and Shift+F10. Native dialogs explicitly wrap forward/reverse Tab focus and restore the logical opener after a tree re-render. Dialog close/focus events are queued, so tests wait for focus restoration instead of asserting immediately when `open` disappears.

## Two loading paths

**Trial:** `tools/launch-test.mjs` launches the unmodified Vivaldi executable with an explicit `.local/test-profile` and loopback debugging. It loads the built script into the normal shared UI context over CDP. The injected code disappears on quit; storage in that test profile remains.

**Persistent hook:** the installer adds one script reference to that version's `main.html`. This uses the same controller design but edits signed resources. Generic Vivaldi forum guidance describes `window.html` hooks; this controller uses the shared main context to avoid one independent state writer per browser window. Permanent signed-app startup compatibility is not established by the trial tests.

The CDP helper uses only the endpoint recorded in the project-owned test profile and verifies its browser WebSocket path, rejecting stale-port mismatches. It waits for extension bindings and distinguishes normal/private main contexts even though their URLs match. No default-profile discovery is performed.

## Verification and remaining unknowns

Pure model and installer tests run without Vivaldi. Browser smoke tests exercise the actual UI using synthetic pages, including real pointer input and native key events. Lifecycle tests cover multiple windows, a separate private main context, and an actual isolated process restart. Temporary test state is restored.

These checks do not establish compatibility with another Vivaldi version, macOS acceptance of a modified app signature, browser Sync, workspace-specific folders, saved closed links, Arc archiving, other operating systems, or extreme-scale performance. See [installation](installation.md) before changing app resources and [investigation](investigation.md) for research limitations.
