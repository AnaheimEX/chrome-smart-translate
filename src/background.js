importScripts(chrome.runtime.getURL('src/prompt.js'));

var DEFAULTS = {
  provider: 'codex', baseUrl: '', apiKey: '', model: '', codexModel: '', enabled: true,
  translationPrompt: self.SMART_TRANSLATE.DEFAULT_PROMPT, temperature: 0.3,
  authRevision: '', codexSignedOut: false, apiSignedOut: false,
};
chrome.runtime.onInstalled.addListener(function () {
  chrome.storage.local.remove(['bridgeToken', 'chatgptMigrationV1', 'defaultDomain']);
});
function getConfig() {
  return chrome.storage.local.get(DEFAULTS);
}

// Serialize credential writes so an older save/model response cannot undo logout.
var settingsQueue = Promise.resolve();
var authEpoch = 0;
var logoutPromise = null;
var loginPromise = null;
var activeControllers = new Set();
function changeSettings(operation) {
  var result = settingsQueue.then(operation);
  settingsQueue = result.catch(function () {});
  return result;
}
function assertCurrent(epoch) {
  if (epoch !== authEpoch || logoutPromise) throw new Error('登录状态已变化，请重新操作。');
}
function assertRevision(message, cfg) {
  if (message.authRevision !== cfg.authRevision) throw new Error('登录状态已变化，请重新打开设置。');
}
async function withAuthRequest(message, operation) {
  if (loginPromise && message.action !== 'loginCodex') throw new Error('正在登录，请完成授权或退出后重试。');
  var epoch = authEpoch;
  assertCurrent(epoch);
  var cfg = await getConfig();
  assertCurrent(epoch);
  assertRevision(message, cfg);
  var controller = new AbortController();
  activeControllers.add(controller);
  try {
    var result = await operation(controller.signal, epoch, cfg);
    assertCurrent(epoch);
    return result;
  } finally { activeControllers.delete(controller); }
}
function isSignedOut(cfg) {
  return cfg.provider === 'codex' ? cfg.codexSignedOut : cfg.apiSignedOut;
}
function saveSettings(message) {
  if (loginPromise) return Promise.reject(new Error('正在登录，请稍后保存。'));
  var epoch = authEpoch;
  return changeSettings(async function () {
    assertCurrent(epoch);
    var cfg = await getConfig();
    assertCurrent(epoch);
    assertRevision(message, cfg);
    var input = message.settings || {};
    if (!['codex', 'api'].includes(input.provider)) throw new Error('请选择翻译服务。');
    var temperature = Number(input.temperature);
    if (!Number.isFinite(temperature) || temperature < 0 || temperature > 2) throw new Error('温度须在 0–2 之间。');
    var settings = {
      provider: input.provider, codexModel: String(input.codexModel || ''),
      baseUrl: input.baseUrl ? normalizeBaseUrl(input.baseUrl) : '',
      model: String(input.model || '').trim(), temperature: temperature,
      translationPrompt: self.SMART_TRANSLATE.getPrompt(input.translationPrompt),
    };
    var apiKey = String(input.apiKey || '').trim();
    if (apiKey) { settings.apiKey = apiKey; settings.apiSignedOut = false; }
    await chrome.storage.local.set(settings);
    if (!apiKey) await chrome.storage.local.remove('apiKey');
    assertCurrent(epoch);
    return { ok: true };
  });
}
function disconnectNative() {
  clearTimeout(nativeIdleTimer);
  var connection = nativeConnection;
  nativeConnection = null;
  for (var request of Array.from(nativePending.values())) request.finish(new Error('登录状态已清除。'));
  if (connection) connection.disconnect();
}
function logout(provider) {
  if (!['codex', 'api'].includes(provider)) return Promise.reject(new Error('未知翻译服务。'));
  if (logoutPromise) return Promise.reject(new Error('正在清除登录信息，请稍后重试。'));
  authEpoch++;
  for (var controller of activeControllers) controller.abort();
  disconnectNative();
  translationCache.clear();
  cacheChars = 0;
  logoutPromise = (async function () {
    await changeSettings(async function () {
      var state = { authRevision: crypto.randomUUID(), apiSignedOut: true };
      if (provider === 'codex') state.codexSignedOut = true;
      await chrome.storage.local.set(state);
      await chrome.storage.local.remove(['apiKey', 'codexModels', 'bridgeToken', 'chatgptMigrationV1']);
    });
    if (provider === 'codex') {
      try { await callNative({ action: 'logout' }); }
      catch (error) {
        throw new Error('扩展已停止使用订阅，但独立登录凭据清理未确认。请更新本地连接后重试退出。' + error.message);
      } finally { disconnectNative(); }
    }
    return { ok: true };
  })().finally(function () { logoutPromise = null; });
  return logoutPromise;
}

