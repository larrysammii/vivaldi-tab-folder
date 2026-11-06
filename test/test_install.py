import importlib.util
from pathlib import Path
import plistlib
import tempfile
import unittest

SPEC = importlib.util.spec_from_file_location('folder_installer', Path(__file__).resolve().parent.parent / 'tools/install.py')
installer = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(installer)


class InstallerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name)
        self.app = self.base / 'Vivaldi Test.app'
        contents = self.app / 'Contents'
        contents.mkdir(parents=True)
        with (contents / 'Info.plist').open('wb') as file:
            plistlib.dump({'CFBundleIdentifier': 'com.vivaldi.Vivaldi', 'CFBundleShortVersionString': installer.VERSION}, file)
        self.root = contents / f'Frameworks/Vivaldi Framework.framework/Versions/{installer.VERSION}/Resources/vivaldi'
        self.root.mkdir(parents=True)
        self.original = b'<html><body><script src="background-common-bundle.js"></script><script src="bundle.js"></script></body></html>\n'
        (self.root / 'main.html').write_bytes(self.original)
        self.source = self.base / 'arc-folders.js'
        self.source.write_text('/* synthetic test mod */\n')

    def test_resolves_only_verified_app(self):
        app, root = installer.ui_root(self.app)
        self.assertEqual(app, self.app.resolve())
        self.assertEqual(root, self.root.resolve())

    def test_unknown_version_refused(self):
        with (self.app / 'Contents/Info.plist').open('wb') as file:
            plistlib.dump({'CFBundleIdentifier': 'com.vivaldi.Vivaldi', 'CFBundleShortVersionString': '99.0'}, file)
        with self.assertRaisesRegex(ValueError, 'Untested'):
            installer.ui_root(self.app)

    def test_plan_is_read_only(self):
        files = {p.name: p.read_bytes() for p in self.root.iterdir()}
        self.assertEqual(installer.plan(self.root, self.source)['status'], 'ready')
        self.assertEqual({p.name: p.read_bytes() for p in self.root.iterdir()}, files)

    def test_roundtrip_restores_exact_bytes(self):
        self.assertEqual(installer.install(self.root, self.source)['status'], 'installed')
        self.assertEqual((self.root / installer.BACKUP).read_bytes(), self.original)
        self.assertEqual((self.root / 'main.html').read_bytes().count(installer.HOOK), 1)
        self.assertEqual(installer.uninstall(self.root)['status'], 'restored')
        self.assertEqual((self.root / 'main.html').read_bytes(), self.original)
        self.assertEqual([p.name for p in self.root.iterdir()], ['main.html'])

    def test_double_install_does_not_overwrite_backup(self):
        installer.install(self.root, self.source)
        with self.assertRaisesRegex(ValueError, 'Already installed'):
            installer.install(self.root, self.source)
        self.assertEqual((self.root / installer.BACKUP).read_bytes(), self.original)

    def test_unowned_mod_is_not_overwritten(self):
        (self.root / installer.MOD).write_text('user code')
        with self.assertRaisesRegex(ValueError, 'unowned'):
            installer.install(self.root, self.source)
        self.assertEqual((self.root / installer.MOD).read_text(), 'user code')
        self.assertEqual((self.root / 'main.html').read_bytes(), self.original)

    def test_uninstall_protects_newer_html(self):
        installer.install(self.root, self.source)
        (self.root / 'main.html').write_bytes(b'newer user edits')
        with self.assertRaisesRegex(ValueError, 'HTML changed'):
            installer.uninstall(self.root)
        self.assertEqual((self.root / 'main.html').read_bytes(), b'newer user edits')

    def test_uninstall_protects_changed_mod(self):
        installer.install(self.root, self.source)
        (self.root / installer.MOD).write_text('newer mod')
        with self.assertRaisesRegex(ValueError, 'Mod changed'):
            installer.uninstall(self.root)
        self.assertTrue((self.root / installer.BACKUP).exists())

    def test_symlink_is_rejected(self):
        outside = self.base / 'outside.txt'
        outside.write_text('unrelated')
        (self.root / installer.MOD).symlink_to(outside)
        with self.assertRaisesRegex(ValueError, 'symlinked'):
            installer.install(self.root, self.source)
        self.assertEqual(outside.read_text(), 'unrelated')

    def test_unexpected_bootstrap_refused(self):
        with self.assertRaises(ValueError):
            installer.patched_html(b'<body>different browser</body>')
        with self.assertRaises(ValueError):
            installer.patched_html(self.original.replace(b'</body>', b'</body></body>'))


if __name__ == '__main__':
    unittest.main()
