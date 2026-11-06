import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { connect, targets } from './cdp.mjs';

const exec = promisify(execFile);
const source = await readFile('dist/arc-folders.js', 'utf8');
const key = 'arc-folders.state.v1';
let main = await connect();
const evaluate = code => main.evaluate(code);
async function wait(code, message) {
  for (let count = 0; count < 100; count++) {
    if (await evaluate(code)) return;
    await new Promise(accept => setTimeout(accept, 80));
  }
  throw new Error(message);
}
const original = await evaluate(`chrome.storage.local.get('${key}')`);
const extraWindows = [];
let fixtureKey;
let fixtureId;
let privateMain;
let privateWindowId;
try {
  await evaluate(source); await evaluate('ArcFolders.ready.then(()=>true)');
  const first = await evaluate(`(async()=>{const w=(await chrome.windows.getAll({windowTypes:['normal']})).find(w=>!w.incognito);return {id:w.id,scope:'window:'+JSON.parse(w.vivExtData).ext_id};})()`);
  const second = await evaluate(`chrome.windows.create({url:'about:blank',focused:false})`);
  extraWindows.push(second.id);
  await wait('ArcFolders.windowCount===2', 'Second normal window did not get exactly one sidebar');
  await evaluate(`(()=>{const d=chrome.extension.getViews().find(v=>v.vivaldiWindowId===${first.id}).document;d.querySelector('#arc-folders button[aria-label="New folder"]').click();})()`);
  await wait(`chrome.extension.getViews().some(v=>v.document.querySelector('.af-dialog[open] input'))`, 'Lifecycle name dialog missing');
  await evaluate(`(()=>{const d=chrome.extension.getViews().find(v=>v.vivaldiWindowId===${first.id}).document;const f=d.querySelector('.af-dialog[open] form');f.elements.namedItem('folder-name').value='Restart check';f.requestSubmit();})()`);
  await wait(`ArcFolders.state.folders.some(f=>f.name==='Restart check')`, 'Lifecycle folder missing');
  const fid = await evaluate(`ArcFolders.state.folders.find(f=>f.name==='Restart check').id`);
  assert.equal(await evaluate(`(()=>{const d=chrome.extension.getViews().find(v=>v.vivaldiWindowId===${second.id}).document;return [...d.querySelectorAll('#arc-folders .af-folder .af-label')].some(n=>n.textContent==='Restart check');})()`), false);
  console.log('PASS lifecycle 1/3 — separate normal windows get independent folder trees');

  // Vivaldi returns null to the normal context when creating a private window;
  // its window object belongs to a distinct private main.html context.
  await evaluate(`chrome.windows.create({url:'about:blank',incognito:true,focused:false})`);
  for (let attempt = 0; attempt < 100 && !privateMain; attempt++) {
    for (const target of (await targets()).filter(t => t.url.endsWith('/main.html'))) {
      const c = await connect('/main.html', target.id);
      if (await c.evaluate('!!chrome.extension.inIncognitoContext')) { privateMain = c; break; }
      c.close();
    }
    if (!privateMain) await new Promise(accept => setTimeout(accept, 80));
  }
  assert.ok(privateMain, 'Private main context did not appear');
  privateWindowId = await privateMain.evaluate(`(async()=> (await chrome.windows.getAll({})).find(w=>w.incognito)?.id)()`);
  assert.ok(privateWindowId, 'Private window identity missing');
  await privateMain.evaluate(source); await privateMain.evaluate('ArcFolders.ready.then(()=>true)');
  assert.equal(await privateMain.evaluate('ArcFolders.windowCount'), 0);
  let privateChecked = false;
  for (const target of (await targets()).filter(t => t.url.endsWith('/window.html'))) {
    const c = await connect('/window.html', target.id);
    try {
      if (await c.evaluate(`globalThis.vivaldiWindowId===${privateWindowId}`)) {
        assert.equal(await c.evaluate(`!!document.querySelector('#arc-folders')`), false);
        privateChecked = true;
      }
    } finally { c.close(); }
  }
  assert.ok(privateChecked, 'Private window target was not checked');
  assert.equal(await evaluate('ArcFolders.windowCount'), 2);
  await privateMain.evaluate(`chrome.windows.remove(${privateWindowId})`).catch(() => {});
  privateMain.close(); privateMain = null; privateWindowId = null;
  console.log('PASS lifecycle 2/3 — private window excluded, including private-main initialization');
  for (const id of extraWindows) await evaluate(`chrome.windows.remove(${id})`);
  extraWindows.length = 0;
  await wait('ArcFolders.windowCount===1', 'Closed window mounts were not cleaned up');

  const tab = await evaluate(`chrome.tabs.create({windowId:${first.id},url:'data:text/html,%3Ctitle%3ERestart%20fixture%3C/title%3E'})`);
  fixtureId = tab.id;
  await wait(`chrome.extension.getViews().some(v=>[...v.document.querySelectorAll('#arc-folders button')].some(b=>b.getAttribute('aria-label')==='Move Restart fixture to folder'))`, 'Restart fixture not rendered');
  await evaluate(`(()=>{const d=chrome.extension.getViews().find(v=>v.vivaldiWindowId===${first.id}).document;[...d.querySelectorAll('#arc-folders button')].find(b=>b.getAttribute('aria-label')==='Move Restart fixture to folder').click();})()`);
  await wait(`chrome.extension.getViews().some(v=>v.document.querySelector('.af-dialog[open] select'))`, 'Restart move dialog missing');
  await evaluate(`(()=>{const d=chrome.extension.getViews().find(v=>v.vivaldiWindowId===${first.id}).document;const f=d.querySelector('.af-dialog[open] form');f.elements.namedItem('destination').value=${JSON.stringify(fid)};f.requestSubmit();})()`);
  await wait(`Object.values(ArcFolders.state.tabs).some(p=>p.folderId===${JSON.stringify(fid)})`, 'Restart placement not saved');
  fixtureKey = await evaluate(`Object.keys(ArcFolders.state.tabs).find(k=>ArcFolders.state.tabs[k].folderId===${JSON.stringify(fid)})`);
  const before = await evaluate('ArcFolders.state');
  await writeFile('.local/lifecycle-before.json', JSON.stringify({ state: before, scope: first.scope, tabKey: fixtureKey }, null, 2));
  await main.send('Browser.close').catch(() => {});
  main.close();
  for (let count = 0; count < 100; count++) {
    try { await targets(); } catch { break; }
    await new Promise(accept => setTimeout(accept, 80));
  }
  await exec(process.execPath, ['tools/launch-test.mjs'], { timeout: 45000 });
  main = await connect();
  await evaluate('ArcFolders.ready.then(()=>true)');
  assert.deepEqual(await evaluate('ArcFolders.state'), before, 'Folder state changed across process restart');
  const restored = await evaluate(`(async()=>{const windows=await chrome.windows.getAll({windowTypes:['normal']});const tabs=await chrome.tabs.query({});return {scopes:windows.map(w=>'window:'+JSON.parse(w.vivExtData).ext_id),tabs:tabs.map(t=>({id:t.id,key:'tab:'+JSON.parse(t.vivExtData).ext_id,windowId:t.windowId}))};})()`);
  assert.ok(restored.scopes.includes(first.scope), 'Vivaldi did not restore the stable window identity');
  const restoredTab = restored.tabs.find(t => t.key === fixtureKey);
  assert.ok(restoredTab, 'Vivaldi did not restore the stable tab identity');
  fixtureId = restoredTab.id;
  await wait(`chrome.extension.getViews().some(v=>v.document.querySelector('#arc-folders [data-drag="tab"][data-key="${fixtureKey}"]'))`, 'Restored tab did not mount in its folder');
  console.log('PASS lifecycle 3/3 — actual process restart restores hierarchy and live tab assignment');
} finally {
  if (privateMain) {
    if (privateWindowId) await privateMain.evaluate(`chrome.windows.remove(${privateWindowId})`).catch(() => {});
    privateMain.close();
  }
  for (const id of extraWindows) await evaluate(`chrome.windows.remove(${id})`).catch(() => {});
  if (fixtureId) await evaluate(`chrome.tabs.remove(${fixtureId})`).catch(() => {});
  await evaluate(`(async()=>{await chrome.storage.local.remove('${key}');const old=${JSON.stringify(original)};if(Object.keys(old).length)await chrome.storage.local.set(old);})()`).catch(() => {});
  await evaluate(source).catch(() => {});
  await evaluate('ArcFolders.ready.then(()=>true)').catch(() => {});
  main.close();
}
