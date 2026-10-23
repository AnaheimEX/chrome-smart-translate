#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');

const hostName = 'com.smart_translate.subscription';
function extensionIds(root, extraId) {
  // Chromium derives an unpacked extension ID from its absolute directory.
  // Always include the current directory, even if an old ID was supplied.
  const derived = crypto.createHash('sha256').update(root).digest('hex').slice(0, 32)
    .replace(/[0-9a-f]/g, char => String.fromCharCode(97 + parseInt(char, 16)));
  if (extraId && !/^[a-p]{32}$/.test(extraId)) throw new Error('扩展 ID 必须是扩展管理页显示的 32 位 ID。');
  return [...new Set([derived, ...(extraId ? [extraId] : [])])];
}

function install(extraId) {
  if (process.platform !== 'darwin') throw new Error('此安装脚本目前支持 macOS。');
  if (Number(process.versions.node.split('.')[0]) < 20) throw new Error('订阅连接需要 Node.js 20 或更新版本。');
  const root = fs.realpathSync(path.join(__dirname, '..'));
  const ids = extensionIds(root, extraId);
  const runtime = path.join(os.homedir(), 'Library/Application Support/SmartTranslate/Subscription');
  fs.mkdirSync(runtime, { recursive: true, mode: 0o700 });
  for (const file of ['host.js', 'subscription.js']) fs.copyFileSync(path.join(__dirname, file), path.join(runtime, file));
  const quote = value => "'" + value.replace(/'/g, "'\\''") + "'";
  const launcher = path.join(runtime, 'launch.sh');
  fs.writeFileSync(launcher, '#!/bin/sh\nexec ' + quote(process.execPath) + ' ' + quote(path.join(runtime, 'host.js')) + '\n', { mode: 0o700 });
  fs.chmodSync(launcher, 0o700);
  const manifest = {
    name: hostName, description: 'Smart Translate ChatGPT subscription connection', path: launcher,
    type: 'stdio', allowed_origins: ids.map(id => 'chrome-extension://' + id + '/'),
  };
  for (const browser of ['Google/Chrome', 'Google/Chrome Beta', 'Google/Chrome Canary', 'Dia/User Data', 'Dia']) {
    const directory = path.join(os.homedir(), 'Library/Application Support', browser, 'NativeMessagingHosts');
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, hostName + '.json'), JSON.stringify(manifest, null, 2) + '\n', { mode: 0o600 });
  }
  console.log('已安装独立的 ChatGPT 订阅连接。扩展 ID：' + ids.join(', '));
  console.log('重新加载扩展后，点击“登录 ChatGPT 订阅”完成网页授权。');
}

if (require.main === module) install(process.argv[2]);
module.exports = { extensionIds };
