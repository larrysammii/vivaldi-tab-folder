// Folder-only close lifecycle, exercised in the disposable QA profile only.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { connect, targets } from './cdp.mjs';

execFileSync(process.execPath, ['tools/build-workspace.mjs'], { encoding: 'utf8' });
execFileSync(process.execPath, ['tools/launch-workspace.mjs', '--qa-profile', '--probe'], { encoding: 'utf8', timeout: 60000 });
const profile = 'workspace-qa-profile', storage = 'arc-folders.workspace-prototype.v1';
const source = await readFile('.local/workspace-folders.js', 'utf8');
const c = await connect('/main.html', null, profile);
const workspace = Date.now(), home = process.argv.includes('--home');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const server = createServer((request, response) => {
  response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end('<!doctype html><title>Folder lifecycle QA</title><h1>Synthetic folder lifecycle fixture</h1>');
});
let ui, windowId, originalState, folderId, scope;
const results = [];
async function wait(action, label) {
  for (let i = 0; i < 100; i++) { const result = await action(); if (result) return result; await pause(60); }
  throw new Error(`Timed out: ${label}`);
}
async function inject() {
  await c.evaluate('globalThis.__ArcWorkspaceIsolatedPrototype=true');
  await c.evaluate(source); await c.evaluate('ArcWorkspaceFolders.ready.then(()=>true)');
}
async function test(name, action) {
  try { await action(); results.push(name); console.log(`PASS ${name}`); }
  catch (error) {
    console.error('Lifecycle failure state:', JSON.stringify(await c.evaluate(`(async()=>{const ts=await chrome.tabs.query({windowId:${windowId}}),v=chrome.extension.getViews().find(v=>v.vivaldiWindowId===${windowId});return{workspaceId:__awfLifecycleFixture.store.getActiveWorkspaceId(${windowId})??null,nativePages:__awfLifecycleFixture.pageStore.getPages(${windowId}).toArray().map(p=>({id:p.id,workspaceId:p.vivExtData?.workspaceId??null})),window:ArcWorkspaceFolders.snapshot().windows.find(w=>w.id===${windowId}),status:v?.document.querySelector('.awf-sr')?.textContent,tabs:ts.map(t=>({id:t.id,discarded:t.discarded,active:t.active,uuid:JSON.parse(t.vivExtData||'{}').ext_id,workspaceId:JSON.parse(t.vivExtData||'{}').workspaceId??null})),nativeIds:[...v.document.querySelectorAll('.tab-position [role="tab"][data-id]')].map(n=>n.dataset.id)}})()`)));
    throw error;
  }
}
async function tab(ref) {
  return c.evaluate(`chrome.tabs.query({windowId:${windowId}}).then(tabs=>{const t=tabs.find(t=>JSON.parse(t.vivExtData||'{}').ext_id===${JSON.stringify(ref.uuid)});return t?{id:t.id,active:t.active,discarded:t.discarded,status:t.status}:null})`);
}
async function point(selector) {
  return ui.evaluate(`(()=>{const n=document.querySelector(${JSON.stringify(selector)});if(!n)throw Error('Native control missing');n.scrollIntoView({block:'nearest'});const r=n.getBoundingClientRect();if(!r.width||!r.height)throw Error('Native control hidden');return{x:r.left+r.width/2,y:r.top+r.height/2}})()`);
}
async function clickClose(ref) {
  await c.evaluate(`chrome.windows.update(${windowId},{focused:true}).then(()=>true)`);
  await ui.send('Page.bringToFront');
  const { id } = await tab(ref);
  await wait(() => c.evaluate(`(async()=>{await ArcWorkspaceFolders.refresh();return ArcWorkspaceFolders.snapshot().windows.find(w=>w.id===${windowId})?.rows.some(r=>r.id===${id})})()`), 'current native row after replacement');
  const selector = `[data-id="tab-${id}"] button.close`;
  await wait(async () => {
    const header = await point(`[data-id="tab-${id}"] .tab-header`);
    await ui.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...header }); await pause(40);
    return ui.evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(selector)})?.getBoundingClientRect();return !!r?.width&&!!r?.height})()`);
  }, 'native hovered close button');
  let p = await point(selector);
  await ui.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...p }); await pause(40); p = await point(selector);
  assert.equal(await ui.evaluate(`!!document.elementFromPoint(${p.x},${p.y})?.closest(${JSON.stringify(selector)})`), true, 'native close button is hit-testable');
  for (const [type, buttons] of [['mousePressed', 1], ['mouseReleased', 0]]) await ui.send('Input.dispatchMouseEvent', { type, ...p, button: 'left', buttons, clickCount: 1 });
}
async function createTab(inFolder, active = true) {
  // Fixture creation uses the browser API. The separate workspace-smoke suite
  // covers the actual + → navigate → folder drag → unload → remove sequence.
  const id = await c.evaluate(`chrome.tabs.create({windowId:${windowId},url:${JSON.stringify(base + '/page')},active:${active}}).then(t=>t.id)`);
  await wait(() => c.evaluate(`(async()=>{await ArcWorkspaceFolders.refresh();return ArcWorkspaceFolders.snapshot().windows.find(w=>w.id===${windowId})?.rows.some(r=>r.id===${id})})()`), 'native fixture tab');
  if (inFolder) await c.evaluate(`ArcWorkspaceFolders.placeTab(${windowId},${id},${JSON.stringify(folderId)}).then(()=>true)`);
  const ref = { id, uuid: await c.evaluate(`chrome.tabs.get(${id}).then(t=>JSON.parse(t.vivExtData||'{}').ext_id)`) };
  await wait(() => tab(ref).then(t => t?.status === 'complete'), 'fixture page load');
  return ref;
}
let base;
try {
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
  originalState = await c.evaluate(`chrome.storage.local.get('${storage}').then(v=>v['${storage}']??null)`);
  await inject();
  windowId = await c.evaluate(`(async()=>{let r;webpackChunkgapp_browser_react.push([['awf-lifecycle-'+Date.now()],{},v=>r=v]);globalThis.__awfLifecycleFixture={store:r(61685).Z,actions:r(87290).Z,pages:r(67251).ZP,pageStore:r(70406).ZP,next:r(70406).yz};const w=await chrome.windows.create({url:${JSON.stringify(base + '/seed')},focused:true,width:1100,height:760});if(!${home}){__awfLifecycleFixture.actions.addWorkspaceWithId(${workspace},'Folder lifecycle QA',__awfLifecycleFixture.store.getDefaultIcon())}await __awfLifecycleFixture.pages.setActiveWorkspace(w.id,${home ? 'undefined' : workspace});return w.id})()`);
  await wait(() => c.evaluate(`(async()=>{await ArcWorkspaceFolders.refresh();return ArcWorkspaceFolders.snapshot().windows.find(w=>w.id===${windowId})?.supported})()`), 'workspace projection');
  for (const target of (await targets(profile)).filter(t => t.url.endsWith('/window.html'))) {
    const candidate = await connect('/window.html', target.id, profile);
    if (await candidate.evaluate(`window.vivaldiWindowId===${windowId}`)) { ui = candidate; break; }
    candidate.close();
  }
  assert.ok(ui);
  await c.evaluate(`ArcWorkspaceFolders.createFolder(${windowId},'Lifecycle folder').then(()=>true)`);
  scope = await c.evaluate(`ArcWorkspaceFolders.snapshot().windows.find(w=>w.id===${windowId}).scope`);
  assert.ok(scope.startsWith(home ? 'home:' : 'workspace:'), 'fixture uses the requested native scope');
  folderId = await c.evaluate(`ArcWorkspaceFolders.snapshot().state.folders.find(f=>f.scope===${JSON.stringify(scope)}).id`);

  await test('first native close unloads an active folder tab and retains its native row', async () => {
    const ref = await createTab(true), id = ref.id;
    const expectedNext = await c.evaluate(`__awfLifecycleFixture.next(__awfLifecycleFixture.pageStore.getPageById(${id}))?.id`);
    await clickClose(ref);
    await wait(async () => {
      const value = await tab(ref);
      assert.ok(value, 'first close must retain the folder tab instead of removing it');
      return value.discarded;
    }, 'first close unload');
    const unloaded = await tab(ref);
    assert.equal(unloaded.active, false, 'unload moves focus away');
    assert.equal(await c.evaluate(`chrome.tabs.query({windowId:${windowId},active:true}).then(ts=>ts[0].id)`), expectedNext, 'use the actual native close-focus selection');
    await wait(() => c.evaluate(`(async()=>{await ArcWorkspaceFolders.refresh();const s=ArcWorkspaceFolders.snapshot(),w=s.windows.find(w=>w.id===${windowId});return w?.rows.some(row=>row.id===${unloaded.id})&&s.state.tabs[${JSON.stringify(`${scope}/tab:${ref.uuid}`)}]?.folderId===${JSON.stringify(folderId)}})()`), 'unloaded native entry retains its folder');
    assert.equal(await ui.evaluate(`document.querySelectorAll('[data-id="tab-${unloaded.id}"]').length`), 1, 'one native row remains for the persistent entry');
    await clickClose(ref); await wait(() => tab(ref).then(t => !t), 'second close removes unloaded tab');
  });
  await test('middle-click unloads then removes a folder tab, but closes unfiled tabs immediately', async () => {
    async function middle(ref) {
      const { id } = await tab(ref), p = await point(`[data-id="tab-${id}"] .tab-header`);
      for (const [type, buttons] of [['mouseMoved', 0], ['mousePressed', 4], ['mouseReleased', 0]]) await ui.send('Input.dispatchMouseEvent', { type, ...p, button: type === 'mouseMoved' ? 'none' : 'middle', buttons, clickCount: 1 });
    }
    const ref = await createTab(true);
    await middle(ref); await wait(() => tab(ref).then(t => t?.discarded), 'middle-click unload');
    await wait(() => c.evaluate(`ArcWorkspaceFolders.refresh().then(()=>true)`), 'native replacement refresh');
    await middle(ref); await wait(() => tab(ref).then(t => !t), 'middle-click removal');
    const loose = await createTab(false);
    await middle(loose); await wait(() => tab(loose).then(t => !t), 'unfiled middle-click closes immediately');
  });
  await test('reopening resets the cycle and automatically unloaded folder tabs close immediately', async () => {
    const ref = await createTab(true);
    await clickClose(ref); await wait(() => tab(ref).then(t => t?.discarded), 'initial unload');
    let live = await tab(ref);
    await c.evaluate(`chrome.tabs.update(${live.id},{active:true}).then(()=>true)`);
    await wait(() => tab(ref).then(t => t && !t.discarded && t.status === 'complete'), 'open reloads unloaded entry');
    await clickClose(ref); await wait(() => tab(ref).then(t => t?.discarded), 'close after reopening unloads again');
    await clickClose(ref); await wait(() => tab(ref).then(t => !t), 'remove after second unload');
    const automatic = await createTab(true);
    await c.evaluate(`chrome.tabs.create({windowId:${windowId},url:'about:blank',active:true}).then(()=>true)`);
    live = await tab(automatic);
    await c.evaluate(`chrome.tabs.discard(${live.id}).then(()=>true)`);
    await wait(() => tab(automatic).then(t => t?.discarded), 'native automatic/background unload');
    await clickClose(automatic); await wait(() => tab(automatic).then(t => !t), 'already-unloaded tab removed on first close gesture');
  });
  await test('individual native close command unloads a loaded folder tab; loose close stays native', async () => {
    const ref = await createTab(true);
    await c.evaluate(`__awfLifecycleFixture.pages.close(${windowId}).then(()=>true)`);
    await wait(() => tab(ref).then(t => t?.discarded), 'native Close Tab command unloads');
    await clickClose(ref); await wait(() => tab(ref).then(t => !t), 'remove command-unloaded tab');
    const loose = await createTab(false);
    await clickClose(loose); await wait(() => tab(loose).then(t => !t), 'unfiled native close immediately removes');
  });
  await test('native context-menu Close Tab follows the folder-only lifecycle', async () => {
    const ref = await createTab(true);
    await c.evaluate(`(()=>{globalThis.__awfCloseMenuOriginal=vivaldi.contextMenu.show;globalThis.__awfCloseMenuRequest=null;vivaldi.contextMenu.show=(request,callback)=>{globalThis.__awfCloseMenuRequest=request;callback?.()};return true})()`);
    try {
      const p = await point(`[data-id="tab-${ref.id}"] .tab-header`);
      for (const [type, buttons] of [['mousePressed', 2], ['mouseReleased', 0]]) await ui.send('Input.dispatchMouseEvent', { type, ...p, button: 'right', buttons, clickCount: 1 });
      const entries = await wait(() => c.evaluate(`(()=>{const request=globalThis.__awfCloseMenuRequest;if(!request)return null;const result=[];function visit(nodes){for(const n of nodes??[]){if(n.item)result.push({id:n.item.id,name:n.item.name});visit(n.children)}}visit(request.children);return result})()`), 'native context menu payload');
      const command = entries.find(e => /^Close Tab$/i.test(e.name.replace(/&/g,'')));
      assert.ok(command, 'native Close Tab command exists: '+JSON.stringify(entries));
      await c.evaluate(`(()=>{vivaldi.menubarMenu.onAction.dispatch({id:${command.id},persistent:false,state:{ctrl:false,shift:false,alt:false,command:false,left:true,right:false,center:false}});return true})()`);
      await wait(() => tab(ref).then(t => t?.discarded), 'context Close Tab unloads loaded folder entry');
    } finally {
      await c.evaluate(`(()=>{vivaldi.contextMenu.show=__awfCloseMenuOriginal;delete globalThis.__awfCloseMenuOriginal;delete globalThis.__awfCloseMenuRequest;vivaldi.menubarMenu.onClose.dispatch();return true})()`);
    }
    await clickClose(ref); await wait(() => tab(ref).then(t => !t), 'remove context-unloaded entry');
  });
  if (process.argv.includes('--native-key')) await test('real macOS Command-W unloads a folder tab and removes an unfiled tab', async () => {
    async function commandW() {
      await c.evaluate(`chrome.windows.update(${windowId},{focused:true}).then(()=>true)`);
      await ui.send('Page.bringToFront');
      const pid = (await readFile('.local/vivaldi-workspace-qa.pid', 'utf8')).trim();
      execFileSync('swift', ['tools/workspace-close-key.swift', pid, resolve('.local/workspace-qa-profile')], { encoding: 'utf8', timeout: 20000 });
    }
    const ref = await createTab(true);
    await commandW(); await wait(() => tab(ref).then(t => t?.discarded), 'native Command-W unload');
    await clickClose(ref); await wait(() => tab(ref).then(t => !t), 'remove Command-W unloaded entry');
    const loose = await createTab(false);
    await commandW(); await wait(() => tab(loose).then(t => !t), 'unfiled Command-W stays native');
  });
  await test('two queued closes follow the persistent entry across Vivaldi ID replacement', async () => {
    const ref = await createTab(true);
    await c.evaluate(`Promise.all([__awfLifecycleFixture.pages.closePageById(${ref.id}),__awfLifecycleFixture.pages.closePageById(${ref.id})]).then(()=>true)`);
    await wait(() => tab(ref).then(t => !t), 'queued unload then remove');
  });
  await test('unloading the last folder tab keeps the entry and opens one unfiled Start Page', async () => {
    const ref = await createTab(true);
    await c.evaluate(`chrome.tabs.query({windowId:${windowId}}).then(ts=>chrome.tabs.remove(ts.filter(t=>t.id!==${ref.id}).map(t=>t.id))).then(()=>true)`);
    await wait(() => c.evaluate(`chrome.tabs.query({windowId:${windowId}}).then(ts=>ts.length===1)`), 'one remaining loaded folder tab');
    await clickClose(ref); await wait(() => tab(ref).then(t => t?.discarded), 'last folder tab unload');
    const live = await c.evaluate(`chrome.tabs.query({windowId:${windowId}}).then(ts=>ts.map(t=>({id:t.id,active:t.active,discarded:t.discarded,startPage:/startpage/.test(t.url),folder:ArcWorkspaceFolders.snapshot().state.tabs[${JSON.stringify(scope + '/tab:')}+JSON.parse(t.vivExtData||'{}').ext_id]?.folderId??null})))`);
    assert.equal(live.length, 2);
    const start = live.find(t => t.active);
    assert.equal(start.startPage, true); assert.equal(start.folder, null);
    await clickClose(ref); await wait(() => tab(ref).then(t => !t), 'second close removes last unloaded entry');
  });
  console.log(`Folder close lifecycle checks: ${results.length} passed.`);
} finally {
  try {
    await c.evaluate(`(async()=>{globalThis.ArcWorkspaceFolders?.destroy();${windowId ? `try{await chrome.windows.remove(${windowId})}catch{};${home ? '' : `try{await __awfLifecycleFixture.actions.removeWorkspace(${windowId},${workspace})}catch{}`}` : ''}${originalState === null ? `await chrome.storage.local.remove('${storage}');` : originalState === undefined ? '' : `await chrome.storage.local.set({'${storage}':${JSON.stringify(originalState)}});`}return true})()`);
    await inject();
  } finally {
    ui?.close(); c.close(); server.closeAllConnections();
    if (server.listening) await new Promise(resolve => server.close(resolve));
  }
}
