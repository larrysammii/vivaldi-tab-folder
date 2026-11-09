# Arc folder interactions: evidence and proposed changes

**Accessed:** 2026-11-09. **Task:** research the missing folder drop-target indicator and the prototype's modal naming flow. No product code was changed.

## Recommendation

Use a folder row that can be named/renamed **in place**, and show a distinct **valid drop-target highlight before release**. Keep closed folders closed when accepting a tab unless the user explicitly opens them. These are our proposed interaction choices, informed by the evidence below—not a claim that every detail has been observed in current Arc.

Arc's official text supports click-away saving, direct contextual folder actions, nesting and drag/drop. One historical macOS change explicitly stopped closed folders expanding when items are dragged into them. Apple's native-platform guidelines require continuous, destination-specific drag feedback. Exact current Arc highlight styling and the location of its naming field were not visually verified.

## Source-backed findings

| Primary source and release date | Direct evidence | What it establishes / does not establish |
| --- | --- | --- |
| [Arc for macOS 2024–2026 release notes](https://resources.arc.net/hc/en-us/articles/20498293324823-Arc-for-macOS-2024-2026-Release-Notes), January 25, 2024 | “Clicking outside of the text input field while renaming Folders will now save your new name.” | A folder-name text input and click-away save are documented. This text alone does not prove the field is inline in the row, describe initial creation, or prove a modal is absent. |
| [Arc for macOS 2022 release notes](https://resources.arc.net/hc/en-us/articles/20498417809815-Arc-for-macOS-2022-Release-Notes), October 14, 2022 | “Closed folders no longer expand when you drag items into them, making it easier to organize.” | Arc deliberately documented accepting dragged items without expanding a closed folder. This is historical evidence, not a runtime check of a current build. It does not specify a hover-expansion delay or exact drag highlight. |
| [Same macOS 2022 notes](https://resources.arc.net/hc/en-us/articles/20498417809815-Arc-for-macOS-2022-Release-Notes), November 17, 2022 | “Multi-selected Tabs can now be added to a New Folder in one click. Multi-select with CMD + Click, then Right-Click or hit CMD T … New Folder to Pin the selection to a New Folder.” | Contextual/Command Bar creation can operate directly on the current tab selection. The text does not show the subsequent naming UI. |
| [Arc for macOS 2023 release notes](https://resources.arc.net/hc/en-us/articles/20498377604887-Arc-for-macOS-2023-Release-Notes), September 28, 2023 | “Selecting tabs within a folder (shift click) then right clicking allows you to create a new, nested folder.” | Nested folder creation is documented as a contextual operation. No naming location, nesting depth or highlight rule is established. |
| [Apple HIG: Drag and drop — Providing feedback](https://developer.apple.com/design/human-interface-guidelines/drag-and-drop#Providing-feedback) | “provide clear and continuous feedback”; “highlight a containing view only when the destination can accept a dragged item”; remove feedback when content leaves; identify possible destinations “one at a time.” | Supports a clear, valid-only, transient destination highlight. This is native-platform guidance, **not proof of Arc's visual implementation**. |

### Other confirmed Arc text

[Arc for Windows 2023–2026 release notes](https://resources.arc.net/hc/en-us/articles/22513842649623-Arc-for-Windows-2023-2026-Release-Notes) document Command Bar **New Folder** actions on January 25, 2024, and fixes for dragging Pinned Folders/tabs on April 8, 2024. These confirm Windows feature support in that release history, not visual parity with macOS.

## Evidence limits

- Arc was not installed or launched. No personal browser profile was inspected.
- No Arc screenshot, GIF, or video frame was visually verified. A YouTube tutorial could not be extracted without additional access; it is not used as evidence.
- A guessed legacy official Folders help URL returned an actual “page doesn't exist” message despite the scraping request succeeding. It is not treated as a valid source.
- The official text does **not** establish current Arc initial-name placement, exact Enter/Escape behavior, target color, outline thickness, insertion-line behavior, animation or hover timing. No precise Arc spring-loading rule can be claimed from it.
- Release-note dates matter: a documented 2022/2024 behavior is not automatically proof that every current macOS/Windows build behaves identically.

## Prototype gaps at the research snapshot

These observations refer to commit `6e60ca8`, before the subsequent inline-naming/drop-feedback implementation. The current implementation and verification boundaries are documented in [workspace-prototype.md](workspace-prototype.md). They are separate from the Arc evidence:

1. **No drag-specific target state.** `src/workspace-folders.js:101` records pointer coordinates; `:102–113` identifies the destination when an internal drag finishes. `:115–118` handles native drag-over acceptance without setting a visible target state. `src/workspace-folders.css:8–13` has ordinary hover/focus styles only.
2. **Creation and rename always use a modal.** `src/workspace-folders.js:222–228` calls `showModal()`; `:233–238` routes folder creation/rename through that form. It is an HTML modal, not a separate OS window, but it still interrupts the tab-bar interaction.
3. **Inline drafts need lifecycle protection.** `src/workspace-folders.js:170–198` clears/recreates folder rows on refresh and pauses projection during dragging. Merely inserting an input would risk losing typed text, caret or focus to the next native event/timer.
4. **The passing suite misses these UX requirements.** `tools/workspace-smoke.mjs` exercises successful assignment and native drag events, but does not assert a destination highlight before dropping or an inline draft surviving refresh. Existing checks can pass while these two gaps remain.

## Proposed interaction contract — our design, not claimed Arc facts

### Create and rename in place

**Right-click tab bar → New Folder → a new row appears with its title selected for editing.** No modal, separate toolbar or extra panel. New Subfolder uses the same interaction at the appropriate nesting depth. Rename edits the existing row rather than opening another UI surface.

- Use a provisional default such as `Untitled`; focus/select the title so typing replaces it immediately.
- **Enter:** commit a nonempty trimmed name. **Click away:** commit the typed name, or retain the default if a new row was left empty.
- **Escape:** cancel an uncommitted new row; when renaming, restore its previous title. Never close or move tabs as a side effect of cancelling naming.
- Preserve draft text, caret, focus and IME composition across refreshes. Bind the draft to a specific folder ID and workspace. Workspace changes or teardown cancel the edit safely rather than writing into the new workspace.

These exact default-name and keyboard rules are proposed product choices. Only click-away saving is directly supported by the quoted Arc rename note.

### Make dropping visibly predictable

- A valid folder destination gets a **distinct theme-accent border outline only**, following the user's subsequent visual refinement. Its fill, text and count appearance remain unchanged. The outline must differ from ordinary mouse hover and keyboard focus. Use Vivaldi theme tokens, not an unrelated plugin palette.
- Show the state **while hovering, before release**, for both native internal dragging and native OS `dragover`. One destination is active at a time. Invalid selections must not show an accepting state.
- Clear it on leaving/changing targets, cancellation, failed/successful completion, workspace switch, destination removal and teardown.
- Keep a closed folder closed after accepting the drop; update its contents/count so completion remains apparent. Do not add automatic expansion as an assumed Arc feature. Any future spring-loading behavior needs a separate product decision.
- Retain the existing context-menu move alternative and native tab ownership. No drag handles or replacement tab list.

## Acceptance checks before implementation is considered complete

1. A native tab held over a valid folder visibly highlights it **before release**; moving between nested targets switches the highlight without stale states.
2. Invalid targets never advertise acceptance. Leaving, Escape, workspace changes, deletion and teardown clear all feedback.
3. Create/rename show an inline input with no open naming dialog. Enter, blur, Escape, IME composition and storage failure have explicit, tested outcomes.
4. Native events and the normal refresh timer cannot erase a draft, move its caret, steal its focus or save it into another workspace.
5. Both native drag paths, both vertical sides, private exclusion, native activation/close and atomic multi-tab safety retain their existing checks. OS drag/menu automation limits remain explicitly documented.

## Retained source files

Fetched text is under ignored `.firecrawl/`: `arc-macos-2024-2026-release-notes.md`, `arc-macos-2022-release-notes.md`, `arc-macos-release-notes.md`, `arc-windows-release-notes.md`, and `apple-hig-drag-and-drop.md`. Public source URLs above are the durable citations; local line references describe the source snapshot reviewed for this research task.
