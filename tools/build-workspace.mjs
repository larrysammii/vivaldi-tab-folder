import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createHash } from 'node:crypto';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = name => readFile(resolve(root, 'src', name), 'utf8');
const [model, layout, native, controller, css] = await Promise.all([
  read('model.js'), read('workspace-layout.js'), read('workspace-native.js'), read('workspace-folders.js'), read('workspace-folders.css'),
]);
const output = `// ISOLATED WORKSPACE PROTOTYPE — not a persistent-install payload.\n${model}\n${layout}\n${native}\n;globalThis.ArcWorkspaceFoldersCSS=${JSON.stringify(css)};\n${controller}\n`;
await mkdir(resolve(root, '.local'), { recursive: true });
await writeFile(resolve(root, '.local/workspace-folders.js'), output);
console.log(`Built .local/workspace-folders.js (${Buffer.byteLength(output)} bytes, SHA-256 ${createHash('sha256').update(output).digest('hex')})`);
