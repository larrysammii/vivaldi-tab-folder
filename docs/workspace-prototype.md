# Workspace-native prototype

This is the replacement design for the original standalone sidebar: **Workspace → Folders → Native tabs**. It is an isolated prototype, not a persistent app patch.

## Interaction contract

- Right-click the existing vertical tab bar to create a folder, then name it directly in its row. Existing native menu entries remain available.
- Folder rows live in that same strip, without a second panel, `+ Folder` toolbar, naming modal, or custom tab drag handles.
- Right-click a folder for nesting, inline rename, move-parent, and removal. Removal preserves open tabs. **Enter/click-away** saves naming; **Escape** cancels a new row or restores an existing title. An empty new name keeps `Untitled` on click-away.
- Actual native tabs can be assigned through native drag/drop or the native context menu's **Move to Folder** submenu. One eligible folder is visibly highlighted before release; feedback clears on exit/cancellation/drop. Dropping does not expand a closed folder.
- Folder tabs have a two-stage close: loaded → unloaded entry → removed. Opening an unloaded entry reloads it and resets the cycle. The rule covers individual ×/Command-W/middle-click/Close Tab actions; unfiled tabs and bulk/window close remain native. [Full lifecycle contract](folder-tab-lifecycle.md).
- Changing workspace changes the folder tree. Private contexts and unsupported layouts are left alone.

## Source boundaries

| File | Responsibility |
| --- | --- |
| `src/model.js` | Existing pure tree model; unchanged storage shape |
| `src/workspace-layout.js` | Metadata validation, workspace/tab key namespacing, visible/hidden rows, deterministic geometry |
| `src/workspace-native.js` | Reversible native menu, drag and individual-close bridges; serialized-drop validation and persistent-entry close sequencing |
| `src/workspace-folders.js` | Window discovery, workspace scopes, storage queue, keyed folder rows, protected inline naming, drop feedback, move-parent dialog and lifecycle |
| `src/workspace-folders.css` | Scoped theme-token styles; no standalone-panel layout |

`tools/build-workspace.mjs` assembles these sources into ignored `.local/workspace-folders.js`. `tools/launch-workspace.mjs` verifies Vivaldi 8.3.4191.26, creates `.local/workspace-profile`, starts that isolated browser with a random loopback debugging endpoint, sets its vertical-tab side, and injects the prototype in memory. It does not write inside the installed app.

The CDP connector permits only the explicitly named project test profiles and validates each profile's debugging endpoint identity before attaching. It is not a general normal-profile/browser connector.

## Identity and persistence

Native workspace IDs come from Vivaldi's workspace store, rather than inferring scope from an active tab. That distinction matters with pinned tabs and empty workspaces. On the verified build, the store is the shape-checked webpack module `61685`; the launcher refuses other browser versions.

The scope is `workspace:<native ID>`, or `home:<persistent window UUID>` for the default/home view. A tab-placement key combines that scope with its existing `vivExtData.ext_id`. Native transient `tab.id` values are used only for live API operations. No tab URLs/titles or browser content are persisted.

Folder data uses `arc-folders.workspace-prototype.v1`. The old `arc-folders.state.v1` remains untouched. No speculative migration is performed because old window-wide folders contain no workspace mapping. Trial and normal profiles do not share this storage.

## Native ownership

Vivaldi/React retains ownership of its actual tab elements. The projection adds only folder headers and scoped position/indent variables. It does not rebuild a parallel tab list or replace the native strip's children. Resting tab rows use folder-layout coordinates; while an internal native drag is held, the same dragged nodes follow the cursor delta from their original grab point (including scroll offset), rather than being frozen by the resting transform. Other rows/folder headers stay in place. Release, cancellation, scope changes and teardown remove the temporary drag transform; native OS drag mode retains its own preview path. Native stacks or unknown row structures cause the projection to pause and restore original tab styling.

Folder headers are keyed by stable folder ID rather than rebuilt on every refresh. Inline naming uses a provisional row and a retained input element: the draft, selection, caret and composition state survive native tab events and refreshes without writing each keystroke. Enter during IME composition does not submit. Native window deactivation is not treated as a completed edit; an actual click outside the input finishes naming even when Vivaldi prevents the default DOM blur. Save failures keep the editable draft and leave persisted folder state unchanged. Workspace changes cancel unfinished drafts, and Escape restores focus to the prior folder/control.

Folder tabs use Vivaldi's real discard operation for first close and native removal for an already-unloaded entry. Discard replaces the transient ID; the persistent UUID and folder assignment survive. The prototype listens for replacement events and resolves later closes against the persistent entry. Unloading an active tab uses the native next-on-close selector, or opens one unfiled Start Page if necessary. Native rows are not cloned; gesture gates also cover callbacks captured before injection. Reopening uses native tab activation/reloading. See [lifecycle implementation and checks](folder-tab-lifecycle.md).

Menu integration extends the native `contextMenu.show` request and listens for its native action IDs. A right-click on a folder uses that same native popup API. Command context is bound to a window and workspace; stale menu/dialog actions cannot write into a different workspace.