function loginCodex(message) {
  if (loginPromise || logoutPromise) return Promise.reject(new Error('登录状态正在变更，请稍后重试。'));
  var epoch = authEpoch;
  loginPromise = (async function () {
    var cfg = await getConfig();
    assertCurrent(epoch);
    assertRevision(message, cfg);
    authEpoch++;
    for (var controller of activeControllers) controller.abort();
    disconnectNative();
    translationCache.clear();
    cacheChars = 0;
    return withAuthRequest(message, async function (signal, loginEpoch) {
      await changeSettings(async function () {
        assertCurrent(loginEpoch);
        await chrome.storage.local.set({ codexSignedOut: true });
        await chrome.storage.local.remove('codexModels');
      });
      try {
        await callNative({ action: 'login' }, signal, async function (event) {
          if (event.type !== 'loginUrl') return;
          assertCurrent(loginEpoch);
          signal.throwIfAborted();
          var url = new URL(event.url);
          if (url.origin !== 'https://auth.openai.com' || url.username || url.password) throw new Error('订阅服务返回了不受信任的登录地址。');
          await chrome.tabs.create({ url: url.href });
        });
        await changeSettings(async function () {
          assertCurrent(loginEpoch);
          await chrome.storage.local.set({ codexSignedOut: false });
        });
        return { ok: true };
      } catch (error) {
        // Logout may already have replaced this connection; never close its request.
        if (loginEpoch === authEpoch) disconnectNative();
        throw error;
      }
    });
  })().finally(function () { loginPromise = null; });
  return loginPromise;
}

function normalizeBaseUrl(value) {
  var url = new URL(String(value || '').trim());
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('Base URL 必须是有效的 HTTP(S) 地址');
  }
  return url.href.replace(/\/+$/, '');
}

function safePost(port, message) {
  try { port.postMessage(message); } catch (_) {}
}

async function readError(response) {
  var body = await response.text().catch(function () { return ''; });
  try {
    var parsed = JSON.parse(body);
    return String(parsed.error || parsed.message || body).slice(0, 300);
  } catch (_) {
    return body.slice(0, 300);
  }
}

