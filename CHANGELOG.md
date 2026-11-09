# Changelog

## Unreleased — workspace-native prototype

- Make the isolated workspace-native prototype the default trial; retain the old sidebar under `npm run try:legacy`.
- Put nested folder headers inside native vertical tabs, with independent workspace trees and no standalone panel, toolbar, or custom tab drag handles.
- Add native right-click folder actions with inline naming/rename, protected drafts and Enter/click-away/Escape controls; keep modal naming out of the tab bar.
- Show one border-only valid drop target before release, keep closed folders closed, and let dragged native tab rows follow the held cursor instead of freezing at their folder-layout positions.
- Preserve old sidebar storage, exclude private contexts, restore native methods on teardown, and leave installed app resources untouched.
- Add deterministic workspace/native-bridge tests and isolated browser checks; document that OS popup selection and drag entry are intercepted in automation and persistent prototype installation is unsupported.
- Run automated UI checks in a separate QA profile, leaving the interactive trial alone; cover native new-tab creation, two navigations with live title updates, folder dragging and native close on the same tab.
- Add folder-only, state-based close: loaded tabs unload but keep their entry; unloaded entries are removed by the next close. Reopening resets the cycle. Cover ×, middle-click, individual native close commands and real macOS Command-W; retain native unfiled/bulk/window behaviour, close-focus selection and a last-tab Start Page. Track persistent identities across Vivaldi's discard-time ID replacement.

## 0.1.0 — initial experimental source release

- Add a nested-folder sidebar for Vivaldi 8.3.4191.26 on macOS.
- Support drag-and-drop, move menus, keyboard navigation, and local organization by persistent native IDs.
- Add isolated in-memory trial loading, real-browser smoke/lifecycle tests, and a version-checked startup-hook installer with rollback.
- Document that permanent signed-app startup is not yet verified and that application updates can replace the hook.

No Vivaldi binaries, bundled application code, browsing profiles, or local evidence artifacts are distributed.
