import { mkdir, open, readFile, writeFile, realpath } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { targets, connect } from './cdp.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);
const profile = resolve(root, '.local/test-profile');
await mkdir(profile, { recursive: true });
if (relative(root, await realpath(profile)).startsWith('..')) throw new Error('Test profile resolves outside this project');
const source = await readFile(resolve(root, 'dist/arc-folders.js'), 'utf8');
let running = false;
try { running = (await targets()).some(t => t.url.endsWith('/main.html')); } catch {}
if (!running) {
  const log = await open(resolve(root, '.local/vivaldi-test.log'), 'a');
  const child = spawn('/Applications/Vivaldi.app/Contents/MacOS/Vivaldi', [
    `--user-data-dir=${profile}`, '--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1',
    '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-component-update',
    '--debug-packed-apps', 'about:blank',
  ], { detached: true, stdio: ['ignore', log.fd, log.fd] });
  await new Promise((accept, reject) => { child.once('spawn', accept); child.once('error', reject); });
  await writeFile(resolve(root, '.local/vivaldi-test.pid'), String(child.pid));
  child.unref(); await log.close();
  for (let attempt = 0; attempt < 300; attempt++) {
    try { if ((await targets()).some(t => t.url.endsWith('/main.html'))) { running = true; break; } } catch {}
    await new Promise(accept => setTimeout(accept, 100));
  }
  if (!running) throw new Error('Vivaldi did not expose its isolated UI within 30 seconds; see .local/vivaldi-test.log');
}
const cdp = await connect();
try {
  await cdp.evaluate(source);
  await cdp.evaluate('ArcFolders.ready.then(()=>true)');
  let mounted = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await cdp.evaluate('ArcFolders.windowCount>0')) { mounted = true; break; }
    await new Promise(accept => setTimeout(accept, 80));
  }
  if (!mounted) throw new Error('UI script loaded, but the browser sidebar did not mount');
  console.log(`Isolated Vivaldi test window ready. Profile: ${profile}`);
  console.log('Use the + beside Folders to create a folder. Your normal profile and app files are unchanged.');
} finally { cdp.close(); }
