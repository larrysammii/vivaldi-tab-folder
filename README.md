# Vivaldi Tab Folder

**Workspace-scoped, nested folders inside Vivaldi's native vertical tab bar.** Right-click the tab bar to create a folder, then drag native tabs into it. No separate Folders panel, extra toolbar, or drag handles.

> **Experimental macOS prototype, not an official Vivaldi feature.** Target: **Vivaldi 8.3.4191.26**. The default trial loads in memory in a dedicated disposable profile. It does **not** patch the installed app or use your normal browsing profile. Persistent installation of this workspace prototype is not provided.

## Try it safely

Requires macOS, Vivaldi at `/Applications/Vivaldi.app`, Node.js **22+**, npm, and Python **3.9+**. No npm or Python dependencies need installing.

1. Get the source:

   ```sh
   git clone https://github.com/larrysammii/vivaldi-tab-folder.git
   cd vivaldi-tab-folder
   ```

2. Open the isolated prototype:

   ```sh
   npm run try
   ```

3. Choose or create a workspace using Vivaldi's normal workspace switcher.
4. **Right-click anywhere in the vertical tab bar → New Folder.** Right-click a folder for **New Subfolder**, rename, move, or removal.
5. Drag an actual native tab onto a folder. Switching workspaces switches folder trees. Click a folder to collapse it.

The launcher selects left-side tabs **only in `.local/workspace-profile`**. For the right side:

```sh
npm run try:workspace -- --side=right
```

The app files and normal profile stay unchanged. Loopback debugging is enabled for the isolated process only. **Do not sign in, enable Sync, or use this disposable profile for sensitive browsing.** Quitting the test browser unloads the prototype; run the command again to reload it. Folder state stays in the isolated profile.

## What the prototype does

- Keeps the existing native tab rows, activation, and close buttons; adds folder headers to the same strip.
- Gives each workspace an independent tree. The default/home view is scoped by persistent window identity.
- Adds folder actions to native context menus. **Move to Folder** in the context menu is a non-drag alternative.
- Saves hierarchy and placements locally under a separate prototype storage key. No URLs, page contents, or tab titles are copied into folder state.
- Excludes private contexts and horizontal tab bars; unexpected native layouts fall back to the unchanged native list.

Keyboard: folder buttons support **← / →** to collapse/expand, **↑ / ↓ / Home / End** navigation, **F2** to rename, and standard dialog **Tab / Escape** behavior. Native tab keyboard behavior remains owned by Vivaldi.

![Workspace folders integrated into an isolated native vertical tab bar with synthetic test data](docs/images/workspace-native.png)

## Verification and boundaries

```sh
npm run check                   # all pure/installer tests and both builds
npm run check:workspace         # workspace/native-bridge tests and prototype build
npm run test:workspace-browser  # isolated native-UI checks
```

The browser checks exercise real right-click, pointer, and keyboard events; native menu requests; workspace switching; nested collapse; native tab activation/close; private exclusion; both vertical sides; fallback; reinjection; and cleanup. They verify the installed app's vendor signature remains valid.

**Automation intercepts platform-menu selection and OS drag start.** It then routes the actual native menu command and serialized tab-drop payload through the prototype and Vivaldi's drop consumer. This avoids an OS drag loop that CDP cannot reliably control. It is not a claim of full physical-mouse/platform-menu verification, process-restart persistence, performance at large tab counts, or production readiness.

Native stacks and other complex tab layouts are not fully supported; unknown rows pause the projection rather than being replaced. Other Vivaldi versions/platforms, browser Sync, archives/saved closed links, and automatic migration from the old sidebar are not implemented. See [prototype details](docs/workspace-prototype.md).

## Legacy sidebar and installer

The earlier **window-wide standalone sidebar** is retained for reference and regression checks:

```sh
npm run try:legacy
```

It uses `.local/test-profile` and different storage. `tools/install.py` and the [legacy installation/rollback guide](docs/installation.md) apply **only to that older sidebar**, not this workspace prototype. Do not use that installer expecting workspace-native folders. Changing signed app resources can prevent Vivaldi launching; the prototype deliberately avoids those changes.

Legacy documentation: [architecture](docs/architecture.md), [investigation](docs/investigation.md), [loading research](docs/loading-research.md).

## License and affiliation

The mod source is [MIT licensed](LICENSE). No Vivaldi/Arc application code, binaries, browsing profiles, or reverse-engineering evidence bundles are distributed. Screenshots use synthetic local data. The mod has no analytics, server, remote fonts, or remote assets.

Independent of Vivaldi Technologies and The Browser Company. Vivaldi and Arc names/marks belong to their owners. Contributions: [CONTRIBUTING.md](CONTRIBUTING.md). Security reports: [SECURITY.md](SECURITY.md).
