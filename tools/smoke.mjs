import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { connect } from './cdp.mjs';

// Real Vivaldi UI integration; restricted by cdp.mjs to this project's test profile.
const source = await readFile('dist/arc-folders.js', 'utf8');
const main = await connect();
let app;
const createdTabs = [];
const STORAGE_KEY = 'arc-folders.state.v1';
const keep = process.argv.includes('--keep-demo');
let original;
const evaluate = expression => main.evaluate(expression);
const ui = code => evaluate(`(async()=>{const v=chrome.extension.getViews().find(v=>v.vivaldiWindowId && v.document.querySelector('#arc-folders'));if(!v)throw Error('Sidebar window missing');const d=v.document;${code}})()`);
async function wait(expression, message) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await evaluate(expression)) return;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error(message);
}
async function click(label) {
  await ui(`const b=[...d.querySelectorAll('#arc-folders button,.af-dialog[open] button')].find(n=>n.getAttribute('aria-label')===${JSON.stringify(label)}||n.textContent===${JSON.stringify(label)});if(!b)throw Error('Button missing: '+${JSON.stringify(label)});b.focus();b.click();`);
}
async function name(value) {
  await wait(`chrome.extension.getViews().some(v=>v.document.querySelector('.af-dialog[open] input[name="folder-name"]'))`, 'Name dialog missing');
  await ui(`const f=d.querySelector('.af-dialog[open] form');f.elements.namedItem('folder-name').value=${JSON.stringify(value)};f.requestSubmit();`);
  await wait(`!chrome.extension.getViews().some(v=>v.document.querySelector('.af-dialog[open]'))`, 'Name dialog did not close');
}
const folderId = name => evaluate(`ArcFolders.state.folders.find(f=>f.name===${JSON.stringify(name)})?.id`);
async function screenshot(name) {
  app ||= await connect('/window.html');
  const image = await app.send('Page.captureScreenshot', { format: 'png' });
  await mkdir('.local/screenshots', { recursive: true });
  await writeFile(`.local/screenshots/${name}.png`, Buffer.from(image.data, 'base64'));
}
try {
  original = await evaluate(`chrome.storage.local.get(${JSON.stringify(STORAGE_KEY)})`);
  await evaluate(source);
  await evaluate('ArcFolders.ready.then(()=>true)');
  await wait(`ArcFolders.windowCount===1`, 'Expected one isolated browser sidebar');
  assert.equal(await ui(`return d.querySelectorAll('#arc-folders').length;`), 1);
  const bounds = await ui(`const r=d.querySelector('#arc-folders').getBoundingClientRect();return {width:r.width,height:r.height,tree:d.querySelector('.af-tree').getBoundingClientRect().height};`);
  assert.ok(bounds.width >= 190 && bounds.height > 300 && bounds.tree > 100, JSON.stringify(bounds));
  assert.ok(await ui(`return !!d.querySelector('#tabs-tabbar-container');`), 'Native tabs must remain available');
  console.log('PASS 1/5 — mounts in real Vivaldi, retains native tabs');

  await click('New folder');
  await name('Work');
  const work = await folderId('Work');
  assert.ok(work);
  await click('Options for Work'); await click('New subfolder'); await name('Research');
  const research = await folderId('Research');
  assert.equal(await evaluate(`ArcFolders.state.folders.find(f=>f.id===${JSON.stringify(research)}).parentId`), work);
  const created = await evaluate(`(async()=>{const w=(await chrome.windows.getAll({windowTypes:['normal']}))[0];return chrome.tabs.create({windowId:w.id,url:'data:text/html,%3Ctitle%3EFolder%20test%3C/title%3E%3Ch1%3ELocal%20folder%20test%3C/h1%3E'});})()`);
  createdTabs.push(created.id);
  await wait(`chrome.extension.getViews().some(v=>[...v.document.querySelectorAll('#arc-folders .af-tab .af-label')].some(n=>n.textContent==='Folder test'))`, 'Synthetic tab missing from sidebar');
  await click('Move Folder test to folder');
  await ui(`const f=d.querySelector('.af-dialog[open] form');f.elements.namedItem('destination').value=${JSON.stringify(research)};f.requestSubmit();`);
  await wait(`Object.values(ArcFolders.state.tabs).some(p=>p.folderId===${JSON.stringify(research)})`, 'Tab placement not saved');
  await wait(`!chrome.extension.getViews().some(v=>v.document.querySelector('.af-dialog[open]'))`, 'Move dialog did not close');
  await wait(`chrome.extension.getViews().some(v=>v.document.activeElement?.dataset.focusKey?.startsWith('move:'))`, 'Move dialog must restore focus to the rerendered opener');
  await click('Work');
  await wait(`!chrome.extension.getViews().some(v=>v.document.querySelector('#arc-folders [data-folder-id="${research}"]'))`, 'Collapse failed');
  await click('Work');
  await wait(`chrome.extension.getViews().some(v=>v.document.querySelector('#arc-folders [data-folder-id="${research}"]'))`, 'Expand failed');
  console.log('PASS 2/5 — creates nested folders, moves live tab, collapses and expands');
  await screenshot('nested-folders');

  // The browser supplies real DataTransfer/DragEvent objects to the shipped handler.
  await ui(`const row=[...d.querySelectorAll('[data-drag="tab"]')].find(r=>r.querySelector('.af-label')?.textContent==='Folder test');const target=d.querySelector('[data-drag="folder"][data-key="${work}"]');const dt=new v.DataTransfer();row.dispatchEvent(new v.DragEvent('dragstart',{bubbles:true,dataTransfer:dt}));target.dispatchEvent(new v.DragEvent('dragover',{bubbles:true,cancelable:true,dataTransfer:dt}));target.dispatchEvent(new v.DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:dt}));row.dispatchEvent(new v.DragEvent('dragend',{bubbles:true,dataTransfer:dt}));`);
  await wait(`Object.values(ArcFolders.state.tabs).some(p=>p.folderId===${JSON.stringify(work)})`, 'Drag-and-drop handler failed');
  // Reload the mod without a page refresh: storage must persist and duplicate mounts must not remain.
  const saved = await evaluate('JSON.stringify(ArcFolders.state)');
  await evaluate(source); await evaluate('ArcFolders.ready.then(()=>true)');
  assert.equal(await evaluate('JSON.stringify(ArcFolders.state)'), saved);
  assert.equal(await ui(`return d.querySelectorAll('#arc-folders').length;`), 1);
  assert.equal(await ui(`return d.querySelectorAll('style[data-arc-folders]').length;`), 1);
  const stored = await evaluate(`chrome.storage.local.get(${JSON.stringify(STORAGE_KEY)})`);
  assert.ok(!JSON.stringify(stored).includes('data:text/html'), 'Folder storage must not retain tab URLs');
  // A real pointer drag must also handle a never-filed loose tab as its target.
  app ||= await connect('/window.html');
  const points = await ui(`const rows=[...d.querySelectorAll('#arc-folders .af-tab')];const from=rows.find(r=>r.querySelector('.af-label')?.textContent==='Folder test');const to=rows.find(r=>r.querySelector('.af-label')?.textContent==='about:blank');if(!from||!to)throw Error('Pointer drag fixtures missing');const p=r=>{const b=r.querySelector('.af-item').getBoundingClientRect();return{x:b.x+Math.min(80,b.width/2),y:b.y+b.height/2}};return{from:p(from),to:p(to),key:from.dataset.key,before:to.dataset.key};`);
  await app.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...points.from });
  await app.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...points.from, button: 'left', buttons: 1, clickCount: 1 });
  for (let step = 1; step <= 12; step++) {
    await app.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: points.from.x + (points.to.x - points.from.x) * step / 12, y: points.from.y + (points.to.y - points.from.y) * step / 12, button: 'left', buttons: 1 });
  }
  await app.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...points.to, button: 'left', buttons: 0, clickCount: 1 });
  await wait(`ArcFolders.state.tabs[${JSON.stringify(points.key)}]?.folderId===null && !!ArcFolders.state.tabs[${JSON.stringify(points.before)}]`, 'Real pointer drag to a never-filed loose tab failed');
  const order = await evaluate(`({from:ArcFolders.state.tabs[${JSON.stringify(points.key)}].order,to:ArcFolders.state.tabs[${JSON.stringify(points.before)}].order})`);
  assert.ok(order.from < order.to, 'Dropped tab must precede the loose target');
  console.log('PASS 3/5 — real pointer drag, first-use reorder, persistent reload, no duplicate mounts or saved URLs');

  // Real CDP key input checks native focus traversal, not just a synthetic key handler.
  await click('New folder');
  app ||= await connect('/window.html');
  for (let index = 0; index < 9; index++) {
    await app.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
    await app.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
    assert.ok(await ui(`return !!d.activeElement.closest('.af-dialog[open]');`), `Focus escaped at forward Tab ${index}`);
  }
  for (let index = 0; index < 9; index++) {
    await app.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', modifiers: 8, windowsVirtualKeyCode: 9 });
    await app.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', modifiers: 8, windowsVirtualKeyCode: 9 });
    assert.ok(await ui(`return !!d.activeElement.closest('.af-dialog[open]');`), `Focus escaped at reverse Tab ${index}`);
  }
  await app.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await app.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await wait(`!chrome.extension.getViews().some(v=>v.document.querySelector('.af-dialog[open]'))`, 'Escape did not dismiss dialog');
  console.log('PASS 4/5 — native Tab / Shift+Tab stays in dialog; Escape dismisses');

  const before = await evaluate('(async()=> (await chrome.tabs.query({})).length)()');
  await click('Options for Work'); await click('Remove folder (keep tabs)');
  await wait(`!ArcFolders.state.folders.some(f=>f.id===${JSON.stringify(work)})`, 'Folder removal failed');
  assert.equal(await evaluate(`ArcFolders.state.folders.find(f=>f.id===${JSON.stringify(research)}).parentId`), null);
  assert.equal(await evaluate('(async()=> (await chrome.tabs.query({})).length)()'), before, 'Removing folder must never close tabs');
  console.log('PASS 5/5 — removing folder preserves open tabs and unwraps subfolders');
  console.log('Screenshot: .local/screenshots/nested-folders.png');
} finally {
  if (!keep && original) {
    await evaluate(`(async()=>{await chrome.storage.local.remove(${JSON.stringify(STORAGE_KEY)});const old=${JSON.stringify(original)};if(Object.keys(old).length)await chrome.storage.local.set(old);})()`).catch(() => {});
    if (createdTabs.length) await evaluate(`chrome.tabs.remove(${JSON.stringify(createdTabs)})`).catch(() => {});
    await evaluate(source).catch(() => {});
    await evaluate('ArcFolders.ready.then(()=>true)').catch(() => {});
  }
  app?.close(); main.close();
}