var nativeConnection = null;
var nativePending = new Map();
var nativeIdleTimer;
var translationCache = new Map();
var warmRequests = new Map();
var cacheChars = 0;
function scheduleNativeIdle() {
  clearTimeout(nativeIdleTimer);
  if (!nativePending.size && nativeConnection) nativeIdleTimer = setTimeout(function () {
    if (!nativePending.size && nativeConnection) {
      var port = nativeConnection;
      nativeConnection = null;
      port.disconnect();
    }
  }, 5 * 60 * 1000);
}
function getNativeConnection() {
  clearTimeout(nativeIdleTimer);
  if (nativeConnection) return nativeConnection;
  var connection = chrome.runtime.connectNative('com.smart_translate.subscription');
  nativeConnection = connection;
  connection.onMessage.addListener(function (message) {
    var request = nativePending.get(message.id);
    if (!request) return;
    if (message.type === 'error') request.finish(new Error(message.error));
    else if (['done', 'models', 'ready', 'loggedOut', 'loggedIn'].includes(message.type)) {
      request.progress.then(function () { request.finish(null, message); }, request.finish);
    } else if (request.onProgress) {
      // Opening the authorization tab is asynchronous; do not report login success
      // before it has succeeded, even if authorization completes immediately.
      request.progress = request.progress.then(function () { return request.onProgress(message); });
      request.progress.catch(request.finish);
    }
  });
  connection.onDisconnect.addListener(function () {
    var detail = chrome.runtime.lastError;
    if (nativeConnection === connection) nativeConnection = null;
    var reason = detail && detail.message || '';
    var message = /forbidden/i.test(reason)
      ? '浏览器未允许此扩展连接订阅服务。请更新订阅连接后重新加载扩展。扩展 ID：' + chrome.runtime.id
      : /not found|not installed/i.test(reason)
        ? '尚未安装订阅连接。安装后重新加载扩展，即可打开 ChatGPT 登录页。'
        : '订阅连接已断开，请重新加载扩展后重试。';
    var error = new Error(message);
    for (var request of Array.from(nativePending.values())) if (request.connection === connection) request.finish(error);
  });
  return connection;
}
function callNative(request, signal, onProgress) {
  return new Promise(function (resolve, reject) {
    if (signal && signal.aborted) { reject(new Error('翻译已取消。')); return; }
    var connection;
    try { connection = getNativeConnection(); } catch (error) { reject(error); return; }
    var id = crypto.randomUUID();
    var settled = false;
    var timer = setTimeout(function () { cancel(); finish(new Error('订阅服务响应超时，请重试。')); }, request.action === 'login' ? 310000 : 130000);
    function cancel() { try { connection.postMessage({ id: id, action: 'cancel' }); } catch (_) {} }
    function finish(error, result) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      nativePending.delete(id);
      if (signal) signal.removeEventListener('abort', abort);
      scheduleNativeIdle();
      if (error) reject(error); else resolve(result);
    }
    function abort() { cancel(); finish(new Error('翻译已取消。')); }
    nativePending.set(id, { finish: finish, connection: connection, onProgress: onProgress, progress: Promise.resolve() });
    if (signal) signal.addEventListener('abort', abort, { once: true });
    try { connection.postMessage(Object.assign({}, request, { id: id })); } catch (error) { finish(error); }
  });
}
function saveCachedTranslation(key, translation) {
  if (translationCache.has(key)) cacheChars -= translationCache.get(key).size;
  translationCache.delete(key);
  var entry = { text: translation, time: Date.now(), size: key.length + translation.length };
  translationCache.set(key, entry);
  cacheChars += entry.size;
  while (translationCache.size > 64 || cacheChars > 500000) {
    var oldest = translationCache.keys().next().value;
    cacheChars -= translationCache.get(oldest).size;
    translationCache.delete(oldest);
  }
}
async function callCodex(text, system, cfg, signal, port) {
  if (!cfg.codexModel) {
    safePost(port, { type: 'error', code: 'NO_CONFIG', message: '请在设置中登录 ChatGPT 订阅并选择模型。' });
    return;
  }
  var key = JSON.stringify([cfg.codexModel, system, text]);
  var cached = translationCache.get(key);
  if (cached && Date.now() - cached.time < 10 * 60 * 1000) {
    safePost(port, { type: 'done', text: cached.text, timing: { cached: true } });
    return;
  }
  var result = await callNative({ action: 'translate', text: text, system: system, model: cfg.codexModel }, signal, function (message) {
    if (message.type === 'delta') safePost(port, { type: 'delta', text: message.text });
    if (message.type === 'progress') safePost(port, { type: 'progress', message: message.message });
  });
  signal.throwIfAborted();
  if (!result.translation) throw new Error('订阅服务未返回译文。');
  saveCachedTranslation(key, result.translation);
  safePost(port, { type: 'done', text: result.translation, timing: result.timing });
}
async function warmCodex(request) {
  var epoch = authEpoch;
  if (logoutPromise || loginPromise) return;
  var cfg = await getConfig();
  if (epoch !== authEpoch || logoutPromise || loginPromise || cfg.codexSignedOut || cfg.provider !== 'codex' || !cfg.codexModel || cfg.enabled === false) return;
  // Prewarm only an empty thread. No page text or context is sent before clicking Translate.
  var system = self.SMART_TRANSLATE.getPrompt(cfg.translationPrompt);
  var key = JSON.stringify([epoch, cfg.codexModel, system]);
  if (warmRequests.has(key)) return warmRequests.get(key);
  var controller = new AbortController();
  activeControllers.add(controller);
  var pending = callNative({ action: 'prepare', model: cfg.codexModel, system: system }, controller.signal).finally(function () {
    activeControllers.delete(controller);
    if (warmRequests.get(key) === pending) warmRequests.delete(key);
  });
  warmRequests.set(key, pending);
  return pending;
}

