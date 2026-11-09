import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

// Only connect to the throwaway profile created by this project.
export async function targets(profile = 'test-profile') {
  if (!['test-profile', 'workspace-profile'].includes(profile)) throw new Error('Only project-owned test profiles are supported');
  const [portText, browserPath] = (await readFile(resolve('.local', profile, 'DevToolsActivePort'), 'utf8')).trim().split('\n');
  const port = Number(portText);
  if (!Number.isInteger(port) || port < 1 || port > 65535 || !browserPath?.startsWith('/devtools/browser/')) throw new Error('Invalid isolated-profile debugging endpoint');
  const base = `http://127.0.0.1:${port}`;
  const version = await (await fetch(`${base}/json/version`, { signal: AbortSignal.timeout(3000) })).json();
  if (new URL(version.webSocketDebuggerUrl).pathname !== browserPath) throw new Error('Stale test-profile port; refusing to attach to another browser');
  const response = await fetch(`${base}/json/list`, { signal: AbortSignal.timeout(3000) });
  return response.json();
}

export async function connect(suffix = '/main.html', targetId = null, profile = 'test-profile') {
  const candidates = (await targets(profile)).filter(t => t.url === `chrome-extension://mpognobbkildjkofajifpdfhcoklimli${suffix}` && (!targetId || t.id === targetId));
  for (const target of candidates) {
    const client = await connectSocket(target.webSocketDebuggerUrl);
    if (suffix === '/main.html') {
      let context;
      for (let attempt = 0; attempt < 100; attempt++) {
        context = await client.evaluate('({ready:!!globalThis.chrome?.extension?.getViews && !!globalThis.chrome?.storage?.local,private:!!globalThis.chrome?.extension?.inIncognitoContext})').catch(() => null);
        if (context?.ready) break;
        await new Promise(accept => setTimeout(accept, 50));
      }
      if (!context?.ready || (!targetId && context.private)) { client.close(); continue; }
    }
    return client;
  }
  throw new Error(`Isolated Vivaldi target missing: ${suffix}`);
}

async function connectSocket(url) {
  const socket = new WebSocket(url);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  let id = 0;
  const pending = new Map();
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    const entry = pending.get(message.id);
    if (entry) {
      pending.delete(message.id);
      clearTimeout(entry.timer);
      if (message.error) entry.reject(new Error(JSON.stringify(message.error)));
      else entry.resolve(message.result);
    }
  });
  socket.addEventListener('close', () => {
    for (const entry of pending.values()) { clearTimeout(entry.timer); entry.reject(new Error('CDP socket closed')); }
    pending.clear();
  });
  function send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const key = ++id;
      const timer = setTimeout(() => { pending.delete(key); reject(new Error(`CDP timed out: ${method}`)); }, 15000);
      pending.set(key, { resolve, reject, timer });
      socket.send(JSON.stringify({ id: key, method, params }));
    });
  }
  return {
    send,
    async evaluate(expression) {
      const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
      return result.result.value;
    },
    close() { socket.close(); },
  };
}
