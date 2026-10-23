#!/usr/bin/env node
'use strict';
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const { Subscription } = require('./subscription');
const subscription = new Subscription(path.join(__dirname, 'tokens.json'));
const jobs = new Map();
let loginJob = null;
function send(value) {
  const data = Buffer.from(JSON.stringify(value));
  if (data.length > 1000000) return;
  const size = Buffer.alloc(4);
  size.writeUInt32LE(data.length);
  process.stdout.write(Buffer.concat([size, data]));
}
function cancel(job) { if (job) { job.cancelled = true; job.controller.abort(); } }
function stop() { for (const job of jobs.values()) cancel(job); }
process.on('exit', stop);
process.on('SIGTERM', () => process.exit(0));
process.stdin.on('end', () => process.exit(0));
process.stdin.on('error', () => process.exit(1));
process.stdout.on('error', () => process.exit(1));
function validate(request) {
  if (typeof request.model !== 'string' || !/^[\w.:-]{1,100}$/.test(request.model) ||
      typeof request.system !== 'string' || !request.system.trim() || request.system.length > 4000 ||
      typeof request.text !== 'string' || !request.text.trim() || request.text.length > 48000) throw new Error('翻译参数无效，请重新选择模型。');
}
async function handle(request) {
  if (!request || typeof request.id !== 'string' || !/^[\w-]{1,100}$/.test(request.id)) return;
  if (request.action === 'cancel') { cancel(jobs.get(request.id)); return; }
  if (jobs.has(request.id)) return;
  if (request.action === 'logout') {
    stop();
    try { subscription.logout(); send({ id: request.id, type: 'loggedOut' }); }
    catch (error) { send({ id: request.id, type: 'error', error: error.message }); }
    return;
  }
  if (loginJob) { send({ id: request.id, type: 'error', error: '正在登录，请完成授权或退出后重试。' }); return; }
  if (request.action === 'login' && jobs.size) { send({ id: request.id, type: 'error', error: '请等待当前请求完成后登录。' }); return; }
  if (jobs.size >= 4) { send({ id: request.id, type: 'error', error: '请求较多，请稍后重试。' }); return; }
  const job = { id: request.id, started: performance.now(), firstTokenMs: null, controller: new AbortController(), cancelled: false };
  jobs.set(job.id, job);
  if (request.action === 'login') loginJob = job;
  const timer = setTimeout(() => {
    send({ id: job.id, type: 'error', error: request.action === 'login' ? '登录超时，请重新登录。' : '请求超时，请重试。' });
    cancel(job);
  }, request.action === 'login' ? 300000 : 120000);
  const emit = value => { if (!job.cancelled) send({ id: job.id, ...value }); };
  try {
    const signal = job.controller.signal;
    if (request.action === 'login') {
      await subscription.login(signal, url => emit({ type: 'loginUrl', url }));
      emit({ type: 'loggedIn' });
    } else if (request.action === 'models') {
      const models = await subscription.models(signal, true);
      emit({ type: 'models', models: models.map((model, index) => ({ id: model.slug, name: model.display_name || model.slug, isDefault: index === 0 })) });
    } else if (request.action === 'prepare') {
      await subscription.models(signal);
      emit({ type: 'ready' });
    } else if (request.action === 'translate') {
      validate(request);
      emit({ type: 'progress', message: '正在连接翻译模型…' });
      await subscription.models(signal);
      const setupMs = performance.now() - job.started;
      let acceptedMs;
      const result = await subscription.translate(request, signal, delta => {
        if (job.firstTokenMs === null) job.firstTokenMs = performance.now() - job.started;
        emit({ type: 'delta', text: delta });
      }, () => { acceptedMs = performance.now() - job.started; emit({ type: 'progress', message: '正在翻译…' }); });
      emit({ type: 'done', translation: result.translation, timing: { setupMs, acceptedMs, firstTokenMs: job.firstTokenMs, totalMs: performance.now() - job.started, effort: result.effort } });
    } else throw new Error('不支持的请求。');
  } catch (error) { emit({ type: 'error', error: String(error.message || 'ChatGPT 请求失败。').slice(0, 300) }); }
  finally { clearTimeout(timer); jobs.delete(job.id); if (loginJob === job) loginJob = null; }
}
let buffer = Buffer.alloc(0);
process.stdin.on('data', chunk => {
  buffer = Buffer.concat([buffer, chunk]);
  while (buffer.length >= 4) {
    const size = buffer.readUInt32LE(0);
    if (size > 200000) return process.exit(1);
    if (buffer.length < size + 4) return;
    const data = buffer.subarray(4, size + 4);
    buffer = buffer.subarray(size + 4);
    try { handle(JSON.parse(data.toString('utf8'))); } catch (_) { process.exit(1); }
  }
});