async function callCompatibleApi(text, system, cfg, signal, port) {
  if (!cfg.baseUrl || !cfg.model) {
    safePost(port, { type: 'error', code: 'NO_CONFIG', message: '请在设置中填写 Base URL 和模型。' });
    return;
  }
  var base = normalizeBaseUrl(cfg.baseUrl);
  var headers = { 'Content-Type': 'application/json' };
  if (cfg.apiKey) headers.Authorization = 'Bearer ' + cfg.apiKey;
  var response = await fetch(base + '/chat/completions', {
    method: 'POST',
    headers: headers,
    body: JSON.stringify({
      model: cfg.model,
      temperature: Number(cfg.temperature),
      stream: true,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: text },
      ],
    }),
    signal: signal,
  });
  signal.throwIfAborted();
  if (!response.ok) {
    safePost(port, { type: 'error', message: 'API HTTP ' + response.status + '：' + await readError(response) });
    return;
  }
  var contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    var result = await response.json();
    signal.throwIfAborted();
    var full = result && result.choices && result.choices[0] && result.choices[0].message &&
      result.choices[0].message.content;
    if (!full) throw new Error('接口返回为空。');
    safePost(port, { type: 'delta', text: full });
    safePost(port, { type: 'done' });
    return;
  }
  if (!response.body) throw new Error('接口未返回数据流。');
  var reader = response.body.getReader();
  var decoder = new TextDecoder();
  var buffer = '';
  var gotText = false;
  while (true) {
    var next = await reader.read();
    signal.throwIfAborted();
    buffer += decoder.decode(next.value || new Uint8Array(), { stream: !next.done });
    var lines = buffer.split(/\r?\n/);
    buffer = lines.pop();
    for (var line of lines) {
      line = line.trim();
      if (!line.startsWith('data:')) continue;
      var payload = line.slice(5).trim();
      if (payload === '[DONE]') {
        safePost(port, gotText ? { type: 'done' } : { type: 'error', message: '接口返回为空。' });
        return;
      }
      try {
        var event = JSON.parse(payload);
        var delta = event && event.choices && event.choices[0] && event.choices[0].delta &&
          event.choices[0].delta.content;
        if (delta) {
          gotText = true;
          safePost(port, { type: 'delta', text: delta });
        }
      } catch (_) {}
    }
    if (next.done) break;
  }
  safePost(port, gotText ? { type: 'done' } : { type: 'error', message: '接口返回为空。' });
}

