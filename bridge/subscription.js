'use strict';
// OAuth and subscription wire format follow OpenAI's public client implementation.
// This module is independent of any installed CLI, account store, or local config.
const fs = require('node:fs');
const http = require('node:http');
const crypto = require('node:crypto');
const CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
const AUTH = 'https://auth.openai.com';
const API = 'https://chatgpt.com/backend-api/codex';
// The subscription service gates its model catalog by protocol version. An old
// version can return HTTP 200 with only hidden models even for a paid account.
const CLIENT_VERSION = '0.162.1';
const signedOut = () => new Error('请点击“登录 ChatGPT 订阅”完成网页授权。');
function claims(token) {
  try { return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()); } catch (_) { return {}; }
}
function check(signal) { if (signal) signal.throwIfAborted(); }
function failure(response, purpose) {
  if (response.status === 401) return new Error('ChatGPT 登录已失效，请重新登录。');
  if (response.status === 403) return new Error('ChatGPT 拒绝访问，请确认订阅权限及网络后重试。');
  if (response.status === 429) return new Error('ChatGPT 请求或订阅额度受限，请稍后重试。');
  return new Error(`${purpose}失败（HTTP ${response.status}），请重试。`);
}
class Subscription {
  constructor(file, options = {}) {
    this.file = file;
    this.fs = options.fs || fs;
    this.fetch = options.fetch || globalThis.fetch;
    this.http = options.http || http;
    this.port = options.port === undefined ? 1455 : options.port;
    this.now = options.now || Date.now;
    this.epoch = 0;
    this.tokens = undefined;
    this.catalog = null;
    this.refreshing = null;
  }
  load() {
    if (this.tokens !== undefined) return this.tokens;
    try { this.tokens = JSON.parse(this.fs.readFileSync(this.file, 'utf8')); }
    catch (_) { this.tokens = null; }
    if (!this.tokens || typeof this.tokens.accessToken !== 'string' || typeof this.tokens.refreshToken !== 'string' || typeof this.tokens.accountId !== 'string') this.tokens = null;
    return this.tokens;
  }
  save(tokens, epoch, signal) {
    check(signal);
    if (epoch !== this.epoch) throw signedOut();
    // Synchronous rename makes cancellation/logout and persistence indivisible.
    const temp = this.file + '.tmp';
    try {
      this.fs.writeFileSync(temp, JSON.stringify(tokens) + '\n', { mode: 0o600 });
      this.fs.chmodSync(temp, 0o600);
      this.fs.renameSync(temp, this.file);
    } catch (_) {
      try { this.fs.unlinkSync(temp); } catch (_) {}
      throw new Error('无法保存扩展登录状态，请检查本地连接目录权限。');
    }
    this.tokens = tokens;
  }
  logout() {
    this.epoch++;
    this.tokens = null;
    this.catalog = null;
    for (const file of [this.file, this.file + '.tmp']) {
      try { this.fs.unlinkSync(file); }
      catch (error) { if (error.code !== 'ENOENT') throw new Error('无法移除扩展登录状态，请检查目录权限后重试登出。'); }
    }
  }
  async network(url, options, purpose) {
    try { return await this.fetch(url, options); }
    catch (_) { check(options.signal); throw new Error(`${purpose}无法连接，请检查网络后重试。`); }
  }
  async tokenRequest(params, signal) {
    const response = await this.network(AUTH + '/oauth/token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: CLIENT_ID, ...params }).toString(), signal,
    }, 'ChatGPT 授权');
    if (!response.ok) throw failure(response, 'ChatGPT 授权');
    try { return await response.json(); } catch (_) { throw new Error('ChatGPT 授权返回无效，请重新登录。'); }
  }
  tokenData(value, previous) {
    const accessToken = value.access_token;
    const auth = claims(value.id_token || accessToken)['https://api.openai.com/auth'] || {};
    const accountId = auth.chatgpt_account_id || (previous && previous.accountId);
    const refreshToken = value.refresh_token || (previous && previous.refreshToken);
    if (typeof accessToken !== 'string' || !accessToken || typeof refreshToken !== 'string' || !refreshToken || typeof accountId !== 'string' || !accountId) throw new Error('授权未返回完整的 ChatGPT 订阅账号，请重新登录。');
    return { accessToken, refreshToken, accountId,
      expiresAt: Number(claims(accessToken).exp) * 1000 || this.now() + (Number(value.expires_in) || 3600) * 1000 };
  }
  async login(signal, onUrl) {
    this.logout();
    const epoch = this.epoch;
    const verifier = crypto.randomBytes(32).toString('base64url');
    const state = crypto.randomBytes(32).toString('base64url');
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
    let server, callbackBusy = false;
    await new Promise((resolve, reject) => {
      const abort = () => reject(signal.reason || new Error('登录已取消。'));
      const finish = error => error ? reject(error) : resolve();
      server = this.http.createServer(async (request, response) => {
        const url = new URL(request.url, 'http://127.0.0.1');
        const reply = (status, text, done) => { response.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'Connection': 'close' }); response.end(text, done); };
        if (url.pathname !== '/auth/callback') return reply(404, 'Not found');
        if (request.method !== 'GET' || url.searchParams.get('state') !== state) return reply(400, '登录校验失败，请返回扩展重新登录。');
        if (callbackBusy) return reply(409, '授权正在处理，请返回扩展。');
        callbackBusy = true;
        if (url.searchParams.has('error') || !url.searchParams.get('code')) {
          reply(400, '未完成授权，请返回扩展重新登录。');
          return finish(new Error('ChatGPT 授权未完成，请重新登录。'));
        }
        try {
          const redirect = `http://127.0.0.1:${server.address().port}/auth/callback`;
          const value = await this.tokenRequest({ grant_type: 'authorization_code', code: url.searchParams.get('code'), redirect_uri: redirect, code_verifier: verifier }, signal);
          this.save(this.tokenData(value), epoch, signal);
          reply(200, 'ChatGPT 订阅登录成功。请关闭此页面，返回扩展选择模型并保存。', () => finish());
        } catch (error) { reply(400, '登录未完成，请返回扩展重试。'); finish(error); }
      });
      server.once('error', error => finish(new Error(error.code === 'EADDRINUSE' ? '网页登录回调端口 1455 已被其他程序占用，请结束其他登录流程后重试。' : '无法启动网页登录回调，请重试。')));
      signal.addEventListener('abort', abort, { once: true });
      server.once('close', () => signal.removeEventListener('abort', abort));
      if (signal.aborted) return abort();
      server.listen(this.port, '127.0.0.1', () => {
        try {
          check(signal);
          const url = new URL(AUTH + '/oauth/authorize');
          url.search = new URLSearchParams({ response_type: 'code', client_id: CLIENT_ID,
            redirect_uri: `http://127.0.0.1:${server.address().port}/auth/callback`,
            scope: 'openid profile email offline_access', code_challenge: challenge, code_challenge_method: 'S256',
            state, id_token_add_organizations: 'true', codex_cli_simplified_flow: 'true', originator: 'codex_cli_rs' }).toString();
          onUrl(url.toString());
        } catch (error) { finish(error); }
      });
    }).finally(() => { if (server) { server.close(); server.closeAllConnections(); } });
  }
  async credentials(signal, force = false) {
    check(signal);
    const current = this.load();
    if (!current) throw signedOut();
    if (!force && current.expiresAt > this.now() + 60000) return current;
    if (!this.refreshing) {
      const epoch = this.epoch;
      this.refreshing = (async () => {
        const value = await this.tokenRequest({ grant_type: 'refresh_token', refresh_token: current.refreshToken }, signal);
        const tokens = this.tokenData(value, current);
        this.save(tokens, epoch, signal);
        return tokens;
      })().finally(() => { this.refreshing = null; });
    }
    const result = await this.refreshing;
    check(signal);
    return result;
  }
  async api(path, options, signal) {
    const epoch = this.epoch;
    let tokens = await this.credentials(signal);
    for (let attempt = 0; attempt < 2; attempt++) {
      check(signal);
      if (epoch !== this.epoch) throw signedOut();
      const response = await this.network(API + path, { ...options, signal, headers: {
        'Content-Type': 'application/json', Accept: options.method === 'POST' ? 'text/event-stream' : 'application/json',
        Authorization: 'Bearer ' + tokens.accessToken, 'ChatGPT-Account-ID': tokens.accountId,
        originator: 'codex_cli_rs', ...options.headers,
      } }, 'ChatGPT 订阅请求');
      if (response.status !== 401 || attempt) {
        if (!response.ok) throw failure(response, 'ChatGPT 订阅请求');
        return response;
      }
      if (response.body) await response.body.cancel();
      tokens = await this.credentials(signal, true);
    }
  }
  async models(signal, refresh = false) {
    if (this.catalog && !refresh) { check(signal); return this.catalog; }
    const epoch = this.epoch;
    const response = await this.api('/models?client_version=' + CLIENT_VERSION, { method: 'GET' }, signal);
    let data;
    try { data = await response.json(); } catch (_) { throw new Error('模型列表返回无效，请重试。'); }
    check(signal);
    if (epoch !== this.epoch) throw signedOut();
    if (!data || !Array.isArray(data.models)) throw new Error('模型列表返回无效，请重试。');
    const catalog = data.models.filter(model => model && typeof model.slug === 'string' && /^[\w.:-]{1,100}$/.test(model.slug) && model.visibility !== 'hide' && model.visibility !== 'none' && (!model.input_modalities || model.input_modalities.includes('text'))).sort((a, b) => (a.priority || 0) - (b.priority || 0));
    if (!catalog.length) throw new Error(data.models.length
      ? '订阅接口只返回了当前客户端不可用的模型，请更新订阅连接后重试。'
      : '订阅接口未返回模型，请稍后重试或重新登录。');
    this.catalog = catalog;
    return this.catalog;
  }
  async translate(request, signal, onDelta, onAccepted) {
    const models = await this.models(signal);
    const model = models.find(item => item.slug === request.model);
    if (!model) throw new Error('该模型已不在可用列表中，请重新读取模型。');
    const levels = (model.supported_reasoning_levels || []).map(item => item.effort);
    const effort = levels.includes('minimal') ? 'minimal' : levels.includes('low') ? 'low' : model.default_reasoning_level;
    const body = { model: request.model, instructions: request.system,
      input: [{ role: 'user', content: [{ type: 'input_text', text: request.text }] }],
      stream: true, store: false, tools: [], tool_choice: 'none', parallel_tool_calls: false, include: [],
      ...(effort ? { reasoning: { effort } } : {}),
      ...(model.supports_verbosity ? { text: { verbosity: 'low' } } : {}) };
    const response = await this.api('/responses', { method: 'POST', body: JSON.stringify(body) }, signal);
    onAccepted(effort);
    if (!response.body) throw new Error('ChatGPT 未返回翻译内容，请重试。');
    const reader = response.body.getReader(), decoder = new TextDecoder();
    let pending = '', text = '', final = '', completed = false;
    const commentary = new Set();
    const event = frame => {
      const raw = frame.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
      if (!raw || raw === '[DONE]') return;
      let value;
      try { value = JSON.parse(raw); } catch (_) { throw new Error('ChatGPT 返回无效的翻译数据，请重试。'); }
      if (value.type === 'response.output_item.added' && value.item && value.item.phase === 'commentary') commentary.add(value.item.id);
      if (value.type === 'response.output_text.delta' && !commentary.has(value.item_id) && typeof value.delta === 'string' && value.delta) {
        text += value.delta;
        if (text.length > 250000) throw new Error('翻译结果过长，请减少原文后重试。');
        onDelta(value.delta);
      }
      if (value.type === 'response.output_item.done' && value.item && value.item.type === 'message' && value.item.phase !== 'commentary') {
        final += (value.item.content || []).filter(item => item.type === 'output_text').map(item => item.text || '').join('');
      }
      if (['response.failed', 'response.incomplete', 'error'].includes(value.type)) throw new Error('ChatGPT 未完成翻译，请检查订阅额度或网络后重试。');
      if (value.type === 'response.completed') {
        if (value.response && value.response.status && value.response.status !== 'completed') throw new Error('ChatGPT 未完成翻译，请重试。');
        completed = true;
      }
    };
    try {
      while (!completed) {
        check(signal);
        const part = await reader.read();
        pending += decoder.decode(part.value || new Uint8Array(), { stream: !part.done });
        pending = pending.replace(/\r\n/g, '\n');
        let end;
        while ((end = pending.indexOf('\n\n')) >= 0) { event(pending.slice(0, end)); pending = pending.slice(end + 2); }
        if (pending.length > 1000000) throw new Error('ChatGPT 翻译数据过大，请重试。');
        if (part.done) { if (pending.trim()) event(pending); break; }
      }
    } finally { await reader.cancel().catch(() => {}); }
    check(signal);
    if (!completed || !(final || text).trim()) throw new Error('ChatGPT 翻译连接中断，请重试。');
    return { translation: (final || text).trim(), effort };
  }
}
module.exports = { Subscription };
