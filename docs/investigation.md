# Investigation and verification boundaries

## Target

The inspected local artifact was **Vivaldi 8.3.4191.26 on macOS**, installed at `/Applications/Vivaldi.app`. Its UI resources are under:

```
Contents/Frameworks/Vivaldi Framework.framework/Versions/8.3.4191.26/Resources/vivaldi
```

No Vivaldi binary, JavaScript bundle, browsing profile, or full analysis export is included in this repository. The mod's source and synthetic screenshot are separate from the inspected application.

## Findings and evidence types

| Question | Finding | Evidence type / boundary |
| --- | --- | --- |
| Can the UI be extended without rebuilding Chromium? | Yes, for this build | Shipped HTML/JS inspection plus successful in-memory loading into a real isolated browser |
| Can live tabs be organized into nested folders? | Yes | Pure model tests and real UI/pointer/keyboard checks |
| Can saved assignments survive process restart? | Yes, when Vivaldi restores the existing persistent identities | Local storage plus actual isolated process close/relaunch |
| Are normal/private windows separated? | Yes, in the tested build | Two normal windows have separate trees; private-main initialization mounts no sidebar |
| Does a permanently modified signed app launch normally? | **Not verified** | Installer file operations are unit-tested, but in-memory loading is not a signed-app launch test |

## Static inspection

The shipped `main.html` loads `background-common-bundle.js` and `bundle.js`. Rendered `window.html` starts with stylesheet links and an empty body. Bounded source inspection found:

- `background-common-bundle.js` module 86671 exports `self.chrome`; module 46477 exports `self.vivaldi`.
- The UI uses `chrome.extension.getViews()` to find portal/window contexts, native tab/window APIs, and `vivExtData.ext_id` metadata.

These are static syntax observations, not proof that an API is available in every context or release.

REA retained an application inventory/graph under Evidence ID `ev_20164e5c9c4664051966aa2050b0b86c174184fd32a3fadaec7bd0eead1b4854`. Root artifact digest: `040eba5ebd974f4d15532aae34cabf6652b5b1df450a612040c83495b360a4df`.

**Semantic coverage was partial.** The analyzer parsed 21 JavaScript files but `bundle.js` exhausted a 2048 MiB analyzer heap; recovered scopes reported 58 parse failures. This does not establish a malformed app or complete behavioral coverage. The local retained export is not published, so these IDs are provenance notes, not downloadable public evidence.

For matching the inspected files:

| File | SHA-256 |
| --- | --- |
| `bundle.js` | `453c1d7f02a27265e28ecec2ac0df214a9e4ffb7a450054ed571bc06f0e5e2fe` |
| `main.html` | `a1599ea644c7bc610a9fda2c01e11e9ace5220bcf86c9d93f1a555ef22c9c536` |

## Runtime verification

The unmodified installed executable was launched with an explicit project-owned `.local/test-profile`, loopback debugging, and synthetic local pages. No normal browsing profile was inspected or copied. Direct CDP probes and tests—not REA passive runtime capture—confirmed:

- The normal shared main context exposes tab/window APIs, local extension storage, and extension views.
- Rendered windows expose `vivaldiWindowId`; `#main > .inner` is a working sidebar insertion point.
- Existing `vivExtData.ext_id` UUIDs for the window and tab survived an actual isolated process restart, retaining folder assignments.
- Private browsing has a distinct `main.html` context. Creating an incognito window can return null to the normal context despite succeeding, so QA explicitly selects contexts instead of taking the first matching URL.

Local probe output, screenshots, and logs are intentionally ignored. The tests are in the public source so compatible local setups can reproduce the checks without downloading private artifacts.

## Loading decision

The controller lives once in the shared main context and discovers window views. Independently loading a full controller into every `window.html` would create multiple state writers. Generic Vivaldi forum guidance describes window-level hooks; this shared-main approach is an implementation choice supported by the inspected/runtime behavior of this build.

The persistent installer adds a `main.html` script reference. That file operation is tested against synthetic bundles, but **normal startup of a permanently patched signed app remains unverified**. See [installation](installation.md) for signing, backup, update, and rollback constraints, and [loading references](loading-research.md) for primary sources.

## Reproduce the checks

```sh
npm run check
npm run try
npm run test:vivaldi
npm run test:lifecycle
```

Pure tests cover model invariants and installer ownership/rollback. Real-browser checks cover nested creation, live tab moves, collapse, pointer drag, first-use loose-tab reorder, keyboard focus and restoration, reload without duplicate mounts, separate/private windows, and process restart. The lifecycle command restarts only the disposable test process.

These observations do not establish compatibility with other builds/platforms, Sync, workspace-specific folders, saved closed links, Arc archiving, or extreme-scale performance. No native executable was patched, and the original app resources were unchanged during the in-memory verification.
