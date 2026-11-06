import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createHash } from 'node:crypto';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const model = await readFile(resolve(root, 'src/model.js'), 'utf8');
const sidebar = await readFile(resolve(root, 'src/sidebar.js'), 'utf8');
const css = await readFile(resolve(root, 'src/sidebar.css'), 'utf8');
const output = `// Vivaldi Tab Folders — local-only UI mod, no third-party code.\n${model}\n;globalThis.ArcFoldersCSS=${JSON.stringify(css)};\n${sidebar}\n`;
await mkdir(resolve(root, 'dist'), { recursive: true });
await writeFile(resolve(root, 'dist/arc-folders.js'), output);
console.log(`Built dist/arc-folders.js (${Buffer.byteLength(output)} bytes, SHA-256 ${createHash('sha256').update(output).digest('hex')})`);
