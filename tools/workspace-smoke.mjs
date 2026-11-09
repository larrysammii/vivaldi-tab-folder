// Only the dedicated workspace-profile is used. Native OS menu selection is
// simulated after a REAL right-click produces the actual native-menu payload.
// Native OS drag entry is intercepted; the browser's serialized drop is then delivered.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { connect, targets } from './cdp.mjs';

execFileSync(process.execPath, ['tools/launch-workspace.mjs'], { encoding: 'utf8', timeout: 60000 });
const source = await readFile('.local/workspace-folders.js', 'utf8');
const profile = 'workspace-profile', storage = 'arc-folders.workspace-prototype.v1';
const A = 900000000001, B = 900000000002;
const c = await connect('/main.html', null, profile);
let ui, originalState, originalLegacy, originalSide, fixtureWindow;
const createdTabs = [], results = [];
const pause = ms => new Promise(r => setTimeout(r, ms));
async function wait(expression, label) {
  for (let i = 0; i < 100; i++) { if (await c.evaluate(expression)) return; await pause(80); }
  throw new Error(`Timed out: ${label}`);
}
async function test(name, action) { await action(); results.push(name); console.log(`PASS ${name}`); }
async function inject() {
  await c.evaluate('globalThis.__ArcWorkspaceIsolatedPrototype=true'); await c.evaluate(source); await c.evaluate('ArcWorkspaceFolders.ready.then(()=>true)');
}
async function scope(id) {
  await c.evaluate(`(async()=>{await __awfFixture.pages.setActiveWorkspace(${fixtureWindow},${id});return true})()`);
  await wait(`(async()=>{await ArcWorkspaceFolders.refresh();const w=ArcWorkspaceFolders.snapshot().windows.find(w=>w.id===${fixtureWindow});return w?.scope==='workspace:${id}'&&w.supported})()`, `workspace ${id}`);
}
async function point(selector, bottom = false) {
  return ui.evaluate(`(()=>{const n=[...document.querySelectorAll(${JSON.stringify(selector)})].find(n=>{const r=n.getBoundingClientRect();return r.width&&r.height});if(!n)throw new Error('Visible control not found');const r=n.getBoundingClientRect();return{x:r.x+Math.min(80,r.width/2),y:${bottom ? 'r.bottom-20' : 'r.y+r.height/2'}}})()`);
}
async function click(selector, button = 'left', bottom = false) {
  const p = await point(selector, bottom);
  await ui.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...p });
  await ui.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...p, button, buttons: button === 'right' ? 2 : 1, clickCount: 1 });
  await ui.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...p, button, buttons: 0, clickCount: 1 });
}
async function key(key, code, virtualKey) {
  for (const type of ['rawKeyDown', 'keyUp']) await ui.send('Input.dispatchKeyEvent', { type, key, code, windowsVirtualKeyCode: virtualKey, nativeVirtualKeyCode: virtualKey });
}
async function menu(selector, label, bottom = false) {
  await c.evaluate('globalThis.__awfMenuWire.last=null');
  await click(selector, 'right', bottom);
  await wait(`!!globalThis.__awfMenuWire.last`, 'native menu request');
  const snapshot = await c.evaluate('ArcWorkspaceFolders.menuSnapshot()');
  assert.ok(snapshot, 'native menu augmented by the workspace bridge');
  const item = snapshot.commands.find(command => command.label === label);
  assert.ok(item, `native ${label} command`);
  const selected = await c.evaluate(`(()=>{const ok=ArcWorkspaceFolders.dispatchMenuAction(${item.id});for(const close of [...__awfMenuWire.closeListeners])close();return ok})()`);
  assert.equal(selected, true);
  if (['New Folder', 'New Subfolder', 'Rename Folder', 'Move Folder'].includes(label)) await wait(`chrome.extension.getViews().some(v=>!!v.document.querySelector('.awf-dialog[open]'))`, 'folder dialog');
}
async function folders() { return c.evaluate('ArcWorkspaceFolders.snapshot().state.folders'); }
async function placedIn(tabId, folderId) {
  await wait(`(async()=>{const tab=await chrome.tabs.get(${tabId});const key=ArcWorkspaceLayout.tabKey(ArcWorkspaceLayout.metadata(tab.vivExtData),'workspace:${A}');return ArcWorkspaceFolders.snapshot().state.tabs[key]?.folderId===${JSON.stringify(folderId)}})()`, 'native tab folder assignment');
}
async function drag(fromSelector, toSelector) {
  const from = await point(fromSelector), to = await point(toSelector);
  await ui.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...from });
  await ui.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...from, button: 'left', buttons: 1, clickCount: 1 });
  for (let i = 1; i <= 18; i++) {
    await ui.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: from.x + (to.x - from.x) * i / 18, y: from.y + (to.y - from.y) * i / 18, button: 'left', buttons: 1 }); await pause(20);
  }
  await ui.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...to, button: 'left', buttons: 0, clickCount: 1 });
}
try {
  originalState = await c.evaluate(`chrome.storage.local.get('${storage}').then(v=>v['${storage}']??null)`);
  originalLegacy = await c.evaluate(`chrome.storage.local.get('arc-folders.state.v1').then(v=>JSON.stringify(v))`);
  originalSide = await c.evaluate(`vivaldi.prefs.get('vivaldi.tabs.bar.position').then(v=>v.value)`);
  // Capture the FINAL native API payload without opening a platform menu that
  // CDP cannot select. Retain the native JS menu lifecycle, including close handlers.
  await c.evaluate(`(()=>{
    ArcWorkspaceFolders.destroy();
    const event=vivaldi.menubarMenu.onClose;
    const wire={show:vivaldi.contextMenu.show,add:event.addListener,remove:event.removeListener,closeListeners:new Set(),last:null};
    globalThis.__awfMenuWire=wire;
    event.addListener=function(fn){wire.closeListeners.add(fn);return wire.add.call(this,fn)};
    event.removeListener=function(fn){wire.closeListeners.delete(fn);return wire.remove.call(this,fn)};
    vivaldi.contextMenu.show=function(request,callback){wire.last=request;callback?.()};
    const dragEvent=vivaldi.tabsPrivate.onDragEnd;
    const drag={start:vivaldi.tabsPrivate.startDrag,add:dragEvent.addListener,remove:dragEvent.removeListener,endListeners:new Set(),last:null};
    globalThis.__awfDragWire=drag;
    dragEvent.addListener=function(fn){drag.endListeners.add(fn);return drag.add.call(this,fn)};
    dragEvent.removeListener=function(fn){drag.endListeners.delete(fn);return drag.remove.call(this,fn)};
    vivaldi.tabsPrivate.startDrag=function(request){drag.last=request};
    return true;
  })()`);
  fixtureWindow = await c.evaluate(`(async()=>{
    let require;webpackChunkgapp_browser_react.push([['arc-workspace-smoke-'+Date.now()],{},r=>{require=r}]);
    const store=require(61685).Z,actions=require(87290).Z,pages=require(67251).ZP;globalThis.__awfFixture={store,actions,pages};
    const win=(await chrome.windows.getAll({windowTypes:['normal']})).find(w=>!w.incognito);
    for(const[id,name]of [[${A},'Prototype Research'],[${B},'Prototype Personal']])if(!store.getWorkspaceById(id))actions.addWorkspaceWithId(id,name,store.getDefaultIcon());
    await pages.setActiveWorkspace(win.id,${A});return win.id;
  })()`);
  await c.evaluate(`chrome.storage.local.set({'${storage}':ArcFoldersModel.emptyState()}).then(()=>true)`); await inject(); await scope(A);
  const active = await c.evaluate(`chrome.tabs.create({windowId:${fixtureWindow},url:'data:text/html,<title>Workspace%20fixture</title><h1>Synthetic%20fixture</h1>',active:true}).then(t=>t.id)`); createdTabs.push(active);
  await wait(`(async()=>{await ArcWorkspaceFolders.refresh();return ArcWorkspaceFolders.snapshot().windows.find(w=>w.id===${fixtureWindow})?.rows.some(r=>r.id===${active})})()`, 'native fixture row');
  for (const target of (await targets(profile)).filter(t => t.url.endsWith('/window.html'))) {
    const candidate = await connect('/window.html', target.id, profile);
    if (await candidate.evaluate(`window.vivaldiWindowId===${fixtureWindow}`)) { ui = candidate; break; } candidate.close();
  }
  assert.ok(ui, 'native window target');
  await ui.evaluate(`globalThis.__awfOriginalNodes=new Map([...document.querySelectorAll('.tab-position [role="tab"][data-id]')].map(n=>[n.dataset.id,n]))`);
  let parent, child;
  await test('right-click an actual native tab exposes New Folder in its existing native menu', async () => {
    await menu(`[data-id="tab-${active}"] .tab-header`, 'New Folder');
    assert.equal(await ui.evaluate('document.activeElement?.tagName'), 'INPUT');
    await ui.send('Input.insertText', { text: 'Test Research' }); await click('.awf-dialog button[type="submit"]');
    await wait(`ArcWorkspaceFolders.snapshot().state.folders.some(f=>f.name==='Test Research')`, 'context menu folder creation');
    parent = (await folders()).find(f => f.name === 'Test Research').id;
    assert.equal(await ui.evaluate('document.querySelectorAll(".awf-toolbar,.awf-tab-grip,#arc-folders").length'), 0);
  });
  await test('right-click folder creates nested folders using the native popup API', async () => {
    await menu(`[data-folder-toggle="${parent}"]`, 'New Subfolder');
    await ui.send('Input.insertText', { text: 'Test Nested' }); await click('.awf-dialog button[type="submit"]');
    await wait(`ArcWorkspaceFolders.snapshot().state.folders.some(f=>f.name==='Test Nested')`, 'subfolder');
    child = (await folders()).find(f => f.name === 'Test Nested').id;
    assert.equal(await c.evaluate('__awfMenuWire.last.forceViews'), false);
    assert.equal(await ui.evaluate(`document.querySelector('[data-id="tab-${active}"]')===__awfOriginalNodes.get('tab-${active}')`), true);
  });
  await test('native tab-title dragging and serialized drops assign tabs without custom handles', async () => {
    await c.evaluate('__awfDragWire.last=null');
    await drag(`[data-id="tab-${active}"] .tab-header`, `[data-folder-toggle="${child}"]`);
    const request = await c.evaluate(`__awfDragWire.last&&({mimeType:__awfDragWire.last.mimeType,customData:__awfDragWire.last.customData})`);
    if (request) {
      assert.equal(request.mimeType, 'vivaldi/x-tab-entries');
      const target = await point(`[data-folder-toggle="${child}"]`);
      const data = { items: [{ mimeType: request.mimeType, data: request.customData }], dragOperationsMask: 16 };
      for (const type of ['dragEnter', 'dragOver', 'drop']) await ui.send('Input.dispatchDragEvent', { type, ...target, data });
      await c.evaluate(`(()=>{for(const end of [...__awfDragWire.endListeners])end(false,0,0,${fixtureWindow});return true})()`);
    }
    await placedIn(active, child);
    assert.ok(await c.evaluate(`ArcWorkspaceFolders.snapshot().windows.find(w=>w.id===${fixtureWindow}).nativeDrops`) > 0);
    await wait(`(async()=>{await ArcWorkspaceFolders.refresh();return ArcWorkspaceFolders.snapshot().windows.find(w=>w.id===${fixtureWindow}).rows.find(r=>r.id===${active})?.depth===2})()`, 'nested native row');
    assert.equal(await ui.evaluate(`document.querySelectorAll('[data-id="tab-${active}"]').length`), 1);
    assert.equal(await ui.evaluate(`document.querySelector('[data-id="tab-${active}"]').classList.contains('tab-wrapper')`), true);
  });
  await test('multi-tab assignment rolls back the whole batch after a storage failure', async () => {
    const second = await c.evaluate(`chrome.tabs.create({windowId:${fixtureWindow},url:'about:blank',active:false}).then(tab=>tab.id)`); createdTabs.push(second);
    await wait(`(async()=>{await ArcWorkspaceFolders.refresh();return ArcWorkspaceFolders.snapshot().windows.find(w=>w.id===${fixtureWindow}).rows.some(r=>r.id===${second})})()`, 'batch tab identity');
    const result = await c.evaluate(`(async()=>{
      const before=ArcWorkspaceFolders.snapshot().state, storedBefore=(await chrome.storage.local.get('${storage}'))['${storage}'];
      const original=chrome.storage.local.set;let writes=0,rejected=false;
      chrome.storage.local.set=function(value){if(Object.hasOwn(value,'${storage}')){writes++;return Promise.reject(new Error('Synthetic storage failure'))}return original.call(this,value)};
      try{await ArcWorkspaceFolders.placeTabs(${fixtureWindow},[${active},${second}],${JSON.stringify(parent)})}catch{rejected=true}finally{chrome.storage.local.set=original}
      return{before,after:ArcWorkspaceFolders.snapshot().state,storedBefore,storedAfter:(await chrome.storage.local.get('${storage}'))['${storage}'],writes,rejected};
    })()`);
    assert.equal(result.rejected, true); assert.equal(result.writes, 1); assert.deepEqual(result.after, result.before); assert.deepEqual(result.storedAfter, result.storedBefore);
    await c.evaluate(`ArcWorkspaceFolders.placeTabs(${fixtureWindow},[${active},${second}],${JSON.stringify(child)}).then(()=>true)`); await placedIn(active, child); await placedIn(second, child);
  });
  await test('stale folders, foreign windows and native-handler failures reject drops safely', async () => {
    const result = await c.evaluate(`(()=>{
      const view=chrome.extension.getViews().find(v=>v.vivaldiWindowId===${fixtureWindow}),doc=view.document,layer=doc.querySelector('.awf-layer');
      const controller=ArcWorkspaceNative.findDragController(doc.querySelector('.tab-strip')),original=controller.droppedTabHandler;
      const before=ArcWorkspaceFolders.snapshot().windows.find(w=>w.id===${fixtureWindow}).nativeDrops;
      const payload={ids:[${active}],active:${active},activeIndex:0,dragSource:'main',sourceWindow:${fixtureWindow}};
      const stale=doc.createElement('div');stale.className='awf-folder';stale.dataset.folderId='folder:missing';layer.append(stale);
      const stop=e=>e.stopPropagation(),errors=[];const error=e=>{errors.push(e.message);e.preventDefault()};layer.addEventListener('drop',stop);view.addEventListener('error',error);
      let calls=0;controller.droppedTabHandler=()=>{calls++;throw new Error('Synthetic native rejection')};
      const send=(target,value)=>{const data=new view.DataTransfer();data.setData(ArcWorkspaceNative.TAB_MIME,JSON.stringify(value));const e=new view.DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:data});target.dispatchEvent(e);return e.defaultPrevented};
      try{
        const staleConsumed=send(stale,payload),callsAfterStale=calls;
        const row=[...layer.querySelectorAll('.awf-folder')].find(n=>n.dataset.folderId===${JSON.stringify(child)});
        const foreignConsumed=send(row,{...payload,sourceWindow:${fixtureWindow}+1}),callsAfterForeign=calls;
        const failedConsumed=send(row,payload);
        return{staleConsumed,foreignConsumed,failedConsumed,callsAfterStale,callsAfterForeign,calls,errors,before,after:ArcWorkspaceFolders.snapshot().windows.find(w=>w.id===${fixtureWindow}).nativeDrops};
      }finally{controller.droppedTabHandler=original;layer.removeEventListener('drop',stop);view.removeEventListener('error',error);stale.remove()}
    })()`);
    assert.equal(result.staleConsumed, false); assert.equal(result.foreignConsumed, false); assert.equal(result.failedConsumed, false); assert.equal(result.callsAfterStale, 0); assert.equal(result.callsAfterForeign, 0); assert.equal(result.calls, 1); assert.deepEqual(result.errors, []); assert.equal(result.after, result.before);
  });
  await test('folder and native tab rows have non-overlapping geometry', async () => {
    const bounds = await ui.evaluate(`[...document.querySelectorAll('.awf-folder,.awf-tab-row:not(.awf-hidden)')].map(n=>{const r=n.getBoundingClientRect();return{top:r.top,bottom:r.bottom,height:r.height}}).sort((a,b)=>a.top-b.top)`);
    for (let i = 0; i < bounds.length; i++) { assert.ok(bounds[i].height > 0); if (i) assert.ok(bounds[i].top >= bounds[i - 1].bottom - 1); }
  });
  await test('collapse and keyboard expand preserve live native tabs', async () => {
    await click(`[data-folder-toggle="${parent}"]`);
    assert.equal(await ui.evaluate(`getComputedStyle(document.querySelector('[data-id="tab-${active}"]').closest('.tab-position')).display`), 'none');
    assert.equal(await c.evaluate(`chrome.tabs.get(${active}).then(t=>t.id)`), active);
    assert.equal(await ui.evaluate('document.activeElement?.dataset.folderToggle'), parent, 'clicked folder retains keyboard focus');
    await key('ArrowRight', 'ArrowRight', 39);
    await wait(`!ArcWorkspaceFolders.snapshot().state.folders.find(f=>f.id===${JSON.stringify(parent)}).collapsed`, 'keyboard expansion');
  });
  await test('right-click empty tab-bar space creates folders without an extra toolbar', async () => {
    await menu('.awf-scroll-host', 'New Folder', true); await key('Escape', 'Escape', 27); await pause(80);
    assert.equal(await ui.evaluate('document.querySelectorAll(".awf-dialog,.awf-toolbar,.awf-tab-grip").length'), 0);
  });
  await test('each workspace has an independent folder tree and cross-scope assignments are rejected', async () => {
    await scope(B); await c.evaluate(`ArcWorkspaceFolders.createFolder(${fixtureWindow},'Test Personal').then(()=>true)`);
    assert.deepEqual(await ui.evaluate(`[...document.querySelectorAll('.awf-folder-name')].map(n=>n.textContent)`), ['Test Personal']);
    const beta = (await folders()).find(f => f.name === 'Test Personal').id;
    assert.equal(await c.evaluate(`Promise.resolve().then(()=>ArcWorkspaceFolders.placeTab(${fixtureWindow},${active},${JSON.stringify(beta)})).then(()=>false,()=>true)`), true);
    await scope(A); assert.deepEqual(await ui.evaluate(`[...document.querySelectorAll('.awf-folder-name')].map(n=>n.textContent)`), ['Test Research', 'Test Nested']);
  });
  await writeFile('.local/workspace-native-left.png', Buffer.from((await ui.send('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
  await test('original native tab activation and close buttons still work', async () => {
    const extra = await c.evaluate(`chrome.tabs.create({windowId:${fixtureWindow},url:'about:blank',active:false}).then(t=>t.id)`); createdTabs.push(extra);
    await wait(`!!chrome.extension.getViews().find(v=>v.vivaldiWindowId===${fixtureWindow})?.document.querySelector('[data-id="tab-${extra}"]')`, 'native extra row');
    await c.evaluate('ArcWorkspaceFolders.refresh().then(()=>true)'); await click(`[data-id="tab-${extra}"] .tab-header`);
    await wait(`chrome.tabs.get(${extra}).then(t=>t.active)`, 'native tab activation'); await click(`[data-id="tab-${extra}"] button.close`);
    await wait(`chrome.tabs.query({windowId:${fixtureWindow}}).then(ts=>!ts.some(t=>t.id===${extra}))`, 'native close');
  });
  await test('reinjection preserves workspace state without altering the old window-wide storage', async () => {
    const before = await c.evaluate('JSON.stringify(ArcWorkspaceFolders.snapshot().state)'); await inject(); await scope(A);
    assert.equal(await c.evaluate('JSON.stringify(ArcWorkspaceFolders.snapshot().state)'), before);
    assert.equal(await c.evaluate(`chrome.storage.local.get('arc-folders.state.v1').then(v=>JSON.stringify(v))`), originalLegacy);
  });
  await test('right-side tabs work and horizontal tabs receive no folder UI', async () => {
    await c.evaluate(`(()=>{vivaldi.prefs.set({path:'vivaldi.tabs.bar.position',value:'right'});return true})()`);
    await wait(`(async()=>{await ArcWorkspaceFolders.refresh();return chrome.extension.getViews().some(v=>v.document.querySelector('#tabs-tabbar-container.right .awf-folder'))})()`, 'right-side folders');
    await writeFile('.local/workspace-native-right.png', Buffer.from((await ui.send('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
    await c.evaluate(`(()=>{vivaldi.prefs.set({path:'vivaldi.tabs.bar.position',value:'top'});return true})()`);
    await wait(`(async()=>{await ArcWorkspaceFolders.refresh();return ArcWorkspaceFolders.windowCount===0})()`, 'horizontal no-op');
    assert.equal(await ui.evaluate('document.querySelectorAll(".awf-layer,.awf-tab-row").length'), 0);
    await c.evaluate(`(()=>{vivaldi.prefs.set({path:'vivaldi.tabs.bar.position',value:'left'});return true})()`); await scope(A);
  });
  await test('unknown native row layouts leave the native list unmodified', async () => {
    await ui.evaluate(`(()=>{const n=document.createElement('div');n.className='tab-position';n.id='awf-test-unsupported';document.querySelector('.tab-strip').append(n);return true})()`);
    await c.evaluate('ArcWorkspaceFolders.refresh().then(()=>true)'); assert.equal(await ui.evaluate('document.querySelectorAll(".awf-tab-row,.awf-folder").length'), 0);
    await ui.evaluate(`document.querySelector('#awf-test-unsupported').remove()`); await scope(A);
  });
  await test('private windows and private-main initialization are excluded', async () => {
    await c.evaluate(`chrome.windows.create({incognito:true,url:'about:blank',focused:false})`);
    let privateMain;
    for (let i = 0; i < 80 && !privateMain; i++) {
      for (const target of (await targets(profile)).filter(t => t.url.endsWith('/main.html'))) {
        const candidate = await connect('/main.html', target.id, profile);
        if (await candidate.evaluate('!!chrome.extension.inIncognitoContext')) { privateMain = candidate; break; } candidate.close();
      }
      if (!privateMain) await pause(80);
    }
    assert.ok(privateMain);
    const ids = await privateMain.evaluate(`chrome.windows.getAll({}).then(ws=>ws.filter(w=>w.incognito).map(w=>w.id))`);
    try {
      await privateMain.evaluate('globalThis.__ArcWorkspaceIsolatedPrototype=true'); await privateMain.evaluate(source);
      assert.equal(await privateMain.evaluate('globalThis.ArcWorkspaceFolders?.windowCount??0'), 0);
      assert.equal(await privateMain.evaluate(`chrome.extension.getViews().some(v=>v.document.querySelector('.awf-folder'))`), false);
    } finally { for (const id of ids) await privateMain.evaluate(`chrome.windows.remove(${id})`).catch(() => {}); privateMain.close(); }
  });
  await test('removing a folder keeps its native tabs open', async () => {
    const count = await c.evaluate(`chrome.tabs.query({windowId:${fixtureWindow}}).then(ts=>ts.length)`);
    await c.evaluate(`ArcWorkspaceFolders.removeFolder(${fixtureWindow},${JSON.stringify(parent)}).then(()=>true)`);
    assert.equal(await c.evaluate(`chrome.tabs.query({windowId:${fixtureWindow}}).then(ts=>ts.length)`), count);
  });
  await test('teardown restores native methods and removes all projection UI', async () => {
    await c.evaluate('ArcWorkspaceFolders.destroy();ArcWorkspaceFolders.destroy();true');
    assert.equal(await ui.evaluate('document.querySelectorAll(".awf-layer,.awf-tab-row,.awf-dialog,.awf-toolbar,.awf-tab-grip").length'), 0);
    assert.ok(await ui.evaluate('document.querySelectorAll(".tab-position [role=tab]").length') > 0);
  });
  execFileSync('codesign', ['--verify', '--deep', '--strict', '/Applications/Vivaldi.app'], { encoding: 'utf8', timeout: 60000 });
  console.log('PASS installed app vendor signature remains valid'); console.log(`Workspace browser checks: ${results.length} passed.`);
} catch (error) {
  try { console.error('Native interaction evidence:', JSON.stringify(await c.evaluate(`({menu:globalThis.ArcWorkspaceFolders?.menuSnapshot(),windows:globalThis.ArcWorkspaceFolders?.snapshot().windows})`))); if (ui) await writeFile('.local/workspace-failure.png', Buffer.from((await ui.send('Page.captureScreenshot', { format: 'png' })).data, 'base64')); } catch {}
  throw error;
} finally {
  try {
    await c.evaluate(`(async()=>{
      const wire=globalThis.__awfMenuWire;if(wire)for(const close of [...wire.closeListeners])try{close()}catch{}
      const drag=globalThis.__awfDragWire;if(drag)for(const end of [...drag.endListeners])try{end(true,0,0,0)}catch{}
      globalThis.ArcWorkspaceFolders?.destroy();
      if(wire){vivaldi.contextMenu.show=wire.show;vivaldi.menubarMenu.onClose.addListener=wire.add;vivaldi.menubarMenu.onClose.removeListener=wire.remove;delete globalThis.__awfMenuWire}
      if(drag){vivaldi.tabsPrivate.startDrag=drag.start;vivaldi.tabsPrivate.onDragEnd.addListener=drag.add;vivaldi.tabsPrivate.onDragEnd.removeListener=drag.remove;delete globalThis.__awfDragWire}
      for(const id of ${JSON.stringify(createdTabs)})try{await chrome.tabs.remove(id)}catch{}
      ${originalState === null ? `await chrome.storage.local.remove('${storage}');` : originalState === undefined ? '' : `await chrome.storage.local.set({'${storage}':${JSON.stringify(originalState)}});`}
      ${originalSide ? `vivaldi.prefs.set({path:'vivaldi.tabs.bar.position',value:${JSON.stringify(originalSide)}});` : ''}return true;
    })()`); await inject(); if (fixtureWindow) await scope(A);
  } catch (error) { console.error(`Test cleanup: ${error.message}`); }
  ui?.close(); c.close();
}
