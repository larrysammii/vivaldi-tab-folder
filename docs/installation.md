# Legacy installation and rollback

> **This installer is for the old window-wide standalone sidebar only.** It does not install the [workspace-native prototype](workspace-prototype.md). Use `npm run try` for that isolated, in-memory prototype; keep the normal app unpatched.
>
> The trial commands in this legacy guide use `npm run try:legacy` and `.local/test-profile`. The new default trial instead uses `.local/workspace-profile`.

## Choose the correct mode

| Mode | Load command | Changes app files? | Survives normal app relaunch? |
| --- | --- | --- | --- |
| Isolated legacy trial | `npm run try:legacy` | No | **No.** Run the command again; only folder data is retained in the test profile |
| Persistent UI hook | Explicit installer command below | **Yes** | Intended to load on startup until an update replaces the hook; signed-app launch compatibility is not yet verified |

The trial uses `.local/test-profile`. Your regular Vivaldi uses its own profile. Folder data does not move between them automatically.

## Compatibility and risks

This installer accepts **Vivaldi 8.3.4191.26 on macOS** with the verified UI resource layout. Node.js 22+ builds the mod; Python 3.9+ runs the installer. The trial launcher expects `/Applications/Vivaldi.app`.

**Persistent JavaScript UI modification is an unsupported app-resource patch.** Changing files inside `Vivaldi Framework.framework` invalidates Vivaldi's vendor signature/resource seal. macOS can refuse to launch the modified app. Successful in-memory tests do not prove a patched app will launch.

The installer does not re-sign code, remove quarantine, disable Gatekeeper, edit your browsing profile, or patch the executable. If macOS blocks the app, **undo the patch or restore the pristine backup**, rather than disabling security protections.

Start with a disposable app copy and a fresh profile if possible. Do not use the trial profile for passwords, Sync, or sensitive browsing.

## 1. Get and check the source

```sh
git clone https://github.com/larrysammii/vivaldi-tab-folder.git
cd vivaldi-tab-folder
npm run check
```

No `npm install` or `pip install` is required. `npm run check` builds `dist/arc-folders.js` as well as running the automated checks.

If you already cloned the project, use your existing checkout. Review changes before updating any installed mod.

## 2. Run the read-only plan

```sh
python3 tools/install.py plan --app /Applications/Vivaldi.app
```

The plan shows the target HTML, backup path, mod path, and hashes. It does not write to the app. **An untested version or unexpected layout is a stop condition**, not a reason to remove the version check.

For a disposable app copy, replace the explicit `--app` path in every plan/install/uninstall command. Merely copying the app does not isolate its browsing profile; launching it with your normal profile is a separate action. The trial command remains the safest first test.

## 3. Quit Vivaldi and make a pristine backup

Save important work and quit **all instances of the selected Vivaldi app with ⌘Q**, including the isolated trial. The installer refuses to patch a running executable; closing only a window is not enough. It never terminates your browser for you.

A full backup is recommended before changing your normal app. This copies the app only, not your browsing profile:

```sh
backup="$HOME/vivaldi-tab-folder-backups/Vivaldi-8.3.4191.26-$(date +%Y%m%d-%H%M%S).app"
mkdir -p "$(dirname "$backup")"
ditto "/Applications/Vivaldi.app" "$backup"
printf 'Pristine app backup: %s\n' "$backup"
```

Keep that path. The installer also backs up `main.html` internally, but that small backup is not a substitute for an untouched app copy if an app update or external tool changes the bundle.

## 4. Install the startup hook

**Run this only after accepting the signing risk above.** This command changes the selected app:

```sh
python3 tools/install.py install \
  --app /Applications/Vivaldi.app \
  --acknowledge-signature-change
```

The installer writes three owned files into this version's UI resources:

- `arc-folders.js`: the built model, styles, and controller.
- `main.html.arc-folders.original`: the exact original HTML.
- `arc-folders.install.json`: hashes used for ownership and safe rollback.

It then adds one `<script src="arc-folders.js"></script>` hook to `main.html`. It refuses duplicate installation, unknown versions, symlinked patch files, and unowned file collisions.

Permission denied is a stop condition. Do not change the whole app's permissions or casually rerun arbitrary scripts as root; use a user-owned disposable app copy or resolve ownership deliberately. A filesystem failure can leave staged backup/mod/manifest files even if the hook was not written. Inspect the reported paths and preserve the pristine backup before retrying; the multi-file operation is not a full app-bundle transaction.

## 5. Verify normal startup

```sh
open -a /Applications/Vivaldi.app
```

Check for **Folders** in the left sidebar. Create a test folder, quit, and reopen Vivaldi **without** running the trial launcher. Only that verifies persistent loading on your machine. Create folder data afresh in the normal profile; trial folders belong to the separate profile.

If the app will not launch, use rollback below. No successful permanent-install launch is claimed by this repository's current test evidence.

## Undo the patch

Quit all instances of the selected app, then from the checkout run:

```sh
python3 tools/install.py uninstall \
  --app /Applications/Vivaldi.app \
  --acknowledge-signature-change
```

Uninstall checks the backup and installed hashes, restores the exact original HTML, and removes only its owned mod/manifest/backup files. It leaves folder data in that profile, so uninstall does not silently erase organization.

If the app was otherwise untouched, restoring those bytes removes this patch's signature changes. Other bundle modifications or updates can still affect verification. You can check without changing anything:

```sh
codesign --verify --deep --strict /Applications/Vivaldi.app
```

If uninstall refuses because files or the app version changed, **do not overwrite newer edits**. Restore your full pristine app backup or reinstall a trusted Vivaldi download. Preserve the profile separately; the installer does not manage profile backups.

## Updates and troubleshooting

| Symptom | Meaning / next action |
| --- | --- |
| Legacy sidebar disappeared after quitting a trial | Expected: run `npm run try:legacy` again, or deliberately choose the legacy persistent hook |
| Trial folder data missing in normal Vivaldi | Different profiles; no automatic migration is implemented |
| Installer reports app running | Quit every instance of that app, not just the active window |
| Installer reports untested version | Stop; compatibility must be checked before supporting a new version |
| macOS refuses to launch modified app | Undo the patch or restore the pristine app; do not disable protections |

Vivaldi updates can replace the hook or change internal APIs. Do not assume the mod remains installed or compatible after an update. Keep the source and pristine backup outside the application bundle. Report only sanitized symptoms and versions; never attach a browsing profile or raw debugging log.