Native dragging is not HTML dragging on the tab title. The bridge handles both the native internal-drag controller and OS/native `vivaldi/x-tab-entries` drops. Serialized drops must match the complete native schema, name the current source window, and contain unique positive IDs belonging to ordinary tabs in the current workspace. The active ID must be one of those tabs. Unknown fields and oversized payloads are rejected; only a canonical native payload is forwarded. Stale destinations and synchronous native-handler failures reject the drop without throwing out of its DOM listener. Each selected tab batch uses one model transaction and storage write, so a failed save rolls the entire folder assignment back.

Vivaldi's own `droppedTabHandler` consumes accepted external/native drops so its drag session is marked handled instead of accidentally detaching a new window. Cross-window/workspace drops are not implemented by this prototype.

Both internal pointer motion and native OS drag-over update the same valid-target state. The `detached` source-controller mode denotes Vivaldi's OS drag path, not authorization for a foreign window: readable payloads still require the exact native schema/current source window. During protected-data hover, only the local controller's validated live selection can supply eligibility. A theme-accent border outline identifies one target without changing its normal fill, text color, shadow or count appearance; stale, pinned, foreign-workspace and invalid selections do not get an accepting highlight. Exit, cancellation, completion, workspace changes, target removal and teardown clear it. Unknown native layouts, including duplicate identities, pause the projection instead of throwing into the browser UI.

Teardown removes listeners, dialogs, folder nodes, and projection styles, and restores native methods only while the prototype still owns those methods. Repeated teardown is safe. Native hooks remain private, version-specific interfaces and can break after a browser update.

## Run and verify

```sh
npm run try                       # isolated native-workspace trial
npm run try:workspace -- --side=right
npm run check
npm run check:workspace
npm run test:workspace-browser
```

The browser suite runs in a separate `.local/workspace-qa-profile` (`tools/launch-workspace.mjs --qa-profile`), never in the interactive `.local/workspace-profile`. Its PID/log files are separate too. It uses a fresh synthetic window/workspace pair per run, removes those fixtures, and restores its temporary folder state and native API hooks after testing. Neither suite nor trial attaches to the normal browsing profile. Captures and logs stay under ignored `.local/` unless a reviewed synthetic screenshot is deliberately copied into documentation.

### Test evidence boundary

Real CDP pointer/keyboard input exercises tab-bar context-menu requests, inline naming, tab-title drag initiation, native tab activation/close, and folder interaction. Composition events and protected/internal drag-session snapshots are also simulated at the native boundary to test input preservation and hover eligibility; this is not a claim of full physical-IME or OS-drag validation. The suite intercepts platform popup selection and OS drag start, then dispatches the captured native command and tab-drop payload. A single-tab regression now covers native **+ → two page navigations with asynchronous title changes → folder drag → unload → remove**, not just creation and existing-tab controls separately. Navigation in that automated regression uses the real browser API and synthetic loopback pages; native close buttons are hovered before hit-testing. Native lifecycle callbacks are completed and restored during test cleanup.

Those checks do not constitute verification of physical-mouse OS drag completion or platform-menu selection. An additional local macOS native-event check, using already-granted event-posting access and fresh synthetic fixtures, compared the native browser against the prototype:

- Native **+** and **Command-T** each opened exactly one active, visible tab in the same workspace with matching native page, focus and insertion position. Eight comparisons covered native mode plus workspace root, expanded-folder and collapsed-folder contexts. New tabs remain unfiled until explicitly assigned.
- An actual native internal drag was held at three cursor positions, without intercepting drag start. Before the fix, the prototype tab moved **0 px** when the cursor moved **10 px**. After the fix, cursor deltas **10/45/80 px** produced tab deltas **9/45/80 px** (one-pixel coordinate rounding at the first point), and resting geometry was restored after release/cancel.

- A full **+ → native address-bar navigation → dynamic title update → held internal drag → native close** sequence passed in both a clean QA profile and the recovered original trial, including repeated modified cycles. The two synthetic pages were served over loopback; already-authorized native Return events were used because CDP Return failed in the unmodified baseline too.

A long-running interactive trial also reproduced missing new-tab rows and stale controls with the prototype disabled. Gracefully restarting only its verified trial PID restored the workflow without deleting the profile: folder storage was unchanged and original persistent tab identities were retained. Canceling an orphaned native rename alone did not repair it. The trigger for the stale native frontend has not been isolated; this recovery is not a confirmed product-code fix. Separate QA profiles keep automated fixture/API mutations away from the interactive trial.

The native-event probes and captured evidence remain under ignored `.local/`; they do not change app resources, normal profiles or macOS privacy settings. The standard browser suite retains a deterministic held-drag geometry regression. No native OS `startDrag` preview was triggered in the held-drag comparison, so this is evidence for internal drag-following—not a screen-recorded external OS drag image. Full OS drag completion and platform-menu selection still need a manual check in the disposable window before broader use. Process-restart behavior, native-stack combinations, large-tab performance, other Vivaldi versions, and persistent normal-profile installation remain unverified or unsupported.

## Legacy separation

`npm run try:legacy`, `tools/build.mjs`, `src/sidebar.*`, and `tools/install.py` remain the older window-wide sidebar path. The legacy installer does not install this prototype. Normal Vivaldi should remain unpatched while this design is evaluated.
