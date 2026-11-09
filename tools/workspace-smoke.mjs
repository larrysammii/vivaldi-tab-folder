// Only workspace-qa-profile is used; the interactive workspace-profile is untouched.
// Native OS menu selection is
// simulated after a REAL right-click produces the actual native-menu payload.
// Native OS drag entry is intercepted; the browser's serialized drop is then delivered.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { connect, targets } from './cdp.mjs';

execFileSync(process.execPath, ['tools/launch-workspace.mjs', '--qa-profile', '--probe'], { encoding: 'utf8', timeout: 60000 });
const source = await readFile('.local/workspace-folders.js', 'utf8');
const profile = 'workspace-qa-profile', storage = 'arc-folders.workspace-prototype.v1';
// Fresh native workspaces and a dedicated window prevent previous trial sessions
// or restored native tab IDs from contaminating an interaction test.
const A = Date.now(), B = A + 1;
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
  return ui.evaluate(`(()=>{const n=[...document.querySelectorAll(${JSON.stringify(selector)})].find(n=>{const r=n.getBoundingClientRect();return r.width&&r.height});if(!n)throw new Error('Visible control not found');n.scrollIntoView({block:'nearest',inline:'nearest'});const r=n.getBoundingClientRect();return{x:r.x+Math.min(80,r.width/2),y:${bottom ? 'r.bottom-20' : 'r.y+r.height/2'}}})()`);
}
async function click(selector, button = 'left', bottom = false) {
  let p = await point(selector, bottom);
  await ui.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...p });
  // Native hover/active-tab rendering can move a close button after the first
  // pointer move. Press at its settled position, not the stale pre-hover rectangle.
  await pause(40); p = await point(selector, bottom);
  const hit = await ui.evaluate(`(()=>{const n=document.elementFromPoint(${p.x},${p.y});return{matched:!!n?.closest(${JSON.stringify(selector)}),className:n?.className,dragRows:document.querySelectorAll('.awf-dragging').length}})()`);
  assert.equal(hit.matched,true,`native click target must be hit-testable: ${selector} (${JSON.stringify(hit)})`);
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
  if (['New Folder', 'New Subfolder', 'Rename Folder', 'Move Folder'].includes(label)) await wait(`chrome.extension.getViews().some(v=>!!v.document.querySelector('.awf-name-input,.awf-dialog[open]'))`, 'folder editor');
}
async function withLifecyclePages(action) {
  const server = createServer((request, response) => {
    const name = request.url === '/first' ? 'First new-tab page' : request.url === '/second' ? 'Second new-tab page' : null;
    if (!name) { response.writeHead(404); response.end(); return; }
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    response.end(`<title>${name}</title><h1>Synthetic lifecycle fixture</h1><script>setTimeout(()=>document.title=${JSON.stringify(`${name} — updated`)},150)</script>`);
  });
  try {
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    return await action(`http://127.0.0.1:${server.address().port}`);
  } finally {
    server.closeAllConnections();
    if (server.listening) await new Promise(resolve => server.close(resolve));
  }
}
async function folders() { return c.evaluate('ArcWorkspaceFolders.snapshot().state.folders'); }
async function hoverFolder(folderId, tabIds, fields = {}) {
  return ui.evaluate(`(()=>{const row=[...document.querySelectorAll('.awf-folder')].find(node=>node.dataset.folderId===${JSON.stringify(folderId)});if(!row)throw new Error('Hover folder missing');const data=new DataTransfer();data.setData('vivaldi/x-tab-entries',JSON.stringify({ids:${JSON.stringify(tabIds)},active:${tabIds[0]},activeIndex:0,dragSource:'main',sourceWindow:${fixtureWindow},...${JSON.stringify(fields)}}));const e=new DragEvent('dragover',{bubbles:true,cancelable:true,dataTransfer:data});row.dispatchEvent(e);return{accepted:e.defaultPrevented,target:document.querySelector('.awf-drop-target')?.dataset.folderId??null,count:document.querySelectorAll('.awf-drop-target').length}})()`);
}
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
  await inject();
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
    const win=await chrome.windows.create({url:'about:blank',focused:true});
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
  await test('New Folder edits the row inline without a naming modal', async () => {
    await menu(`[data-id="tab-${active}"] .tab-header`, 'New Folder');
    assert.equal(await ui.evaluate('document.querySelectorAll(".awf-dialog[open]").length'), 0, 'folder naming must not open a modal');
    assert.equal(await ui.evaluate('document.activeElement?.classList.contains("awf-name-input")'), true);
    await ui.send('Input.insertText', { text: 'Test Research' }); await key('Enter', 'Enter', 13);
    await wait(`ArcWorkspaceFolders.snapshot().state.folders.some(f=>f.name==='Test Research')`, 'context menu folder creation');
    parent = (await folders()).find(f => f.name === 'Test Research').id;
    assert.equal(await ui.evaluate('document.querySelectorAll(".awf-toolbar,.awf-tab-grip,#arc-folders").length'), 0);
  });
  await test('inline drafts keep their input, caret, focus and IME state across refreshes', async () => {
    await menu(`[data-folder-toggle="${parent}"]`, 'Rename Folder');
    await ui.send('Input.insertText', { text: 'Draft Research' });
    await ui.evaluate(`(()=>{const n=document.querySelector('.awf-name-input');globalThis.__awfEditingInput=n;globalThis.__awfNameEvents=[];n.addEventListener('blur',event=>__awfNameEvents.push({type:'blur',connected:n.isConnected,related:event.relatedTarget?.className??null,active:document.activeElement?.className}));n.setSelectionRange(3,3);return true})()`);
    await c.evaluate('ArcWorkspaceFolders.refresh().then(()=>true)'); await pause(1050);
    const extra=await c.evaluate(`chrome.tabs.create({windowId:${fixtureWindow},url:'about:blank',active:false}).then(tab=>tab.id)`);createdTabs.push(extra);
    await c.evaluate('ArcWorkspaceFolders.refresh().then(()=>true)');
    assert.deepEqual(await ui.evaluate(`(()=>{const n=document.querySelector('.awf-name-input');return{same:n===__awfEditingInput,value:n.value,caret:n.selectionStart,focused:document.activeElement===n}})()`),{same:true,value:'Draft Research',caret:3,focused:true});
    await writeFile('.local/workspace-inline-editing.png',Buffer.from((await ui.send('Page.captureScreenshot',{format:'png'})).data,'base64'));
    await ui.evaluate(`document.querySelector('.awf-name-input').dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}))`);
    await key('Enter','Enter',13);
    assert.equal(await ui.evaluate(`!!document.querySelector('.awf-name-input')`),true,'Enter during composition does not save');
    assert.equal((await folders()).find(folder=>folder.id===parent).name,'Test Research');
    await ui.evaluate(`document.querySelector('.awf-name-input').dispatchEvent(new CompositionEvent('compositionend',{bubbles:true}))`);
    await key('Escape','Escape',27);
    assert.equal((await folders()).find(folder=>folder.id===parent).name,'Test Research');
    assert.equal(await ui.evaluate(`document.querySelectorAll('.awf-name-input,.awf-dialog[open]').length`),0);
  });
  await test('click-away saves a rename and Escape discards a new folder row', async () => {
    await menu(`[data-folder-toggle="${parent}"]`,'Rename Folder');await ui.send('Input.insertText',{text:'Research Renamed'});
    await click(`[data-id="tab-${active}"] .tab-header`);
    await wait(`ArcWorkspaceFolders.snapshot().state.folders.find(folder=>folder.id===${JSON.stringify(parent)}).name==='Research Renamed'`,'blur saves inline rename');
    await menu(`[data-folder-toggle="${parent}"]`,'Rename Folder');await ui.send('Input.insertText',{text:'Test Research'});await key('Enter','Enter',13);
    await wait(`ArcWorkspaceFolders.snapshot().state.folders.find(folder=>folder.id===${JSON.stringify(parent)}).name==='Test Research'`,'rename restored');
    await menu(`[data-folder-toggle="${parent}"]`,'New Folder');await ui.send('Input.insertText',{text:'Never saved'});
    const draft=await ui.evaluate(`document.querySelector('.awf-name-input').closest('.awf-folder').dataset.folderId`);
    assert.equal((await folders()).some(folder=>folder.id===draft),false,'provisional row is not persisted');
    await key('Escape','Escape',27);
    assert.equal(await ui.evaluate(`document.querySelectorAll('.awf-name-input').length`),0);
    assert.equal((await folders()).some(folder=>folder.id===draft),false);
  });
  await test('empty new names keep a default on click-away and invalid renames stay inline',async()=>{
    await menu(`[data-folder-toggle="${parent}"]`,'New Folder');
    const draft=await ui.evaluate(`(()=>{const n=document.querySelector('.awf-name-input');n.value='';return n.closest('.awf-folder').dataset.folderId})()`);
    await click(`[data-id="tab-${active}"] .tab-header`);await wait(`ArcWorkspaceFolders.snapshot().state.folders.some(folder=>folder.id===${JSON.stringify(draft)}&&folder.name==='Untitled')`,'empty name keeps Untitled');
    await c.evaluate(`ArcWorkspaceFolders.removeFolder(${fixtureWindow},${JSON.stringify(draft)}).then(()=>true)`);
    await menu(`[data-folder-toggle="${parent}"]`,'Rename Folder');await ui.evaluate(`document.querySelector('.awf-name-input').value=''`);await key('Enter','Enter',13);
    assert.equal(await ui.evaluate(`document.querySelector('.awf-name-input').getAttribute('aria-invalid')`),'true');assert.equal((await folders()).find(folder=>folder.id===parent).name,'Test Research');
    await key('Escape','Escape',27);assert.equal(await ui.evaluate(`document.activeElement?.dataset.folderToggle`),parent);
  });
  await test('failed name saves retain the editable draft and do not change stored folders',async()=>{
    await menu(`[data-folder-toggle="${parent}"]`,'Rename Folder');await ui.send('Input.insertText',{text:'Unsaved rename'});
    await c.evaluate(`(()=>{globalThis.__awfNameStorageSet=chrome.storage.local.set;chrome.storage.local.set=function(value){if(Object.hasOwn(value,'${storage}'))return Promise.reject(new Error('Synthetic name save failure'));return __awfNameStorageSet.call(this,value)};return true})()`);
    try{
      await key('Enter','Enter',13);
      await wait(`chrome.extension.getViews().some(view=>view.document.querySelector('.awf-name-input[aria-invalid="true"]'))`,'inline save error');
      assert.equal(await ui.evaluate(`document.querySelector('.awf-name-input').value`),'Unsaved rename');
      assert.equal((await folders()).find(folder=>folder.id===parent).name,'Test Research');
      assert.equal(await c.evaluate(`chrome.storage.local.get('${storage}').then(value=>value['${storage}'].folders.find(folder=>folder.id===${JSON.stringify(parent)}).name)`),'Test Research');
    }finally{await c.evaluate(`chrome.storage.local.set=globalThis.__awfNameStorageSet;delete globalThis.__awfNameStorageSet;true`)}
    await key('Escape','Escape',27);
  });
  await test('workspace changes cancel an inline draft instead of saving into another workspace',async()=>{
    await menu(`[data-folder-toggle="${parent}"]`,'New Folder');await ui.send('Input.insertText',{text:'Wrong workspace draft'});
    const draft=await ui.evaluate(`document.querySelector('.awf-name-input').closest('.awf-folder').dataset.folderId`);
    await scope(B);assert.equal(await ui.evaluate(`document.querySelectorAll('.awf-name-input').length`),0);assert.equal((await folders()).some(folder=>folder.id===draft),false);await scope(A);
  });
  await test('right-click folder creates nested folders using the native popup API', async () => {
    // Native workspace switches legitimately remount tab nodes. Measure ownership
    // across this edit, not across the preceding native workspace transition.
    await ui.evaluate(`globalThis.__awfOriginalNodes=new Map([...document.querySelectorAll('.tab-position [role="tab"][data-id]')].map(node=>[node.dataset.id,node]))`);
    await c.evaluate(`ArcWorkspaceFolders.setCollapsed(${fixtureWindow},${JSON.stringify(parent)},true).then(()=>true)`);
    await menu(`[data-folder-toggle="${parent}"]`, 'New Subfolder');
    await ui.send('Input.insertText', { text: 'Test Nested' }); await key('Enter', 'Enter', 13);
    await wait(`ArcWorkspaceFolders.snapshot().state.folders.some(f=>f.name==='Test Nested')`, 'subfolder');
    child = (await folders()).find(f => f.name === 'Test Nested').id;
    assert.equal(await c.evaluate('__awfMenuWire.last.forceViews'), false);
    assert.equal(await ui.evaluate(`document.querySelector('[data-id="tab-${active}"]')===__awfOriginalNodes.get('tab-${active}')`), true);
  });
  await test('a valid native drag-over visibly highlights the folder before release', async () => {
    const highlighted = await ui.evaluate(`(()=>{
      const row=[...document.querySelectorAll('.awf-folder')].find(node=>node.dataset.folderId===${JSON.stringify(child)});
      const data=new DataTransfer();data.setData('vivaldi/x-tab-entries',JSON.stringify({ids:[${active}],active:${active},activeIndex:0,dragSource:'main',sourceWindow:${fixtureWindow}}));
      row.dispatchEvent(new DragEvent('dragover',{bubbles:true,cancelable:true,dataTransfer:data}));
      return row.classList.contains('awf-drop-target');
    })()`);
    assert.equal(highlighted, true, 'valid folder must visibly accept the tab before drop');
    await writeFile('.local/workspace-drop-highlight.png',Buffer.from((await ui.send('Page.captureScreenshot',{format:'png'})).data,'base64'));
    await ui.evaluate(`document.querySelector('.awf-drop-target')?.dispatchEvent(new DragEvent('dragleave',{bubbles:true}))`);
  });
  await test('border-only drag feedback switches targets and clears on exit, cancellation and invalid payloads',async()=>{
    const neutral=await ui.evaluate(`(()=>{const n=[...document.querySelectorAll('.awf-folder')].find(n=>n.dataset.folderId===${JSON.stringify(child)}),s=getComputedStyle(n);return{background:s.backgroundColor,color:s.color,shadow:s.boxShadow,countOpacity:getComputedStyle(n.querySelector('.awf-folder-count')).opacity}})()`);
    assert.deepEqual(await hoverFolder(child,[active]),{accepted:true,target:child,count:1});
    const style=await ui.evaluate(`(()=>{const n=document.querySelector('.awf-drop-target'),s=getComputedStyle(n);return{outline:s.outlineStyle,width:s.outlineWidth,background:s.backgroundColor,color:s.color,shadow:s.boxShadow,countOpacity:getComputedStyle(n.querySelector('.awf-folder-count')).opacity}})()`);assert.equal(style.outline,'solid');assert.equal(style.width,'2px');
    assert.deepEqual({background:style.background,color:style.color,shadow:style.shadow,countOpacity:style.countOpacity},neutral,'drag feedback must change only the border, not the fill, text, shadow or count');
    assert.deepEqual(await hoverFolder(parent,[active]),{accepted:true,target:parent,count:1});
    await c.evaluate('ArcWorkspaceFolders.refresh().then(()=>true)');assert.equal(await ui.evaluate(`document.querySelector('.awf-drop-target')?.dataset.folderId`),parent,'refresh does not erase active drag feedback');
    await ui.evaluate(`document.querySelector('.awf-drop-target').dispatchEvent(new DragEvent('dragleave',{bubbles:true}))`);assert.equal(await ui.evaluate(`document.querySelectorAll('.awf-drop-target').length`),0);
    // Vivaldi may itself preventDefault on unsupported drags; the prototype must
    // not advertise them as valid targets, regardless of the host's event default.
    assert.equal((await hoverFolder(child,[active],{sourceWindow:fixtureWindow+1})).target,null);assert.equal(await ui.evaluate(`document.querySelectorAll('.awf-drop-target').length`),0);
    assert.equal((await hoverFolder(child,[active],{active:'invalid'})).target,null);
    assert.equal((await hoverFolder(child,[2147483647])).target,null);
    await hoverFolder(child,[active]);await key('Escape','Escape',27);assert.equal(await ui.evaluate(`document.querySelectorAll('.awf-drop-target').length`),0);
    await hoverFolder(parent,[active]);await ui.evaluate(`document.querySelector('.awf-drop-target').dispatchEvent(new DragEvent('dragend',{bubbles:true}))`);assert.equal(await ui.evaluate(`document.querySelectorAll('.awf-drop-target').length`),0);
  });
  await test('internal pointer drags and protected native drags share valid-only feedback',async()=>{
    const result=await c.evaluate(`(()=>{
      const view=chrome.extension.getViews().find(view=>view.vivaldiWindowId===${fixtureWindow}),doc=view.document;
      const row=[...doc.querySelectorAll('.awf-folder')].find(node=>node.dataset.folderId===${JSON.stringify(child)}),controller=ArcWorkspaceNative.findDragController(doc.querySelector('.tab-strip')),before=controller.state;
      try{
        controller.state={...before,dragMode:'internal',draggedPages:[{id:${active}}]};
        const r=row.getBoundingClientRect();view.dispatchEvent(new view.MouseEvent('mousemove',{clientX:r.x+20,clientY:r.y+r.height/2,buttons:1,bubbles:true}));
        const internal=row.classList.contains('awf-drop-target');view.dispatchEvent(new view.MouseEvent('mouseup',{clientX:r.x+20,clientY:r.y+r.height/2,bubbles:true}));
        const cleared=!row.classList.contains('awf-drop-target');
        controller.state={...before,dragMode:'detached',draggedPages:[{id:${active}}]};
        const data=new view.DataTransfer();data.setData('vivaldi/x-tab-entries','');row.dispatchEvent(new view.DragEvent('dragover',{dataTransfer:data,bubbles:true,cancelable:true}));
        const protectedHover=row.classList.contains('awf-drop-target');
        controller.state={...before,dragMode:'detached',draggedPages:[{id:2147483647}]};row.dispatchEvent(new view.DragEvent('dragover',{dataTransfer:data,bubbles:true,cancelable:true}));
        return{internal,cleared,protectedHover,invalid:row.classList.contains('awf-drop-target')};
      }finally{controller.state=before;view.dispatchEvent(new view.KeyboardEvent('keydown',{key:'Escape',bubbles:true}))}
    })()`);
    assert.deepEqual(result,{internal:true,cleared:true,protectedHover:true,invalid:false});
  });
  await test('held internal drags follow the cursor without moving folder headers and reset on release',async()=>{
    const result=await c.evaluate(`(()=>{
      const view=chrome.extension.getViews().find(view=>view.vivaldiWindowId===${fixtureWindow}),doc=view.document;
      const tab=doc.querySelector('[data-id="tab-${active}"]'),row=tab.closest('.tab-position'),controller=ArcWorkspaceNative.findDragController(doc.querySelector('.tab-strip')),before=controller.state;
      const r=row.getBoundingClientRect(),header=doc.querySelector('.awf-folder'),headerTop=header.getBoundingClientRect().top,x=r.left+50,y=r.top+r.height/2;
      // The native controller is the external boundary. Suppress its mousedown
      // receiver in this deterministic state test; real native holds are checked separately.
      const stopNative=event=>event.stopImmediatePropagation();doc.addEventListener('mousedown',stopNative,true);
      try{
        tab.dispatchEvent(new view.MouseEvent('mousedown',{clientX:x,clientY:y,button:0,buttons:1,bubbles:true}));doc.removeEventListener('mousedown',stopNative,true);
        controller.state={...before,dragMode:'internal',draggedPages:[{id:${active}}]};
        view.dispatchEvent(new view.MouseEvent('mousemove',{clientX:x,clientY:y+12,buttons:1,bubbles:true}));const moved=row.getBoundingClientRect().top-r.top;
        view.dispatchEvent(new view.MouseEvent('mousemove',{clientX:x,clientY:y+12,buttons:1,bubbles:true}));const held=row.getBoundingClientRect().top-r.top;
        const headerDelta=header.getBoundingClientRect().top-headerTop;
        view.dispatchEvent(new view.MouseEvent('mouseup',{clientX:x,clientY:y+12,button:0,bubbles:true}));
        return{moved,held,headerDelta,reset:!row.classList.contains('awf-dragging')&&!row.style.getPropertyValue('--awf-drag-y'),restored:row.getBoundingClientRect().top-r.top};
      }finally{doc.removeEventListener('mousedown',stopNative,true);controller.state=before;view.dispatchEvent(new view.KeyboardEvent('keydown',{key:'Escape',bubbles:true}))}
    })()`);
    assert.deepEqual(result,{moved:12,held:12,headerDelta:0,reset:true,restored:0});
  });
  await test('workspace switches and folder removal clear highlighted destinations',async()=>{
    await hoverFolder(child,[active]);await scope(B);assert.equal(await ui.evaluate(`document.querySelectorAll('.awf-drop-target').length`),0);await scope(A);
    await c.evaluate(`ArcWorkspaceFolders.createFolder(${fixtureWindow},'Temporary drop target').then(()=>true)`);const temporary=(await folders()).find(folder=>folder.name==='Temporary drop target').id;
    await hoverFolder(temporary,[active]);await c.evaluate(`ArcWorkspaceFolders.removeFolder(${fixtureWindow},${JSON.stringify(temporary)}).then(()=>true)`);assert.equal(await ui.evaluate(`document.querySelectorAll('.awf-drop-target').length`),0);await c.evaluate('ArcWorkspaceFolders.refresh().then(()=>true)');
  });
  await test('native dragging highlights the destination before drop and keeps closed folders closed', async () => {
    await c.evaluate(`ArcWorkspaceFolders.setCollapsed(${fixtureWindow},${JSON.stringify(child)},true).then(()=>true)`);
    await c.evaluate('__awfDragWire.last=null');
    await drag(`[data-id="tab-${active}"] .tab-header`, `[data-folder-toggle="${child}"]`);
    const request = await c.evaluate(`__awfDragWire.last&&({mimeType:__awfDragWire.last.mimeType,customData:__awfDragWire.last.customData})`);
    if (request) {
      assert.equal(request.mimeType, 'vivaldi/x-tab-entries');
      const target = await point(`[data-folder-toggle="${child}"]`);
      const data = { items: [{ mimeType: request.mimeType, data: request.customData }], dragOperationsMask: 16 };
      for (const type of ['dragEnter', 'dragOver']) await ui.send('Input.dispatchDragEvent', { type, ...target, data });
      assert.equal(await ui.evaluate(`document.querySelector('.awf-drop-target')?.dataset.folderId`), child, 'valid folder must visibly accept the tab before drop');
      assert.equal(await ui.evaluate(`document.querySelectorAll('.awf-drop-target').length`), 1);
      await writeFile('.local/workspace-drop-highlight.png', Buffer.from((await ui.send('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
      await ui.send('Input.dispatchDragEvent', { type: 'drop', ...target, data });
      await c.evaluate(`(()=>{for(const end of [...__awfDragWire.endListeners])end(false,0,0,${fixtureWindow});return true})()`);
    }
    await placedIn(active, child);
    assert.equal((await folders()).find(folder=>folder.id===child).collapsed, true, 'drop must not open a closed folder');
    assert.equal(await ui.evaluate('document.querySelectorAll(".awf-drop-target").length'), 0, 'drop clears feedback');
    await c.evaluate(`ArcWorkspaceFolders.setCollapsed(${fixtureWindow},${JSON.stringify(child)},false).then(()=>true)`);
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
    await c.evaluate(`chrome.windows.update(${fixtureWindow},{focused:true}).then(()=>true)`);
    await ui.send('Page.bringToFront');
    await c.evaluate('ArcWorkspaceFolders.refresh().then(()=>true)'); await click(`[data-id="tab-${extra}"] .tab-header`);
    await wait(`chrome.tabs.get(${extra}).then(t=>t.active)`, 'native tab activation'); await click(`[data-id="tab-${extra}"] button.close`);
    await wait(`chrome.tabs.query({windowId:${fixtureWindow}}).then(ts=>!ts.some(t=>t.id===${extra}))`, 'native close');
  });
  await test('native + → navigation/title update → folder drag → close works on the same new tab', () => withLifecyclePages(async base => {
    await c.evaluate(`chrome.tabs.update(${active},{active:true}).then(()=>true)`);
    const before=await c.evaluate(`chrome.tabs.query({windowId:${fixtureWindow}}).then(tabs=>tabs.map(tab=>tab.id))`);
    await click('#tabs-tabbar-container button[aria-label="New Tab"]');
    await wait(`chrome.tabs.query({windowId:${fixtureWindow}}).then(tabs=>tabs.some(tab=>!${JSON.stringify(before)}.includes(tab.id)))`,'native new-tab button');
    const fresh=await c.evaluate(`chrome.tabs.query({windowId:${fixtureWindow}}).then(tabs=>tabs.filter(tab=>!${JSON.stringify(before)}.includes(tab.id)).map(tab=>({id:tab.id,active:tab.active,workspaceId:JSON.parse(tab.vivExtData||'{}').workspaceId})))`);
    assert.equal(fresh.length,1);assert.equal(fresh[0].active,true);assert.equal(fresh[0].workspaceId,A);createdTabs.push(fresh[0].id);
    await c.evaluate('ArcWorkspaceFolders.refresh().then(()=>true)');
    assert.equal(await ui.evaluate(`(()=>{const row=document.querySelector('[data-id="tab-${fresh[0].id}"]')?.closest('.tab-position');return !!row&&getComputedStyle(row).display!=='none'&&row.getBoundingClientRect().height>0})()`),true);
    const id = fresh[0].id;
    await ui.evaluate(`globalThis.__awfNewTabNode=document.querySelector('[data-id="tab-${id}"]');true`);
    // Navigation goes through the real browser, not a title/DOM stub. Each page
    // also changes its title asynchronously, exercising the native update path.
    for (const [path, name] of [['/first', 'First new-tab page'], ['/second', 'Second new-tab page']]) {
      const title = `${name} — updated`;
      await c.evaluate(`chrome.tabs.update(${id},{url:${JSON.stringify(`${base}${path}`)}}).then(()=>true)`);
      try {
        await wait(`(async()=>{const tab=await chrome.tabs.get(${id}),view=chrome.extension.getViews().find(v=>v.vivaldiWindowId===${fixtureWindow});return tab.title===${JSON.stringify(title)}&&view.document.querySelector('[data-id="tab-${id}"] .title')?.textContent===${JSON.stringify(title)}})()`, 'navigated page and dynamic native title');
      } catch (error) {
        console.error('Synthetic lifecycle title evidence:', JSON.stringify(await c.evaluate(`(async()=>{const tab=await chrome.tabs.get(${id}),view=chrome.extension.getViews().find(v=>v.vivaldiWindowId===${fixtureWindow});return{apiTitle:tab.title,status:tab.status,nativeTitle:view.document.querySelector('[data-id="tab-${id}"] .title')?.textContent,metadataKeys:Object.keys(JSON.parse(tab.vivExtData||'{}'))}})()`)));
        throw error;
      }
    }
    assert.equal(await ui.evaluate(`document.querySelector('[data-id="tab-${id}"]')===__awfNewTabNode`), true, 'navigation preserves the native tab node');
    await c.evaluate(`ArcWorkspaceFolders.setCollapsed(${fixtureWindow},${JSON.stringify(parent)},false).then(()=>true)`);
    await c.evaluate('__awfDragWire.last=null');
    await drag(`[data-id="tab-${id}"] .tab-header`, `[data-folder-toggle="${parent}"]`);
    const request = await c.evaluate(`__awfDragWire.last&&({mimeType:__awfDragWire.last.mimeType,customData:__awfDragWire.last.customData})`);
    if (request) {
      assert.equal(request.mimeType, 'vivaldi/x-tab-entries');
      const target = await point(`[data-folder-toggle="${parent}"]`);
      const data = { items: [{ mimeType: request.mimeType, data: request.customData }], dragOperationsMask: 16 };
      for (const type of ['dragEnter', 'dragOver', 'drop']) await ui.send('Input.dispatchDragEvent', { type, ...target, data });
      await c.evaluate(`(()=>{for(const end of [...__awfDragWire.endListeners])end(false,0,0,${fixtureWindow});return true})()`);
    }
    await placedIn(id, parent);
    const hover = await point(`[data-id="tab-${id}"] .tab-header`);
    await ui.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...hover }); await pause(40);
    const uuid = await c.evaluate(`chrome.tabs.get(${id}).then(tab=>JSON.parse(tab.vivExtData||'{}').ext_id)`);
    await click(`[data-id="tab-${id}"] button.close`);
    await wait(`chrome.tabs.query({windowId:${fixtureWindow}}).then(tabs=>tabs.some(tab=>JSON.parse(tab.vivExtData||'{}').ext_id===${JSON.stringify(uuid)}&&tab.discarded))`, 'same new folder tab unloads using its native button');
    const unloadedId = await c.evaluate(`chrome.tabs.query({windowId:${fixtureWindow}}).then(tabs=>tabs.find(tab=>JSON.parse(tab.vivExtData||'{}').ext_id===${JSON.stringify(uuid)}).id)`);
    await wait(`(async()=>{await ArcWorkspaceFolders.refresh();return ArcWorkspaceFolders.snapshot().windows.find(w=>w.id===${fixtureWindow})?.rows.some(row=>row.id===${unloadedId})})()`, 'replacement native row after unload');
    const unloadedHover = await point(`[data-id="tab-${unloadedId}"] .tab-header`);
    await ui.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...unloadedHover }); await pause(40);
    await click(`[data-id="tab-${unloadedId}"] button.close`);
    await wait(`chrome.tabs.query({windowId:${fixtureWindow}}).then(tabs=>!tabs.some(tab=>JSON.parse(tab.vivExtData||'{}').ext_id===${JSON.stringify(uuid)}))`, 'second close removes the persistent folder entry');
    assert.equal(await c.evaluate(`(()=>{const view=chrome.extension.getViews().find(v=>v.vivaldiWindowId===${fixtureWindow});return !!ArcWorkspaceNative.findDragController(view.document.querySelector('.tab-strip')).state.awaitingEdit})()`), false, 'native drag must not leave a hidden rename pending');
  }));
  await test('reinjection preserves workspace state without altering the old window-wide storage', async () => {
    const before = await c.evaluate('ArcWorkspaceFolders.snapshot().state'); await inject(); await scope(A);
    assert.deepEqual(await c.evaluate('ArcWorkspaceFolders.snapshot().state'), before);
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
    await hoverFolder(child,[active]);assert.equal(await ui.evaluate(`document.querySelectorAll('.awf-drop-target').length`),1);
    await c.evaluate('ArcWorkspaceFolders.destroy();ArcWorkspaceFolders.destroy();true');
    assert.equal(await ui.evaluate('document.querySelectorAll(".awf-layer,.awf-tab-row,.awf-dialog,.awf-toolbar,.awf-tab-grip").length'), 0);
    assert.ok(await ui.evaluate('document.querySelectorAll(".tab-position [role=tab]").length') > 0);
  });
  execFileSync('codesign', ['--verify', '--deep', '--strict', '/Applications/Vivaldi.app'], { encoding: 'utf8', timeout: 60000 });
  console.log('PASS installed app vendor signature remains valid'); console.log(`Workspace browser checks: ${results.length} passed.`);
} catch (error) {
  try { console.error('Native interaction evidence:', JSON.stringify(await c.evaluate(`({menu:globalThis.ArcWorkspaceFolders?.menuSnapshot(),windows:globalThis.ArcWorkspaceFolders?.snapshot().windows})`))); if (ui) { console.error('Editor lifecycle evidence:',JSON.stringify(await ui.evaluate(`({events:globalThis.__awfNameEvents??[],originalConnected:!!globalThis.__awfEditingInput?.isConnected,editor:!!document.querySelector('.awf-name-input'),active:document.activeElement?.className})`))); } if (ui) await writeFile('.local/workspace-failure.png', Buffer.from((await ui.send('Page.captureScreenshot', { format: 'png' })).data, 'base64')); } catch {}
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
      ${fixtureWindow ? `try{await chrome.windows.remove(${fixtureWindow})}catch{};for(const id of [${A},${B}])try{await __awfFixture.actions.removeWorkspace(${fixtureWindow},id)}catch{}` : ''}
      ${originalState === null ? `await chrome.storage.local.remove('${storage}');` : originalState === undefined ? '' : `await chrome.storage.local.set({'${storage}':${JSON.stringify(originalState)}});`}
      ${originalSide ? `vivaldi.prefs.set({path:'vivaldi.tabs.bar.position',value:${JSON.stringify(originalSide)}});` : ''}return true;
    })()`); await inject();
  } catch (error) { console.error(`Test cleanup: ${error.message}`); }
  ui?.close(); c.close();
}
