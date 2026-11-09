# Folder-tab lifecycle

Status: implemented locally for the isolated, version-checked prototype; user-confirmed interaction contract.

## Goal

Provide two-stage close behaviour for tabs inside folders, rather than spending effort stabilising the previous prototype's unwanted close behaviour.

Terms are defined in [the glossary](../GLOSSARY.md). The feature uses real native tabs and Vivaldi's unload/discard operation, not a parallel list of saved links.

## State transitions

| Tab and action | Result |
| --- | --- |
| Loaded folder tab: close | Unload the page; retain its entry in the same folder. |
| Unloaded folder tab: close | Remove the tab and its folder entry. |
| Unloaded folder tab: open | Load its page again; subsequent close unloads it again. |
| Unfiled tab: close | Ordinary Vivaldi close behaviour. |

The rule depends on current loaded/unloaded state, not a click count or double-click timing. A folder tab already unloaded automatically is removed by its next close action.

## Interaction scope

- Individual-tab close actions follow the same rule: the native close button, Command-W, middle-click and the individual Close Tab command.
- Unloading the active tab selects the next tab using Vivaldi's normal close-focus behaviour.
- If there is no other tab, show a Start Page while retaining the unloaded folder entry.
- Unfiled tabs, window closing and application quitting retain normal behaviour. Bulk close commands are unchanged; this contract applies to individual-tab close actions.
- Pinned tabs, native stacks, private contexts and unsupported layouts remain excluded by the prototype's existing safety boundary.

## Acceptance scenarios

1. Close a loaded folder tab: its page unloads, but the same entry remains in its folder.
2. Close that unloaded entry: it is removed.
3. Open an unloaded entry: it reloads without creating a duplicate; closing it unloads it again.
4. Close an automatically unloaded folder tab: it is removed immediately.
5. Exercise each individual close action on folder and unfiled tabs, including the active/last-tab case; retain native behaviour outside folders.

## Implementation and verification

Vivaldi 8.3.4191.26 replaces a tab's temporary ID when discarding it. Its persistent `vivExtData.ext_id`, folder placement and native entry survive. Close operations are serialized by persistent entry; the next close resolves the current native ID instead of acting on a removed ID. Opening an unloaded native entry reloads it normally.

The bridge wraps native individual close actions. Native rows can retain pre-hook callbacks, so capture-phase handlers gate their close-button/middle-click gestures without replacing the rows. Native menu/keyboard commands use the native actions. Teardown restores only owned wrappers and removes listeners. Failed unloads report an error rather than fall through to removal; stale/moved targets cancel queued work.

Checks:

```sh
npm run test:workspace-close         # disposable QA profile: seven lifecycle checks
npm run test:workspace-close-native  # also real macOS Command-W; existing event/AX access required
npm run test:workspace-browser       # existing UI suite plus lifecycle checks
```

The real-key helper verifies the QA PID, its exact profile argument, the fixture window and existing permissions before posting a key. It does not request privacy permission or target normal profiles. Context-menu automation captures the native request and dispatches its real command with the native action schema; it does not select a platform popup physically.

Verification covers **named native workspaces**. A separate `--home` diagnostic in the long-lived QA session stalled because the native model gained a tab while the Home/default tab bar did not render it. A no-prototype control reproduced that native-model/DOM mismatch too. Home-view lifecycle behaviour is therefore not verified; use a named workspace for the current trial. This observation does not establish the trigger or a repair.

General restart/session recovery, bulk-unload semantics, browser versions beyond the pinned build, and persistent normal-profile installation are outside this feature's verification scope.
