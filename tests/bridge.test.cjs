'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const crypto = require('node:crypto');
const http = require('node:http');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { Subscription } = require('../bridge/subscription');
const { source, deferred } = require('./helpers.cjs');
const now = 1800000000000;
const jwt = value => 'header.' + Buffer.from(JSON.stringify(value)).toString('base64url') + '.signature';
const tokenResponse = () => ({ access_token: jwt({ exp: now / 1000 + 3600 }), refresh_token: 'fake-refresh', id_token: jwt({ 'https://api.openai.com/auth': { chatgpt_account_id: 'fake-account' } }) });
function fixture(options = {}) {
  const files = options.files || new Map();
  const reads = [], calls = [];
  const fs = {
    readFileSync(file) { reads.push(file); if (!files.has(file)) throw Object.assign(new Error('missing'), { code: 'ENOENT' }); return files.get(file); },
    writeFileSync(file, value, mode) { assert.equal(mode.mode, 0o600); files.set(file, value); },
    chmodSync(file, mode) { assert.equal(mode, 0o600); },
    renameSync(from, to) { files.set(to, files.get(from)); files.delete(from); },
    unlinkSync(file) { if (!files.delete(file)) throw Object.assign(new Error('missing'), { code: 'ENOENT' }); },
  };
  const app = new Subscription('/extension/tokens.json', { fs, port: 0, now: () => now, ...options,
    async fetch(url, config) { calls.push({ url, ...config }); return options.fetch ? options.fetch(url, config) : Response.json({ models: [{ slug: 'test-model', display_name: 'Test', visibility: 'list', input_modalities: ['text'] }] }); },
  });
  return { app, files, reads, calls };
}
function signedIn(options = {}) {
  const result = fixture(options);
  result.files.set('/extension/tokens.json', JSON.stringify({ accessToken: 'fake-access', refreshToken: 'fake-refresh', accountId: 'fake-account', expiresAt: now + 3600000 }));
  return result;
}
function localGet(url) {
  return new Promise((resolve, reject) => http.get(url, response => {
    let text = '';
    response.setEncoding('utf8');
    response.on('data', chunk => { text += chunk; });
    response.on('end', () => resolve({ status: response.statusCode, text }));
  }).on('error', reject));
}
async function startLogin(app) {
  const announced = deferred(), controller = new AbortController();
  const done = app.login(controller.signal, url => announced.resolve(new URL(url)));
  done.catch(() => {});
  const url = await Promise.race([announced.promise, done.then(() => { throw new Error('Login completed before announcing URL'); })]);
  const callback = new URL(url.searchParams.get('redirect_uri'));
  callback.search = new URLSearchParams({ code: 'fake-code', state: url.searchParams.get('state') });
  return { url, callback, done, controller };
}
test('fresh helper only reads its own token file and never shared credentials', async () => {
  const f = fixture();
  await assert.rejects(f.app.models(new AbortController().signal), /网页授权/);
  assert.deepEqual(f.reads, ['/extension/tokens.json']);
  assert.equal(f.calls.length, 0);
});
test('browser login uses PKCE/state, rejects unrelated callbacks, and persists independent credentials', async () => {
  const f = fixture({ fetch: async () => Response.json(tokenResponse()) });
  const login = await startLogin(f.app);
  assert.equal(login.url.origin, 'https://auth.openai.com');
  assert.equal(login.url.pathname, '/oauth/authorize');
  assert.equal(login.url.searchParams.get('client_id'), 'app_EMoamEEZ73f0CkXaXp7hrann');
  assert.equal(login.url.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(login.url.searchParams.get('state').length, 43);
  const invalid = new URL(login.callback); invalid.searchParams.set('state', 'wrong');
  assert.equal((await localGet(invalid)).status, 400);
  assert.equal(f.calls.length, 0);
  const result = await localGet(login.callback);
  await login.done;
  assert.equal(result.status, 200);
  assert.doesNotMatch(result.text, /fake-code|fake-refresh/);
  const body = new URLSearchParams(f.calls[0].body);
  assert.equal(body.get('grant_type'), 'authorization_code');
  assert.equal(body.get('code'), 'fake-code');
  assert.equal(body.get('redirect_uri'), login.url.searchParams.get('redirect_uri'));
  assert.equal(crypto.createHash('sha256').update(body.get('code_verifier')).digest('base64url'), login.url.searchParams.get('code_challenge'));
  const tokens = JSON.parse(f.files.get('/extension/tokens.json'));
  assert.equal(tokens.accountId, 'fake-account');
  assert.equal(tokens.refreshToken, 'fake-refresh');
  assert.equal(f.files.size, 1);
});
test('cancelled browser token exchange cannot persist credentials', async () => {
  const hold = deferred(), started = deferred();
  const f = fixture({ fetch: async () => { started.resolve(); return hold.promise; } });
  const login = await startLogin(f.app);
  const callback = localGet(login.callback).catch(() => {});
  await started.promise;
  login.controller.abort();
  hold.resolve(Response.json(tokenResponse()));
  await assert.rejects(login.done, { name: 'AbortError' });
  await callback;
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.files.has('/extension/tokens.json'), false);
});
test('logout during token exchange cannot restore signed-in state', async () => {
  const hold = deferred(), started = deferred();
  const f = fixture({ fetch: async () => { started.resolve(); return hold.promise; } });
  const login = await startLogin(f.app);
  const callback = localGet(login.callback).catch(() => {});
  await started.promise;
  f.app.logout();
  hold.resolve(Response.json(tokenResponse()));
  await assert.rejects(login.done, /网页授权/);
  await callback;
  assert.equal(f.files.has('/extension/tokens.json'), false);
});
test('occupied login port reports an error without touching its owner', async t => {
  const server = http.createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const f = fixture({ port: server.address().port });
  await assert.rejects(f.app.login(new AbortController().signal, () => assert.fail('must not authorize before listening')), /端口 1455 已被其他程序占用/);
  assert.equal(server.listening, true);
});
test('refreshes expired credentials, filters and sorts actual text models', async () => {
  const f = signedIn({ fetch: async url => url.includes('/oauth/token') ? Response.json({ ...tokenResponse(), refresh_token: 'rotated-refresh' }) : Response.json({ models: [
    { slug: 'later', visibility: 'list', priority: 5 }, { slug: 'hidden', visibility: 'hide' },
    { slug: 'audio', input_modalities: ['audio'] }, { slug: 'first', priority: 0, input_modalities: ['text'] },
  ] }) });
  const expired = JSON.parse(f.files.get('/extension/tokens.json')); expired.expiresAt = now - 1;
  f.files.set('/extension/tokens.json', JSON.stringify(expired));
  assert.deepEqual((await f.app.models(new AbortController().signal)).map(model => model.slug), ['first', 'later']);
  assert.equal(new URLSearchParams(f.calls[0].body).get('grant_type'), 'refresh_token');
  assert.equal(f.calls[1].headers['ChatGPT-Account-ID'], 'fake-account');
  assert.match(f.calls[1].url, /^https:\/\/chatgpt.com\/backend-api\/codex\/models\?client_version=/);
  assert.equal(JSON.parse(f.files.get('/extension/tokens.json')).refreshToken, 'rotated-refresh');
});
test('HTTP errors do not echo credential-bearing service bodies', async () => {
  const f = signedIn({ fetch: async () => new Response('fake-access fake-refresh secret', { status: 403 }) });
  await assert.rejects(f.app.models(new AbortController().signal), error => /拒绝访问/.test(error.message) && !/fake-|secret/.test(error.message));
});
test('401 refreshes once and retries with the new subscription token', async () => {
  let requests = 0;
  const f = signedIn({ fetch: async url => url.includes('/oauth/token') ? Response.json(tokenResponse()) : ++requests === 1 ? new Response('', { status: 401 }) : Response.json({ models: [{ slug: 'ready' }] }) });
  assert.equal((await f.app.models(new AbortController().signal))[0].slug, 'ready');
  assert.equal(requests, 2);
  assert.notEqual(f.calls[0].headers.Authorization, f.calls[2].headers.Authorization);
});
test('logout deletes only extension tokens and remains signed out on restart', async () => {
  const f = signedIn();
  f.app.logout();
  f.app.logout();
  assert.equal(f.files.size, 0);
  const restarted = fixture({ files: f.files });
  await assert.rejects(restarted.app.models(new AbortController().signal), /网页授权/);
});
function stream(events) {
  const bytes = Buffer.from(events.map(event => 'data: ' + JSON.stringify(event) + '\r\n\r\n').join(''));
  let index = 0;
  return new Response(new ReadableStream({ pull(controller) { if (index >= bytes.length) controller.close(); else controller.enqueue(bytes.subarray(index, index += 7)); } }));
}
for (const levels of [['minimal', 'low'], ['none', 'low'], []]) test('streamed translation preserves prompt and uses supported reasoning: ' + levels, async () => {
  const f = signedIn({ fetch: async url => url.includes('/models?') ? Response.json({ models: [{ slug: 'test-model', supported_reasoning_levels: levels.map(effort => ({ effort })) }] }) : stream([
    { type: 'response.output_item.added', item: { id: 'comment', phase: 'commentary' } },
    { type: 'response.output_text.delta', item_id: 'comment', delta: 'not translation' },
    { type: 'response.output_text.delta', item_id: 'final', delta: '' },
    { type: 'response.output_text.delta', item_id: 'final', delta: '正确' },
    { type: 'response.output_text.delta', item_id: 'final', delta: '译文' },
    { type: 'response.completed', response: { status: 'completed' } },
  ]) });
  const deltas = [];
  const result = await f.app.translate({ model: 'test-model', system: 'Only translate to French.', text: '{"text":"Hello"}' }, new AbortController().signal, text => deltas.push(text), () => {});
  assert.equal(result.translation, '正确译文');
  assert.deepEqual(deltas, ['正确', '译文']);
  const body = JSON.parse(f.calls[1].body);
  assert.equal(body.instructions, 'Only translate to French.');
  assert.deepEqual(body.input, [{ role: 'user', content: [{ type: 'input_text', text: '{"text":"Hello"}' }] }]);
  assert.deepEqual(body.tools, []);
  assert.equal(body.tool_choice, 'none');
  assert.equal(body.store, false);
  assert.equal(body.stream, true);
  assert.equal(Object.hasOwn(body.reasoning || {}, 'summary'), false);
  assert.equal(body.reasoning?.effort, levels.includes('minimal') ? 'minimal' : levels.includes('low') ? 'low' : undefined);
});
test('stream ending without completion is not reported as a finished translation', async () => {
  const f = signedIn({ fetch: async url => url.includes('/models?') ? Response.json({ models: [{ slug: 'test-model' }] }) : stream([{ type: 'response.output_text.delta', delta: 'partial' }]) });
  await assert.rejects(f.app.translate({ model: 'test-model', system: 'Translate', text: 'Hi' }, new AbortController().signal, () => {}, () => {}), /连接中断/);
});
function host(t, options = {}) {
  const native = new EventEmitter(), timers = new Set(), calls = [];
  const processMock = new EventEmitter();
  processMock.stdin = new PassThrough(); processMock.stdout = new PassThrough();
  processMock.exit = code => { throw new Error('Unexpected exit ' + code); };
  let output = Buffer.alloc(0);
  processMock.stdout.on('data', chunk => {
    output = Buffer.concat([output, chunk]);
    while (output.length >= 4 && output.length >= 4 + output.readUInt32LE(0)) {
      const size = output.readUInt32LE(0), message = JSON.parse(output.subarray(4, 4 + size));
      output = output.subarray(4 + size); native.emit('message', message);
    }
  });
  class FakeSubscription {
    constructor(file) { assert.equal(file, '/mock-host/tokens.json'); }
    async models(signal, refresh) { calls.push(['models', refresh]); return [{ slug: 'test-model', display_name: 'Test' }]; }
    async login(signal, onUrl) { calls.push(['login']); onUrl('https://auth.openai.com/oauth/authorize'); if (options.login) await options.login(signal); }
    logout() { calls.push(['logout']); }
    async translate(request, signal, delta, accepted) { calls.push(['translate', request]); accepted(); delta('模拟译文'); return { translation: '模拟译文', effort: 'low' }; }
  }
  const context = vm.createContext({ Buffer, AbortController, process: processMock, __dirname: '/mock-host', require(name) {
    if (name === './subscription') return { Subscription: FakeSubscription };
    assert.ok(['node:path', 'node:perf_hooks'].includes(name), 'Unexpected local dependency: ' + name); return require(name);
  }, setTimeout(fn, ms) { const timer = setTimeout(fn, ms); timer.unref(); timers.add(timer); return timer; }, clearTimeout(timer) { clearTimeout(timer); timers.delete(timer); } });
  vm.runInContext(source('bridge/host.js'), context);
  t.after(() => { for (const timer of timers) clearTimeout(timer); processMock.stdin.destroy(); processMock.stdout.destroy(); });
  let sequence = 0;
  const messages = [];
  native.on('message', value => messages.push(value));
  function send(value) {
    const data = Buffer.from(JSON.stringify(value)), size = Buffer.alloc(4); size.writeUInt32LE(data.length);
    const frame = Buffer.concat([size, data]); processMock.stdin.write(frame.subarray(0, 3)); processMock.stdin.write(frame.subarray(3));
  }
  function request(action, extra = {}) {
    const id = 'job-' + ++sequence, done = deferred();
    const receive = value => { if (value.id === id && !['progress', 'delta', 'loginUrl'].includes(value.type)) { native.off('message', receive); done.resolve(value); } };
    native.on('message', receive); send({ id, action, ...extra }); return done.promise;
  }
  return { request, calls, send, messages };
}
test('native host frames independent login, model list, parameterless prepare and translation', async t => {
  const app = host(t);
  assert.equal((await app.request('login')).type, 'loggedIn');
  const models = await app.request('models');
  assert.deepEqual(models.models, [{ id: 'test-model', name: 'Test', isDefault: true }]);
  assert.equal((await app.request('prepare')).type, 'ready');
  const result = await app.request('translate', { model: 'test-model', system: 'Translate.', text: 'Hello' });
  assert.equal(result.type, 'done');
  assert.equal(result.translation, '模拟译文');
  for (const key of ['setupMs', 'acceptedMs', 'firstTokenMs', 'totalMs']) assert.equal(typeof result.timing[key], 'number');
  assert.equal((await app.request('logout')).type, 'loggedOut');
});
test('native logout cancels pending login without emitting a late loggedIn event', async t => {
  const app = host(t, { login: signal => new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true })) });
  app.send({ id: 'pending-login', action: 'login' });
  assert.equal((await app.request('logout')).type, 'loggedOut');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(app.messages.some(value => value.id === 'pending-login' && value.type === 'loggedIn'), false);
  assert.equal(app.messages.some(value => value.id === 'pending-login' && value.type === 'error'), false);
});

test('model catalog uses the working subscription protocol version instead of the retired catalog', async () => {
  const f = signedIn({ fetch: async url => Response.json({ models:
    new URL(url).searchParams.get('client_version') === '0.162.1'
      ? [{ slug: 'gpt-6-luna', visibility: 'list', input_modalities: ['text'] }]
      : [{ slug: 'codex-auto-review', visibility: 'hide', input_modalities: ['text'] }],
  }) });
  assert.deepEqual((await f.app.models(new AbortController().signal)).map(m => m.slug), ['gpt-6-luna']);
});

test('a hidden-only catalog reports compatibility failure and is not cached', async () => {
  let calls = 0;
  const f = signedIn({ fetch: async () => Response.json({ models: ++calls === 1
    ? [{ slug: 'codex-auto-review', visibility: 'hide' }]
    : [{ slug: 'gpt-6-luna', visibility: 'list' }],
  }) });
  await assert.rejects(f.app.models(new AbortController().signal), /客户端/);
  assert.deepEqual((await f.app.models(new AbortController().signal)).map(m => m.slug), ['gpt-6-luna']);
  assert.equal(calls, 2);
});