chrome.runtime.onConnect.addListener(function (port) {
  if (port.name !== 'translate' || !port.sender || port.sender.id !== chrome.runtime.id || !/^https?:\/\//.test(port.sender.url || '')) return;
  var started = false;
  var controller = new AbortController();
  port.onDisconnect.addListener(function () { controller.abort(); });
  port.onMessage.addListener(function (request) {
    if (started || !request || request.type !== 'start') return;
    started = true;
    (async function () {
      try {
        var epoch = authEpoch;
        assertCurrent(epoch);
        activeControllers.add(controller);
        var cfg = await getConfig();
        assertCurrent(epoch);
        controller.signal.throwIfAborted();
        if (loginPromise || isSignedOut(cfg)) {
          safePost(port, { type: 'error', code: 'NO_CONFIG', message: '已登出，请在设置中重新登录或填写 API Key。' });
          return;
        }
        var text = String(request.text || '').slice(0, 20000);
        if (!text) throw new Error('没有选中文本。');
        var prepared = self.SMART_TRANSLATE.prepareTranslation(text, cfg.translationPrompt, request.context);
        var system = prepared.system;
        text = prepared.input;
        safePost(port, { type: 'progress', message: '正在翻译…' });
        if (cfg.provider === 'api') {
          await callCompatibleApi(text, system, cfg, controller.signal, port);
        } else if (cfg.provider === 'codex') {
          await callCodex(text, system, cfg, controller.signal, port);
        } else {
          throw new Error('未知翻译服务，请打开设置重新选择。');
        }
      } catch (error) {
        safePost(port, { type: 'error', message: controller.signal.aborted ? '翻译已取消。' : String(error.message || error) });
      } finally { activeControllers.delete(controller); }
    })();
  });
});

chrome.runtime.onMessage.addListener(function (message, sender, reply) {
  if (!message || !sender || sender.id !== chrome.runtime.id) return;
  if (message.action === 'warmCodex' && /^https?:\/\//.test(sender.url || '')) {
    warmCodex(message).then(function () { reply({ ok: true }); }, function () { reply({ ok: false }); });
    return true;
  }
  if (message.action === 'openOptions') {
    chrome.runtime.openOptionsPage();
    return;
  }
  if (!sender.url || !sender.url.startsWith(chrome.runtime.getURL(''))) return;
  var operation;
  if (message.action === 'logout') operation = logout(message.provider);
  else if (message.action === 'loginCodex') operation = loginCodex(message);
  else if (message.action === 'saveSettings') operation = saveSettings(message);
  else if (message.action === 'fetchModels') operation = withAuthRequest(message, async function (signal) {
    var base = normalizeBaseUrl(message.baseUrl);
    var headers = {};
    if (message.apiKey) headers.Authorization = 'Bearer ' + message.apiKey;
    var response = await fetch(base + '/models', { headers: headers, signal: signal });
    if (!response.ok) throw new Error('HTTP ' + response.status + '：' + await readError(response));
    var data = await response.json();
    var list = Array.isArray(data.data) ? data.data : Array.isArray(data) ? data : [];
    return { ok: true, models: list.map(function (m) { return m.id; }).filter(Boolean).sort() };
  });
  else if (message.action === 'fetchCodexModels') operation = withAuthRequest(message, async function (signal, epoch, cfg) {
    if (cfg.codexSignedOut) throw new Error('扩展已登出，请点击“登录 ChatGPT 订阅”重新授权。');
    var result = await callNative({ action: 'models' }, signal);
    if (!Array.isArray(result.models) || !result.models.length) throw new Error('未读取到可用模型，请重新读取或重新登录 ChatGPT 订阅。');
    await changeSettings(async function () {
      assertCurrent(epoch);
      await chrome.storage.local.set({ codexModels: result.models, codexSignedOut: false });
    });
    return { ok: true, models: result.models };
  });
  if (!operation) return;
  operation.then(reply, function (error) { reply({ ok: false, error: String(error.message || error) }); });
  return true;
});

chrome.storage.onChanged.addListener(function (changes, area) {
  if (area === 'local' && (changes.codexModel || changes.provider || changes.translationPrompt)) warmCodex({}).catch(function () {});
});
