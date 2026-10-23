// Local UI fixture only: mocks Chrome APIs and account operations; no real credentials.
'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
function installFixture() {
  const key = 'smart-translate-ui-fixture';
  if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify({
    provider: 'codex', codexModel: 'mock-model', codexModels: [{ id: 'mock-model', name: 'Mock model' }],
    apiKey: 'fake-test-key', baseUrl: 'https://api.example.test/v1', model: 'mock-api', enabled: true,
  }));
  const getData = () => JSON.parse(localStorage.getItem(key));
  const listeners = () => {
    const fns = [];
    return { addListener: fn => fns.push(fn), emit: (...args) => fns.map(fn => fn(...args)) };
  };
  const changed = listeners();
  function changes(before, after) {
    const values = {};
    for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
      if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) values[key] = { oldValue: before[key], newValue: after[key] };
    }
    changed.emit(values, 'local');
  }
  window.addEventListener('storage', event => {
    if (event.key === key) changes(JSON.parse(event.oldValue || '{}'), JSON.parse(event.newValue || '{}'));
  });
  window.TEST = { nativeCalls: [], nativeFailure: false, getData, openedTabs: [] };
  const runtime = {
    id: 'mock-extension', onInstalled: listeners(), onMessage: listeners(), onConnect: listeners(),
    getURL: name => location.origin + '/' + name,
    openOptionsPage() {},
    sendMessage(message, reply) {
      runtime.onMessage.emit(message, { id: runtime.id, url: location.href }, reply);
    },
    connect({ name }) {
      let disconnected = false;
      const content = { onMessage: listeners(), onDisconnect: listeners() };
      const background = { name, sender: { id: runtime.id, url: location.href }, onMessage: listeners(), onDisconnect: listeners() };
      for (const [from, to] of [[content, background], [background, content]]) {
        from.postMessage = message => queueMicrotask(() => { if (!disconnected) to.onMessage.emit(message); });
        from.disconnect = () => {
          if (disconnected) return;
          disconnected = true;
          content.onDisconnect.emit(); background.onDisconnect.emit();
        };
      }
      runtime.onConnect.emit(background);
      return content;
    },
    connectNative() {
      const port = {
        onMessage: listeners(), onDisconnect: listeners(),
        disconnect() { port.onDisconnect.emit(); },
        postMessage(request) {
          window.TEST.nativeCalls.push(request.action);
          if (request.action === 'cancel') return;
          if (request.action === 'login') {
            window.TEST.completeLogin = () => port.onMessage.emit({ id: request.id, type: 'loggedIn' });
            queueMicrotask(() => port.onMessage.emit({ id: request.id, type: 'loginUrl', url: 'https://auth.openai.com/authorize' }));
            return;
          }
          const result = {
            models: { type: 'models', models: [
              { id: 'mock-model', name: 'Mock model', isDefault: true },
              { id: 'mock-fast', name: 'Mock fast model' },
            ] },
            prepare: { type: 'ready' }, logout: { type: 'loggedOut' },
            translate: { type: 'done', translation: window.TEST.translation || '模拟译文' },
          }[request.action];
          queueMicrotask(() => port.onMessage.emit({
            id: request.id, ...(window.TEST.nativeFailure ? { type: 'error', error: '模拟连接失败' } : result),
          }));
        },
      };
      return port;
    },
  };
  window.chrome = {
    tabs: { async create(tab) { window.TEST.openedTabs.push(tab.url); } },
    runtime,
    storage: {
      onChanged: changed,
      local: {
        async get(defaults) {
          const data = getData();
          return defaults ? Object.fromEntries(Object.entries(defaults).map(([key, value]) => [key, key in data ? data[key] : value])) : data;
        },
        async set(values) {
          const before = getData(), after = { ...before, ...values };
          localStorage.setItem(key, JSON.stringify(after)); changes(before, after);
        },
        async remove(keys) {
          const before = getData(), after = { ...before };
          for (const key of Array.isArray(keys) ? keys : [keys]) delete after[key];
          localStorage.setItem(key, JSON.stringify(after)); changes(before, after);
        },
      },
    },
  };
  window.importScripts = () => {};
  const originalFetch = window.fetch;
  window.fetch = (url, init) => String(url).startsWith('https://api.example.test/')
    ? Promise.resolve(new Response(JSON.stringify({ data: [{ id: 'mock-api' }] }), { headers: { 'content-type': 'application/json' } }))
    : originalFetch(url, init);
}
const server = http.createServer((request, response) => {
  const url = new URL(request.url, 'http://localhost');
  if (url.pathname === '/fixture.js') {
    response.setHeader('Content-Type', 'application/javascript');
    return response.end('(' + installFixture.toString() + ')();');
  }
  const name = url.pathname === '/' ? '/src/options.html' : url.pathname;
  const file = path.resolve(root, '.' + name);
  if (!file.startsWith(root + path.sep) || !/\.(html|js|css|png)$/.test(file)) {
    response.writeHead(404); return response.end();
  }
  try {
    let data = fs.readFileSync(file);
    if (name === '/src/options.html') data = data.toString().replace(
      '<script src="options.js"></script>',
      '<script src="/fixture.js"></script><script src="background.js"></script><script src="options.js"></script>',
    );
    response.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.png': 'image/png' })[path.extname(file)]);
    response.end(data);
  } catch (_) { response.writeHead(404); response.end(); }
});
server.listen(39617, '127.0.0.1', () => console.log('Isolated UI fixture: http://127.0.0.1:39617/src/options.html'));
