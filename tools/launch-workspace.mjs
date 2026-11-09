// Dedicated, synthetic-profile prototype. Never patches the installed app.
import { mkdir, open, readFile, writeFile, realpath } from 'node:fs/promises';
import { spawn, execFileSync } from 'node:child_process';
import { resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { targets, connect } from './cdp.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);
const version = execFileSync('python3', ['-c', 'import plistlib; print(plistlib.load(open("/Applications/Vivaldi.app/Contents/Info.plist", "rb"))["CFBundleShortVersionString"])'], { encoding: 'utf8' }).trim();
if (version !== '8.3.4191.26') throw new Error(`Untested Vivaldi ${version}; workspace prototype supports only 8.3.4191.26`);
const side = process.argv.find(arg => arg.startsWith('--side='))?.split('=')[1] || 'left';
if (!['left', 'right'].includes(side)) throw new Error('Use --side=left or --side=right');
const probe = process.argv.includes('--probe');
const profileName = process.argv.includes('--qa-profile') ? 'workspace-qa-profile' : 'workspace-profile';
const processName = profileName === 'workspace-profile' ? 'vivaldi-workspace' : 'vivaldi-workspace-qa';
const profile = resolve(root, '.local', profileName);
await mkdir(profile, { recursive: true });
if (relative(root, await realpath(profile)).startsWith('..')) throw new Error('Prototype profile resolves outside this project');
let running = false;
try { running = (await targets(profileName)).some(t => t.url.endsWith('/main.html')); } catch {}
if (!running) {
  const log = await open(resolve(root, `.local/${processName}.log`), 'a');
  const child = spawn('/Applications/Vivaldi.app/Contents/MacOS/Vivaldi', [
    `--user-data-dir=${profile}`, '--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1',
    '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-component-update',
    '--debug-packed-apps', 'about:blank',
  ], { detached: true, stdio: ['ignore', log.fd, log.fd] });
  await new Promise((accept, reject) => { child.once('spawn', accept); child.once('error', reject); });
  await writeFile(resolve(root, `.local/${processName}.pid`), String(child.pid));
  child.unref(); await log.close();
  for (let attempt = 0; attempt < 300; attempt++) {
    try { if ((await targets(profileName)).some(t => t.url.endsWith('/main.html'))) { running = true; break; } } catch {}
    await new Promise(accept => setTimeout(accept, 100));
  }
  if (!running) throw new Error('Isolated workspace browser did not become ready within 30 seconds');
}
const cdp = await connect('/main.html', null, profileName);
try {
  // macOS can keep the isolated main process alive after its last window closes.
  await cdp.evaluate(`(async()=>{const windows=await chrome.windows.getAll({windowTypes:['normal']});if(!windows.some(w=>!w.incognito))await chrome.windows.create({url:'about:blank'});return true})()`);
  // This preference change applies ONLY to the dedicated disposable profile.
  await cdp.evaluate(`(()=>{vivaldi.prefs.set({path:'vivaldi.tabs.bar.position',value:${JSON.stringify(side)}});return true})()`);
  let vertical = false;
  for (let attempt = 0; attempt < 120; attempt++) {
    if (await cdp.evaluate(`chrome.extension.getViews().some(v=>v.document.querySelector('#tabs-tabbar-container.${side}'))`)) { vertical = true; break; }
    await new Promise(accept => setTimeout(accept, 100));
  }
  if (!vertical) throw new Error('Native vertical tab bar did not render; no prototype was injected');
  if (!probe) {
    const source = await readFile(resolve(root, '.local/workspace-folders.js'), 'utf8');
    await cdp.evaluate('globalThis.__ArcWorkspaceIsolatedPrototype=true');
    await cdp.evaluate(source);
    await cdp.evaluate('ArcWorkspaceFolders.ready.then(()=>true)');
    let mounted = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      if (await cdp.evaluate('ArcWorkspaceFolders.windowCount>0')) { mounted = true; break; }
      await new Promise(accept => setTimeout(accept, 80));
    }
    if (!mounted) throw new Error('Native-strip adapter did not mount; native tabs remain available');
  }
  console.log(`Workspace ${probe ? 'probe' : 'prototype'} ready in its dedicated ${side}-tab test window.`);
  console.log(`Profile: ${profile}`);
  console.log(probe ? 'No mod injected.' : 'Right-click the native vertical tab bar → New Folder. Drag actual tabs into folders.');
  console.log('Your installed app and normal browsing profile are unchanged. Do not sign in or use Sync here.');
} finally { cdp.close(); }
