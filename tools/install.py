#!/usr/bin/env python3
"""Plan, install or undo a version-checked UI hook. Never re-signs apps."""
import argparse
import hashlib
import json
from pathlib import Path
import plistlib
import subprocess
import sys

VERSION = '8.3.4191.26'
HOOK = b'    <script src="arc-folders.js"></script>\n'
MOD = 'arc-folders.js'
BACKUP = 'main.html.arc-folders.original'
MANIFEST = 'arc-folders.install.json'


def digest(data):
    return hashlib.sha256(data).hexdigest()


def ui_root(app):
    app = app.expanduser().resolve(strict=True)
    with (app / 'Contents/Info.plist').open('rb') as file:
        info = plistlib.load(file)
    if info.get('CFBundleIdentifier') != 'com.vivaldi.Vivaldi':
        raise ValueError('Not the verified Vivaldi app identifier; refusing to patch')
    version = info.get('CFBundleShortVersionString')
    if version != VERSION:
        raise ValueError(f'Untested version {version!r}; this installer supports only {VERSION}')
    root = app / f'Contents/Frameworks/Vivaldi Framework.framework/Versions/{version}/Resources/vivaldi'
    root = root.resolve(strict=True)
    if not root.is_relative_to(app):
        raise ValueError('UI resources resolve outside the selected app')
    if not (root / 'main.html').is_file():
        raise ValueError('Verified main.html hook not found')
    return app, root


def patched_html(original):
    if b'arc-folders.js' in original:
        raise ValueError('A folder hook already exists; refusing to duplicate it')
    if original.count(b'</body>') != 1:
        raise ValueError('Unexpected HTML layout; expected exactly one closing body')
    if b'background-common-bundle.js' not in original or b'bundle.js' not in original:
        raise ValueError('Unexpected Vivaldi bootstrap; refusing to patch')
    return original.replace(b'</body>', HOOK + b'</body>')


def atomic_write(path, data):
    temporary = path.with_name(path.name + '.arc-folders-tmp')
    if temporary.exists() or temporary.is_symlink():
        raise ValueError(f'Temporary path already exists: {temporary}')
    with temporary.open('xb') as file:
        file.write(data)
    temporary.replace(path)


def verify_regular_files(root):
    for name in ['main.html', MOD, BACKUP, MANIFEST]:
        file = root / name
        if file.is_symlink() or (file.exists() and not file.is_file()):
            raise ValueError(f'Refusing unexpected or symlinked patch file: {file}')


def plan(root, source):
    verify_regular_files(root)
    if (root / MANIFEST).exists():
        return {'status': 'already-installed', 'hook': str(root / 'main.html'), 'backup': str(root / BACKUP)}
    for name in [MOD, BACKUP]:
        if (root / name).exists():
            raise ValueError(f'Existing unowned file would be overwritten: {root / name}')
    original = (root / 'main.html').read_bytes()
    patched_html(original)
    mod = source.read_bytes()
    return {'status': 'ready', 'hook': str(root / 'main.html'), 'backup': str(root / BACKUP),
            'mod': str(root / MOD), 'original_sha256': digest(original), 'mod_sha256': digest(mod),
            'warning': 'Modifies signed app resources; invalidates vendor resource seal. No signing or security settings will be changed.'}


def install(root, source):
    report = plan(root, source)
    if report['status'] == 'already-installed':
        raise ValueError('Already installed. Uninstall first; existing backups are never overwritten.')
    original = (root / 'main.html').read_bytes()
    mod = source.read_bytes()
    patched = patched_html(original)
    manifest = {'version': VERSION, 'original_sha256': digest(original), 'patched_sha256': digest(patched), 'mod_sha256': digest(mod)}
    # Keep the hook untouched until backup, mod and ownership manifest all exist.
    with (root / BACKUP).open('xb') as file:
        file.write(original)
    with (root / MOD).open('xb') as file:
        file.write(mod)
    with (root / MANIFEST).open('x') as file:
        json.dump(manifest, file, indent=2)
    atomic_write(root / 'main.html', patched)
    return {**report, 'status': 'installed'}


def uninstall(root):
    verify_regular_files(root)
    manifest = json.loads((root / MANIFEST).read_text())
    original = (root / BACKUP).read_bytes()
    if digest(original) != manifest['original_sha256']:
        raise ValueError('Backup has changed; refusing restoration')
    if digest((root / 'main.html').read_bytes()) != manifest['patched_sha256']:
        raise ValueError('HTML changed after installation; refusing to overwrite newer edits')
    if digest((root / MOD).read_bytes()) != manifest['mod_sha256']:
        raise ValueError('Mod changed after installation; refusing to remove newer edits')
    atomic_write(root / 'main.html', original)
    for name in [MOD, MANIFEST, BACKUP]:
        (root / name).unlink()
    return {'status': 'restored', 'hook': str(root / 'main.html'), 'sha256': digest(original)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['plan', 'install', 'uninstall'])
    parser.add_argument('--app', required=True, type=Path, help='Explicit Vivaldi .app path; use a disposable copy first')
    parser.add_argument('--acknowledge-signature-change', action='store_true', help='Required for writes; no automatic signing')
    args = parser.parse_args()
    app, root = ui_root(args.app)
    if args.action != 'plan' and not args.acknowledge_signature_change:
        parser.error('Writes require --acknowledge-signature-change and prior user approval. Run plan first.')
    if args.action != 'plan':
        executable = str(app / 'Contents/MacOS/Vivaldi')
        processes = subprocess.run(['/bin/ps', '-axo', 'command='], check=True, capture_output=True, text=True).stdout.splitlines()
        if any(line.strip() == executable or line.strip().startswith(executable + ' ') for line in processes):
            raise ValueError('Selected app is running. Quit that copy before changing its resources.')
    source = Path(__file__).resolve().parent.parent / 'dist' / MOD
    if args.action == 'plan':
        result = plan(root, source)
    elif args.action == 'install':
        result = install(root, source)
    else:
        result = uninstall(root)
    print(json.dumps({'app': str(app), **result}, indent=2))


if __name__ == '__main__':
    try:
        main()
    except (ValueError, OSError, KeyError, json.JSONDecodeError, plistlib.InvalidFileException) as error:
        print(f'Stopped: {error}. If a write had started, inspect the backup and manifest before retrying.', file=sys.stderr)
        sys.exit(1)
