(function () {
  'use strict';
  var authRevision = '';
  var uiEpoch = 0;
  var loggingOut = false;
  var loggingIn = false;
  var preferredModel = '';
  var modelIds = []; // 拉取到的模型列表，供自绘下拉使用
  function $(id) { return document.getElementById(id); }
  function status(id, message, kind) {
    var el = $(id);
    el.textContent = message || '';
    el.className = 'status' + (kind ? ' ' + kind : '');
  }
  function renderProvider() {
    var codex = $('provider').value === 'codex';
    $('codexSettings').hidden = !codex;
    $('apiSettings').hidden = codex;
    $('temperatureField').hidden = codex;
    $('logoutBtn').textContent = codex ? '退出扩展登录' : '清除 API Key';
    $('logoutHint').textContent = codex
      ? '退出此扩展的账号，保留已保存的翻译设置。'
      : '清除扩展保存的 API Key，不注销第三方账号、不撤销服务端密钥。';
  }
  function send(message) {
    message.authRevision = authRevision;
    return new Promise(function (resolve, reject) {
      chrome.runtime.sendMessage(message, function (result) {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else if (!result || !result.ok) reject(new Error(result && result.error || '后台服务无响应。'));
        else resolve(result);
      });
    });
  }
  function renderModels(models, selected) {
    var select = $('codexModel');
    models = Array.isArray(models) ? models : [];
    select.replaceChildren();
    models.forEach(function (model) {
      var option = document.createElement('option');
      option.value = model.id;
      option.textContent = (model.name || model.id) + (model.isDefault ? '（默认）' : '');
      select.appendChild(option);
    });
    if (models.some(function (model) { return model.id === selected; })) select.value = selected;
    else {
      var preferred = models.find(function (model) { return model.isDefault; }) || models[0];
      if (preferred) select.value = preferred.id;
    }
    if (!models.length) {
      var placeholder = document.createElement('option');
      placeholder.value = '';
      placeholder.textContent = '请先读取模型列表';
      select.appendChild(placeholder);
    }
    select.disabled = !models.length;
  }
  // ---- 自绘模型下拉：原生 datalist 弹窗在 Chromium 上点击不可靠，改为完全受控的面板 ----
  function closeModelPicker() {
    $('modelPicker').hidden = true;
    $('modelToggle').textContent = '▾';
  }
  function renderModelPicker(filter) {
    var picker = $('modelPicker');
    var input = $('model');
    var query = (filter === undefined ? input.value : filter || '').trim().toLowerCase();
    var items = query ? modelIds.filter(function (id) { return id.toLowerCase().indexOf(query) >= 0; }) : modelIds;
    picker.replaceChildren();
    if (!items.length) {
      var empty = document.createElement('div');
      empty.className = 'picker-empty';
      empty.textContent = modelIds.length ? '没有匹配的模型' : '暂无模型列表，请先拉取或手动输入';
      picker.appendChild(empty);
    } else {
      items.forEach(function (id) {
        var button = document.createElement('button');
        button.type = 'button';
        button.textContent = id;
        if (id === input.value.trim()) button.style.color = 'var(--pri)';
        button.addEventListener('click', function () {
          input.value = id;
          closeModelPicker();
          input.focus();
        });
        picker.appendChild(button);
      });
    }
    picker.hidden = false;
    $('modelToggle').textContent = '▴';
  }
  function toggleModelPicker() {
    if ($('modelPicker').hidden) renderModelPicker('');
    else closeModelPicker();
  }
  function clearLoginFields() {
    uiEpoch++;
    $('apiKey').value = '';
    $('apiKey').type = 'password';
    $('pwToggle').textContent = '显示';
    modelIds = [];
    closeModelPicker();
    renderModels([], '');
    status('codexStatus', '');
    status('modelStatus', '');
    status('saveStatus', '');
  }
  async function fetchCodexModels() {
    if (loggingOut) return;
    var epoch = uiEpoch;
    $('fetchCodexBtn').disabled = true;
    status('codexStatus', '正在检查订阅登录并读取模型…');
    try {
      var result = await send({ action: 'fetchCodexModels' });
      if (epoch !== uiEpoch) return;
      renderModels(result.models, $('codexModel').value || preferredModel);
      status('logoutStatus', '');
      status('codexStatus', 'ChatGPT 订阅已登录，已读取 ' + result.models.length + ' 个模型。选择后点击保存。', 'ok');
    } catch (error) { if (epoch === uiEpoch) status('codexStatus', error.message, 'err'); }
    finally { $('fetchCodexBtn').disabled = loggingOut; }
  }
  async function loginCodex() {
    if (loggingIn || loggingOut) return;
    loggingIn = true;
    var epoch = ++uiEpoch;
    renderModels([], '');
    ['loginCodexBtn', 'fetchCodexBtn', 'saveBtn', 'provider'].forEach(function (id) { $(id).disabled = true; });
    status('codexStatus', '正在打开 ChatGPT 订阅登录页，请在浏览器完成授权；可点击退出取消。');
    try {
      await send({ action: 'loginCodex' });
      if (epoch !== uiEpoch) return;
      status('logoutStatus', '');
      await fetchCodexModels();
    } catch (error) {
      if (epoch === uiEpoch) status('codexStatus', error.message, 'err');
    } finally {
      loggingIn = false;
      ['loginCodexBtn', 'fetchCodexBtn', 'saveBtn', 'provider'].forEach(function (id) { $(id).disabled = loggingOut; });
    }
  }
  async function logout() {
    if (loggingOut) return;
    var provider = $('provider').value;
    var warning = provider === 'codex'
      ? '继续将退出此扩展的订阅登录。'
      : '继续将清除扩展保存的 API Key，但不会撤销服务端密钥。';
    if (!window.confirm(warning + '\n扩展内的模型列表、翻译缓存和 API Key 将清除；Prompt、服务地址等设置保留。是否继续？')) return;
    loggingOut = true;
    clearLoginFields();
    ['logoutBtn', 'loginCodexBtn', 'saveBtn', 'fetchBtn', 'fetchCodexBtn', 'provider', 'apiKey', 'pwToggle'].forEach(function (id) { $(id).disabled = true; });
    status('logoutStatus', '正在清除登录信息…');
    try {
      await send({ action: 'logout', provider: provider });
      status('logoutStatus', provider === 'codex'
        ? '已退出扩展登录。点击“登录 ChatGPT 订阅”可重新授权。'
        : 'API Key 与扩展缓存已清除。重新使用请填写 API Key 并保存。', 'ok');
    } catch (error) { status('logoutStatus', error.message, 'err'); }
    finally {
      loggingOut = false;
      ['logoutBtn', 'loginCodexBtn', 'saveBtn', 'fetchBtn', 'fetchCodexBtn', 'provider', 'apiKey', 'pwToggle'].forEach(function (id) { $(id).disabled = false; });
    }
  }
  async function init() {
    chrome.storage.onChanged.addListener(function (changes, area) {
      if (area !== 'local') return;
      if (changes.authRevision) {
        authRevision = changes.authRevision.newValue || '';
        clearLoginFields();
        if (!loggingOut) status('logoutStatus', '扩展内登录信息已清除。', 'ok');
      } else if (changes.codexSignedOut && changes.codexSignedOut.newValue) {
        renderModels([], '');
      } else if (changes.codexModels) {
        renderModels(changes.codexModels.newValue, $('codexModel').value || preferredModel);
      }
    });
    var epoch = uiEpoch;
    var cfg = await chrome.storage.local.get(null);
    if (epoch === uiEpoch) authRevision = cfg.authRevision || '';
    else { cfg.apiKey = ''; cfg.codexModels = []; }
    preferredModel = cfg.codexModel || '';
    $('provider').value = cfg.provider === 'api' ? 'api' : 'codex';
    ['baseUrl', 'apiKey', 'model'].forEach(function (key) { $(key).value = cfg[key] || ''; });
    $('translationPrompt').value = cfg.translationPrompt === undefined ? window.SMART_TRANSLATE.DEFAULT_PROMPT : cfg.translationPrompt;
    $('temperature').value = cfg.temperature == null ? 0.3 : cfg.temperature;
    renderModels(cfg.codexSignedOut ? [] : cfg.codexModels, cfg.codexModel);
    renderProvider();
    $('provider').addEventListener('change', renderProvider);
    $('fetchCodexBtn').addEventListener('click', fetchCodexModels);
    $('loginCodexBtn').addEventListener('click', loginCodex);
    $('codexModel').addEventListener('change', function () { preferredModel = $('codexModel').value; });
    $('logoutBtn').addEventListener('click', logout);
    $('resetPromptBtn').addEventListener('click', function () {
      if (window.confirm('恢复唯一预设 Prompt？未保存的编辑将丢失。')) {
        $('translationPrompt').value = window.SMART_TRANSLATE.DEFAULT_PROMPT;
        status('saveStatus', '已恢复预设，点击保存后生效。');
      }
    });
    var modelInput = $('model');
    $('modelToggle').addEventListener('click', toggleModelPicker);
    // 每次点击输入框都展开（focus 只触发一次；选中后 focus() 也不能把面板重新打开）。
    modelInput.addEventListener('pointerdown', function () {
      if (modelIds.length && $('modelPicker').hidden) renderModelPicker('');
    });
    modelInput.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !$('modelPicker').hidden) { e.stopPropagation(); closeModelPicker(); }
      else if (e.key === 'ArrowDown' && $('modelPicker').hidden && modelIds.length) {
        e.preventDefault();
        renderModelPicker('');
      }
    });
    modelInput.addEventListener('input', function () {
      if (modelIds.length) renderModelPicker();
      else closeModelPicker();
    });
    modelInput.addEventListener('blur', function (e) {
      // 焦点移到行内其它控件（如 ▾ 按钮）时不关闭，避免刚展开就被收起。
      var to = e.relatedTarget;
      if (to && to.closest && to.closest('.model-row, .model-picker')) return;
      setTimeout(closeModelPicker, 120);
    });
    document.addEventListener('pointerdown', function (event) {
      if ($('modelPicker').hidden) return;
      if (event.target.closest && event.target.closest('.model-row, .model-picker')) return;
      closeModelPicker();
    });
    $('pwToggle').addEventListener('click', function () {
      $('apiKey').type = $('apiKey').type === 'password' ? 'text' : 'password';
      $('pwToggle').textContent = $('apiKey').type === 'password' ? '显示' : '隐藏';
    });
    $('fetchBtn').addEventListener('click', async function () {
      if (loggingOut) return;
      var epoch = uiEpoch;
      $('fetchBtn').disabled = true;
      status('modelStatus', '正在拉取模型…');
      try {
        var result = await send({ action: 'fetchModels', baseUrl: $('baseUrl').value.trim(), apiKey: $('apiKey').value.trim() });
        if (epoch !== uiEpoch) return;
        modelIds = Array.isArray(result.models) ? result.models.filter(function (id) { return typeof id === 'string'; }) : [];
        if (!$('model').value && modelIds.length) $('model').value = modelIds[0];
        if (modelIds.length) renderModelPicker('');
        status('modelStatus', '已读取 ' + modelIds.length + ' 个模型。', 'ok');
      } catch (error) { if (epoch === uiEpoch) status('modelStatus', error.message, 'err'); }
      finally { $('fetchBtn').disabled = loggingOut; }
    });
    $('saveBtn').addEventListener('click', async function () {
      if (loggingOut) return;
      var epoch = uiEpoch;
      var settings = {
        provider: $('provider').value, codexModel: $('codexModel').value,
        baseUrl: $('baseUrl').value.trim(), apiKey: $('apiKey').value.trim(), model: $('model').value.trim(),
        translationPrompt: $('translationPrompt').value, temperature: Number($('temperature').value),
      };
      $('saveBtn').disabled = true;
      try {
        window.SMART_TRANSLATE.getPrompt(settings.translationPrompt);
        await send({ action: 'saveSettings', settings: settings });
        if (epoch === uiEpoch) {
          status('saveStatus', '已保存。', 'ok');
          if (settings.provider === 'api' && settings.apiKey) status('logoutStatus', '');
        }
      } catch (error) { if (epoch === uiEpoch) status('saveStatus', error.message, 'err'); }
      finally { $('saveBtn').disabled = loggingOut; }
    });
    if (cfg.codexSignedOut) status('codexStatus', '扩展已登出，请点击“登录 ChatGPT 订阅”重新授权。');
    else if ($('provider').value === 'codex') await fetchCodexModels();
  }
  document.addEventListener('DOMContentLoaded', function () {
    init().catch(function (error) { status('saveStatus', error.message, 'err'); });
  });
})();
