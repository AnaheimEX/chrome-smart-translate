'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const root = path.join(__dirname, '..');
const source = file => fs.readFileSync(path.join(root, file), 'utf8');
const plain = value => JSON.parse(JSON.stringify(value));
function event() {
  const listeners = [];
  return { addListener(fn) { listeners.push(fn); }, emit(...args) { return listeners.map(fn => fn(...args)); } };
}
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const flush = () => new Promise(resolve => setImmediate(resolve));
function background(saved = {}, overrides = {}) {
  const data = plain(saved), nativeCalls = [], connections = [], timers = new Set();
  const changed = event();
  const chrome = {
    runtime: {
      id: 'test-extension', onInstalled: event(), onConnect: event(), onMessage: event(),
      getURL: name => 'chrome-extension://test-extension/' + name,
      openOptionsPage() {},
      connectNative() {
        const port = {
          onMessage: event(), onDisconnect: event(), disconnected: false,
          postMessage(request) {
            nativeCalls.push(plain(request));
            if (request.action === 'cancel') return;
            const result = overrides.native ? overrides.native(request, port) : ({
              models: { type: 'models', models: [{ id: 'test-model', name: 'Test', isDefault: true }] },
              logout: { type: 'loggedOut' }, prepare: { type: 'ready' },
              translate: { type: 'done', translation: '模拟译文' },
            })[request.action];
            if (result) queueMicrotask(() => port.onMessage.emit({ id: request.id, ...result }));
          },
          disconnect() {
            port.disconnected = true;
            port.onDisconnect.emit();
          },
        };
        connections.push(port);
        return port;
      },
    },
    storage: {
      onChanged: changed,
      local: {
        async get(defaults) { return plain(defaults ? Object.fromEntries(Object.entries(defaults).map(([key, value]) => [key, key in data ? data[key] : value])) : data); },
        async set(values) {
          if (overrides.beforeSet) await overrides.beforeSet(values);
          const changes = {};
          for (const [key, value] of Object.entries(values)) {
            if (JSON.stringify(value) !== JSON.stringify(data[key])) changes[key] = { oldValue: data[key], newValue: value };
            data[key] = plain(value);
          }
          changed.emit(changes, 'local');
        },
        async remove(keys) {
          const changes = {};
          for (const key of Array.isArray(keys) ? keys : [keys]) {
            if (key in data) changes[key] = { oldValue: data[key] };
            delete data[key];
          }
          changed.emit(changes, 'local');
        },
      },
    },
  };
  const context = vm.createContext({
    chrome, crypto: webcrypto, URL, AbortController, TextDecoder, Uint8Array, console,
    fetch: overrides.fetch || (() => { throw new Error('Unexpected network request'); }),
    setTimeout(fn, ms) { const timer = setTimeout(fn, ms); timer.unref(); timers.add(timer); return timer; },
    clearTimeout(timer) { timers.delete(timer); clearTimeout(timer); },
  });
  context.self = context;
  context.importScripts = () => vm.runInContext(source('src/prompt.js'), context);
  vm.runInContext(source('src/background.js'), context);
  const sender = { id: chrome.runtime.id, url: chrome.runtime.getURL('src/options.html') };
  function request(message, from = sender) {
    return new Promise(resolve => {
      const kept = chrome.runtime.onMessage.emit(message, from, result => resolve(plain(result)));
      if (!kept.some(Boolean)) resolve(undefined);
    });
  }
  function translate(text = 'hello', extra = {}) {
    const done = deferred(), messages = [];
    const port = {
      name: 'translate', sender: { id: chrome.runtime.id, url: 'https://example.test/article' },
      onMessage: event(), onDisconnect: event(),
      postMessage(message) {
        messages.push(plain(message));
        if (message.type === 'done' || message.type === 'error') done.resolve(plain(message));
      },
    };
    chrome.runtime.onConnect.emit(port);
    port.onMessage.emit({ type: 'start', text, ...extra });
    return { port, messages, done: done.promise };
  }
  function close() { context.disconnectNative(); for (const timer of timers) clearTimeout(timer); }
  return { data, chrome, context, nativeCalls, connections, request, translate, close };
}
module.exports = { source, plain, event, deferred, flush, background };
