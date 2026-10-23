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
  });
})();
