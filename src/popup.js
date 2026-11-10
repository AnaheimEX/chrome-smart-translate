(function () {
  'use strict';
  document.addEventListener('DOMContentLoaded', function () {
    var toggle = document.getElementById('enabled');
    var status = document.getElementById('cfgStatus');
    chrome.storage.local.get(null).then(function (cfg) {
      toggle.checked = cfg.enabled !== false;
      var provider = cfg.provider === 'api' ? 'api' : 'codex';
      if (provider === 'codex' ? cfg.codexSignedOut : cfg.apiSignedOut) {
        status.textContent = '已登出，请在设置中重新登录或填写 API Key';
        status.classList.add('err');
      } else if (provider === 'codex') {
        status.textContent = cfg.codexModel ? 'ChatGPT 订阅：' + cfg.codexModel : '请在设置中登录并选择订阅模型';
        if (!cfg.codexModel) status.classList.add('err');
      } else {
        status.textContent = cfg.baseUrl && cfg.model ? 'API 模型：' + cfg.model : '兼容 API 尚未配置';
        if (!cfg.baseUrl || !cfg.model) status.classList.add('err');
      }
    });
    toggle.addEventListener('change', function () {
      chrome.storage.local.set({ enabled: toggle.checked });
    });
    document.getElementById('openOptions').addEventListener('click', function () {
      chrome.runtime.openOptionsPage();
      window.close();
    });

    // 新增：弹窗文本翻译（中文输入 → 英文或日语），走同样的翻译 Port。
    var translateInput = document.getElementById('translateInput');
    var translateTarget = document.getElementById('translateTarget');
    var translateBtn = document.getElementById('translateBtn');
    var result = document.getElementById('translateResult');
    var translateStatus = document.getElementById('translateStatus');
    var translateText = document.getElementById('translateText');
    var translateCopy = document.getElementById('translateCopy');
    var port = null;
    var translating = false;
    var completed = false;

    function wait(message, kind) {
      translateStatus.textContent = message || '';
      translateStatus.className = 'status' + (kind ? ' ' + kind : '');
      // 出错/等待时才清空已有译文；流式增量不清屏。
      if (message) translateText.textContent = '';
      translateCopy.hidden = !translateText.textContent;
      result.hidden = !message && !translateText.textContent;
    }

    function resultLive(text) {
      translateText.textContent = text;
      wait('');
    }

    function disconnectPort() {
      if (port) { port.disconnect(); port = null; }
      translating = false;
      completed = false;
      translateBtn.disabled = false;
      translateBtn.textContent = '翻译';
      translateInput.disabled = false;
      translateTarget.disabled = false;
    }

    function startTranslation() {
      var text = String(translateInput.value || '').trim();
      var language = translateTarget.value;
      if (!text) { wait('请输入要翻译的中文。', 'err'); return; }
      if (!language) { wait('请选择目标语言。', 'err'); return; }
      if (translating) { disconnectPort(); return; }
      translating = true;
      completed = false;
      translateStatus.textContent = '';
      translateText.textContent = '';
      translateCopy.hidden = true;
      result.hidden = false;
      translateBtn.disabled = true;
      translateBtn.textContent = '翻译中…';
      translateInput.disabled = true;
      translateTarget.disabled = true;
      wait('正在连接翻译模型…');
      try {
        port = chrome.runtime.connect({ name: 'translate' });
      } catch (error) {
        wait(String((error && error.message) || error), 'err');
        disconnectPort();
        return;
      }
      port.onMessage.addListener(function (msg) {
        if (!msg || !translating) return;
        if (msg.type === 'progress') {
          wait(msg.message || '正在翻译…');
        } else if (msg.type === 'delta') {
          if (!msg.text) return;
          resultLive((translateText.textContent + msg.text).trimStart());
        } else if (msg.type === 'done') {
          completed = true;
          if (typeof msg.text === 'string' && msg.text.trimStart()) resultLive(msg.text.trimStart());
          else if (!translateText.textContent) wait('（无译文）', 'err');
          disconnectPort();
        } else if (msg.type === 'error') {
          completed = true;
          wait(msg.message || '翻译失败。', 'err');
          disconnectPort();
        }
      });
      port.onDisconnect.addListener(function () {
        if (!translating) return;
        port = null;
        if (!completed) {
          wait('翻译连接已中断，请重试。', 'err');
        }
        disconnectPort();
      });
      port.postMessage({ type: 'start', text: text, context: { target: language } });
    }

    function fallbackCopy(text) {
      try {
        var ta = document.createElement('textarea');
        ta.value = text;
        ta.style.cssText = 'position:fixed;left:-9999px;top:0;';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      } catch (_) {}
    }

    function copyTranslation() {
      var content = translateText.textContent;
      if (!content) return;
      var done = function () {
        translateCopy.textContent = '已复制';
        setTimeout(function () { translateCopy.textContent = '复制'; }, 1200);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(content).then(done, done);
      } else { fallbackCopy(content); done(); }
    }

    translateBtn.addEventListener('click', startTranslation);
    // 回车提交翻译，Shift+Enter 换行。
    translateInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); startTranslation(); }
    });
    translateCopy.addEventListener('click', copyTranslation);
  });
})();
