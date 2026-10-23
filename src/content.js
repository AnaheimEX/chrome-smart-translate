// 内容脚本：划词监听 + 「译」浮标 + 可拖拽自适应译文浮框。
// 所有 UI 渲染在 Shadow DOM 内，样式与网页完全隔离（既不被页面 CSS 破坏，也不污染页面）。
(function () {
  'use strict';

  if (window.__SMART_TRANSLATE_INJECTED__) return;
  window.__SMART_TRANSLATE_INJECTED__ = true;

  var API = self.SMART_TRANSLATE;
  var DEFAULT_FONT_SIZE = 14;
  var MIN_FONT_SIZE = 12;
  var MAX_FONT_SIZE = 28;
  var WINDOW_GAP = 12;
  var MIN_WINDOW_WIDTH = 280;
  var MIN_WINDOW_HEIGHT = 160;
  var DEFAULT_WINDOW_WIDTH = 420;

  var state = {
    enabled: true,
    fontSize: DEFAULT_FONT_SIZE,
    windowSize: null,
    resizing: false,
    pendingContext: {},
    selectionContext: {},
    loadingLabel: null,
    timingLabel: null,
    pendingText: '', // 选区文本（点浮标前）
    selectionText: '', // 正在翻译的原文
    translation: '',
    lastRect: null,
    port: null,
    host: null,
    root: null,
    icon: null,
    box: null,
    handle: null,
    body: null,
    loading: null,
  };

  // ---- 配置 ----
  chrome.storage.local.get({ enabled: true, translationFontSize: DEFAULT_FONT_SIZE, translationWindowSize: null }).then(function (cfg) {
    state.enabled = cfg.enabled !== false;
    applyFontSize(cfg.translationFontSize);
    state.windowSize = readWindowSize(cfg.translationWindowSize);
    applyWindowSize();
  });
  chrome.storage.onChanged.addListener(function (changes, area) {
    if (area !== 'local') return;
    if (changes.enabled) state.enabled = changes.enabled.newValue !== false;
    if (changes.translationFontSize) applyFontSize(changes.translationFontSize.newValue);
    if (changes.translationWindowSize && !state.resizing) {
      state.windowSize = readWindowSize(changes.translationWindowSize.newValue);
      applyWindowSize();
    }
    if (changes.authRevision) {
      hideIcon();
      hideBox();
      state.pendingText = state.selectionText = state.translation = '';
      state.pendingContext = state.selectionContext = {};
      if (state.body) state.body.textContent = '';
      if (state.timingLabel) state.timingLabel.textContent = '';
    }
  });

  // ---- 样式（注入 Shadow Root）----
  // 「晴空」：明亮毛玻璃浮窗 + 天蓝渐变品牌色 + 杏橙火花点缀，与扩展图标、设置页一致；跟随系统明暗。
  var STYLE = `
    :host{all:initial;color-scheme:light;
      --ink:#172133;--muted:#5b6678;--faint:#8a94a6;--line:rgba(24,48,96,.08);--edge:rgba(24,48,96,.13);
      --accent:#1f63f0;--grad:linear-gradient(135deg,#3d7dff,#1f9bff);--brand:linear-gradient(140deg,#5c9dff,#2f74ff 52%,#1f8cf5);
      --spark:#ffaa4d;--hover:rgba(31,99,240,.08);--danger:#c92c45;--danger-soft:rgba(201,44,69,.09);--ok:#0b7a52;--ok-dot:#1fbf84;
      --surface:linear-gradient(180deg,rgba(255,255,255,.94),rgba(247,250,255,.95));
      --glow-a:rgba(64,140,255,.13);--glow-b:rgba(255,170,100,.13);
      --shadow:0 28px 64px -18px rgba(18,40,90,.34),0 10px 24px -12px rgba(18,40,90,.18),inset 0 1px 0 rgba(255,255,255,.9);
      --chip:rgba(24,48,96,.035);--footer:rgba(234,241,250,.6);
      --btn-bg:rgba(31,99,240,.08);--btn-line:rgba(31,99,240,.2);--btn-ink:#1a58dc;
      --btn-bg-hover:rgba(31,99,240,.14);--btn-line-hover:rgba(31,99,240,.38);--btn-ink-hover:#1449c0;
      --ok-bg:rgba(11,122,82,.09);--ok-line:rgba(11,122,82,.32);
      --skel-a:rgba(31,99,240,.06);--skel-b:rgba(31,99,240,.17);--select:rgba(31,99,240,.18);--scroll:rgba(24,48,96,.2);
      --font:-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC','Hiragino Sans GB','Microsoft YaHei',sans-serif;}
    @media(prefers-color-scheme:dark){:host{color-scheme:dark;
      --ink:#edf1f7;--muted:#a3acba;--faint:#7a8494;--line:rgba(255,255,255,.07);--edge:rgba(255,255,255,.12);
      --accent:#6aa9ff;--hover:rgba(106,169,255,.12);--danger:#ff8a98;--danger-soft:rgba(255,138,152,.13);--ok:#6fdcaa;--ok-dot:#4fd69c;
      --surface:linear-gradient(180deg,rgba(37,40,48,.95),rgba(26,28,34,.96));
      --glow-a:rgba(64,140,255,.17);--glow-b:rgba(255,160,90,.07);
      --shadow:0 28px 70px -14px rgba(0,0,0,.6),0 10px 26px -10px rgba(0,0,0,.45),inset 0 1px 0 rgba(255,255,255,.06);
      --chip:rgba(255,255,255,.04);--footer:rgba(0,0,0,.16);
      --btn-bg:rgba(106,169,255,.12);--btn-line:rgba(106,169,255,.28);--btn-ink:#a9cbff;
      --btn-bg-hover:rgba(106,169,255,.2);--btn-line-hover:rgba(106,169,255,.48);--btn-ink-hover:#fff;
      --ok-bg:rgba(111,220,170,.13);--ok-line:rgba(111,220,170,.42);
      --skel-a:rgba(106,169,255,.07);--skel-b:rgba(106,169,255,.22);--select:rgba(106,169,255,.32);--scroll:rgba(255,255,255,.2);}}
    *{box-sizing:border-box;}
    .st-icon{position:fixed;z-index:2147483647;display:none;align-items:center;gap:6px;height:28px;padding:0 11px 0 10px;
      border:1px solid rgba(255,255,255,.3);border-radius:14px;background:var(--grad);
      color:#fff;font:600 13px/1 var(--font);letter-spacing:.02em;text-shadow:0 1px 1px rgba(10,40,120,.25);cursor:pointer;user-select:none;
      box-shadow:0 6px 16px -4px rgba(31,107,255,.55),0 1px 3px rgba(10,30,80,.2),0 0 0 3px rgba(61,125,255,.16);
      transition:transform .15s,box-shadow .15s;animation:st-pop .22s cubic-bezier(.2,.9,.3,1.25);}
    .st-icon::before{content:'';width:6px;height:6px;border-radius:1.5px;background:var(--spark);transform:rotate(45deg);box-shadow:0 0 8px rgba(255,170,77,.95);}
    .st-icon:hover{transform:translateY(-1px);box-shadow:0 10px 22px -6px rgba(31,107,255,.6),0 1px 3px rgba(10,30,80,.2),0 0 0 4px rgba(61,125,255,.24);}
    .st-icon:active{transform:scale(.95);}
    .st-box{position:fixed;z-index:2147483647;display:none;flex-direction:column;width:420px;
      max-width:calc(100vw - 24px);max-height:calc(100vh - 24px);min-height:min(160px,calc(100vh - 24px));
      color:var(--ink);border:1px solid var(--edge);border-radius:18px;overflow:hidden;
      background:radial-gradient(420px 220px at 0 0,var(--glow-a),transparent 70%),
        radial-gradient(320px 180px at 100% 0,var(--glow-b),transparent 70%),var(--surface);
      -webkit-backdrop-filter:blur(22px) saturate(1.6);backdrop-filter:blur(22px) saturate(1.6);
      box-shadow:var(--shadow);font:400 14px/1.5 var(--font);animation:st-fade .2s ease-out;}
    .st-box>*{animation:st-rise .26s cubic-bezier(.2,.8,.2,1);}
    .st-box::before{content:'';position:absolute;left:28px;right:28px;top:0;height:1px;pointer-events:none;
      background:linear-gradient(90deg,transparent,rgba(61,125,255,.75),rgba(31,155,255,.7),rgba(255,170,77,.7),transparent);}
    .st-box ::selection{background:var(--select);}
    .st-header{display:flex;align-items:center;gap:8px;flex:0 0 auto;padding:9px 9px 9px 14px;border-bottom:1px solid var(--line);}
    .st-handle{flex:1;min-width:0;display:flex;align-items:center;gap:9px;align-self:stretch;cursor:grab;touch-action:none;
      user-select:none;font-size:13px;font-weight:600;letter-spacing:.04em;color:var(--ink);}
    .st-handle:active{cursor:grabbing;}
    .st-mark{flex:0 0 auto;display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:7px;
      background:var(--brand);color:#fff;font-size:12px;font-weight:700;letter-spacing:0;text-shadow:0 1px 1px rgba(10,40,120,.3);
      box-shadow:0 3px 10px -2px rgba(47,116,255,.5),inset 0 1px 0 rgba(255,255,255,.4);}
    .st-title{min-width:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;}
    .st-box[data-phase=loading] .st-mark{animation:st-ripple 1.4s ease-out infinite;}
    .st-box[data-phase=error] .st-mark{background:linear-gradient(135deg,#ff9a8a,#f04d6a);box-shadow:0 3px 10px -2px rgba(240,77,106,.5),inset 0 1px 0 rgba(255,255,255,.4);}
    .st-box[data-phase=error] .st-title{color:var(--danger);}
    .st-font-controls{display:flex;align-items:center;flex:0 0 auto;padding:2px;border:1px solid var(--line);border-radius:10px;background:var(--chip);}
    .st-box button{font-family:inherit;line-height:1;cursor:pointer;transition:background .15s,color .15s,border-color .15s,box-shadow .15s,opacity .15s;}
    .st-box .st-font-btn{flex:0 0 auto;min-width:28px;height:26px;padding:0 6px;border:0;border-radius:8px;background:transparent;color:var(--muted);font-size:12px;font-weight:600;}
    .st-box .st-font-btn:nth-child(2){min-width:44px;color:var(--ink);font-weight:500;font-variant-numeric:tabular-nums;}
    .st-close,.st-size-reset,.st-resize{flex:0 0 auto;width:30px;height:30px;display:inline-flex;align-items:center;justify-content:center;
      padding:0;border:0;border-radius:9px;background:transparent;color:var(--muted);}
    .st-box button:hover:not(:disabled){background:var(--hover);color:var(--accent);}
    .st-box .st-close:hover:not(:disabled){background:var(--danger-soft);color:var(--danger);}
    .st-box button:focus-visible,.st-body:focus-visible{outline:2px solid var(--accent);outline-offset:-2px;}
    .st-box button:disabled{opacity:.3;cursor:default;}
    .st-body{flex:1 1 auto;min-height:0;padding:16px 20px 18px;font-size:14px;line-height:1.8;letter-spacing:.015em;color:var(--ink);
      white-space:pre-wrap;word-break:normal;overflow-wrap:anywhere;overflow:auto;overscroll-behavior:contain;
      scrollbar-width:thin;scrollbar-color:var(--scroll) transparent;}
    .st-body.st-error{color:var(--danger);}
    .st-box[data-phase=loading] .st-body::after{content:'';display:inline-block;width:2px;height:1.05em;margin-left:3px;vertical-align:-.18em;
      border-radius:1px;background:var(--grad);animation:st-blink 1s step-end infinite;}
    .st-footer{display:flex;align-items:center;gap:4px;flex:0 0 auto;padding:7px 8px 7px 16px;border-top:1px solid var(--line);background:var(--footer);}
    .st-timing{flex:1;min-width:0;color:var(--faint);font-size:11px;font-variant-numeric:tabular-nums;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
    .st-timing:not(:empty)::before{content:'';display:inline-block;width:6px;height:6px;margin-right:7px;vertical-align:1px;border-radius:50%;
      background:var(--ok-dot);box-shadow:0 0 6px var(--ok-dot);}
    .st-box .st-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;height:30px;margin-left:2px;padding:0 12px;
      border:1px solid var(--btn-line);border-radius:9px;background:var(--btn-bg);color:var(--btn-ink);font-size:12px;font-weight:600;white-space:nowrap;}
    .st-box .st-btn:hover:not(:disabled){border-color:var(--btn-line-hover);background:var(--btn-bg-hover);color:var(--btn-ink-hover);}
    .st-box .st-btn.st-copied,.st-box .st-btn.st-copied:hover:not(:disabled){border-color:var(--ok-line);background:var(--ok-bg);color:var(--ok);}
    .st-btn svg{flex:0 0 auto;}
    .st-btn .st-ico-check,.st-btn.st-copied .st-ico-copy{display:none;}
    .st-btn.st-copied .st-ico-check{display:block;}
    .st-resize{cursor:nwse-resize!important;touch-action:none;user-select:none;color:var(--faint);}
    .st-resizing,.st-resizing *{cursor:nwse-resize!important;user-select:none;}
    .st-box .st-setup-btn{display:inline-flex;align-items:center;margin-top:14px;padding:9px 16px;border:0;border-radius:10px;
      background:var(--grad);color:#fff;font-size:13px;font-weight:700;letter-spacing:.02em;text-shadow:0 1px 1px rgba(10,40,120,.25);
      box-shadow:0 8px 18px -8px rgba(31,107,255,.8),inset 0 1px 0 rgba(255,255,255,.3);}
    .st-box .st-setup-btn:hover:not(:disabled){background:var(--grad);color:#fff;filter:brightness(1.08);}
    .st-loading{display:none;flex-direction:column;justify-content:center;gap:10px;flex:1;min-height:104px;padding:18px 20px 22px;}
    .st-loading span{display:block;height:9px;border-radius:5px;background:linear-gradient(90deg,var(--skel-a) 20%,var(--skel-b) 50%,var(--skel-a) 80%);
      background-size:250% 100%;animation:st-shimmer 1.6s ease-in-out infinite;}
    .st-loading span:nth-child(1){width:92%;}
    .st-loading span:nth-child(2){width:100%;animation-delay:.12s;}
    .st-loading span:nth-child(3){width:62%;animation-delay:.24s;}
    .st-loading-label{order:-1;display:flex;align-items:center;gap:8px;margin-bottom:4px;font-style:normal;font-size:12px;color:var(--muted);}
    .st-loading-label::before{content:'';flex:0 0 auto;width:12px;height:12px;border-radius:50%;
      border:2px solid var(--skel-b);border-top-color:var(--accent);animation:st-spin .75s linear infinite;}
    @keyframes st-pop{from{opacity:0;transform:translateY(3px) scale(.85);}to{opacity:1;transform:none;}}
    /* 浮窗本身只淡入，不做位移：拖动、夹紧视口都依赖它的 getBoundingClientRect。位移动画只放在内部子元素上。 */
    @keyframes st-fade{from{opacity:0;}}
    @keyframes st-rise{from{transform:translateY(5px);}}
    @keyframes st-ripple{from{box-shadow:0 3px 10px -2px rgba(47,116,255,.5),inset 0 1px 0 rgba(255,255,255,.4),0 0 0 0 rgba(61,125,255,.45);}
      to{box-shadow:0 3px 10px -2px rgba(47,116,255,.5),inset 0 1px 0 rgba(255,255,255,.4),0 0 0 7px rgba(61,125,255,0);}}
    @keyframes st-shimmer{from{background-position:100% 0;}to{background-position:0 0;}}
    @keyframes st-spin{to{transform:rotate(360deg);}}
    @keyframes st-blink{50%{opacity:0;}}
    @media(prefers-reduced-motion:reduce){.st-icon,.st-box,.st-box *,.st-box *::before,.st-box *::after{transition:none!important;animation:none!important;}}
  `;

  function ensureHost() {
    if (state.host) return;
    var host = document.createElement('div');
    host.id = '__smart_translate_host__';
    host.style.cssText = 'all:initial;position:fixed;top:0;left:0;width:0;height:0;z-index:2147483647;';
    (document.body || document.documentElement).appendChild(host);
    var root = host.attachShadow({ mode: 'open' });
    var style = document.createElement('style');
    style.textContent = STYLE;
    root.appendChild(style);
    state.host = host;
    state.root = root;
    buildIcon();
    buildBox();
  }

  function buildIcon() {
    var icon = document.createElement('div');
    icon.className = 'st-icon';
    icon.textContent = '译';
    icon.addEventListener('mousedown', function (e) {
      e.preventDefault(); // 避免点击时清空选区
      e.stopPropagation();
    });
    icon.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      onIconClick();
    });
    state.root.appendChild(icon);
    state.icon = icon;
  }

  function buildBox() {
    var box = document.createElement('div');
    box.className = 'st-box';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-label', '划词翻译');
    box.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !e.isComposing) {
        e.preventDefault();
        e.stopPropagation();
        hideBox();
      }
    });

    var header = document.createElement('div');
    header.className = 'st-header';

    var handle = document.createElement('div');
    handle.className = 'st-handle';
    handle.title = '拖动标题栏移动窗口';
    var mark = document.createElement('span');
    mark.className = 'st-mark';
    mark.textContent = '译';
    mark.setAttribute('aria-hidden', 'true');
    var title = document.createElement('span');
    title.className = 'st-title';
    title.textContent = '译文';
    state.title = title;
    handle.appendChild(mark);
    handle.appendChild(title);

    var close = document.createElement('button');
    close.className = 'st-close';
    close.type = 'button';
    close.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg>';
    close.title = '关闭';
    close.setAttribute('aria-label', '关闭翻译窗口');
    close.addEventListener('click', function () {
      hideBox();
    });

    header.appendChild(handle);
    var fontControls = document.createElement('div');
    fontControls.className = 'st-font-controls';
    fontControls.setAttribute('role', 'group');
    fontControls.setAttribute('aria-label', '译文字号');
    function fontButton(text, label, change) {
      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'st-font-btn';
      button.textContent = text;
      button.title = label;
      button.setAttribute('aria-label', label);
      button.addEventListener('click', function () {
        applyFontSize(change === 0 ? DEFAULT_FONT_SIZE : state.fontSize + change);
        chrome.storage.local.set({ translationFontSize: state.fontSize }).catch(function () {
          console.warn('划词翻译：字号已调整，但未能保存，请刷新页面后重试。');
        });
      });
      fontControls.appendChild(button);
      return button;
    }
    state.fontDecrease = fontButton('A−', '缩小译文字号', -2);
    state.fontReset = fontButton('', '恢复默认字号（14px）', 0);
    state.fontIncrease = fontButton('A+', '放大译文字号', 2);
    header.appendChild(fontControls);
    header.appendChild(close);

    var loading = document.createElement('div');
    loading.className = 'st-loading';
    loading.appendChild(document.createElement('span'));
    loading.appendChild(document.createElement('span'));
    loading.appendChild(document.createElement('span'));

    var loadingLabel = document.createElement('em');
    loadingLabel.className = 'st-loading-label';
    loadingLabel.textContent = '正在连接翻译模型…';
    loading.appendChild(loadingLabel);
    state.loadingLabel = loadingLabel;

    var body = document.createElement('div');
    body.className = 'st-body';
    body.setAttribute('aria-live', 'polite');
    body.setAttribute('aria-label', '译文');
    body.tabIndex = 0;

    var footer = document.createElement('div');
    footer.className = 'st-footer';
    var timingLabel = document.createElement('span');
    timingLabel.className = 'st-timing';
    footer.appendChild(timingLabel);
    state.timingLabel = timingLabel;
    var copyBtn = document.createElement('button');
    copyBtn.className = 'st-btn';
    copyBtn.type = 'button';
    copyBtn.innerHTML = '<svg class="st-ico-copy" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="8" y="8" width="12" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/></svg>' +
      '<svg class="st-ico-check" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>';
    var copyLabel = document.createElement('span');
    copyLabel.textContent = '复制译文';
    copyBtn.appendChild(copyLabel);
    state.copyLabel = copyLabel;
    copyBtn.disabled = true;
    copyBtn.addEventListener('click', onCopy);
    var sizeReset = document.createElement('button');
    sizeReset.type = 'button';
    sizeReset.className = 'st-size-reset';
    sizeReset.title = '恢复自动大小';
    sizeReset.setAttribute('aria-label', '恢复自动大小');
    state.sizeReset = sizeReset;
    sizeReset.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 10a9 9 0 1 1 2 8M3 4v6h6"/></svg>';
    sizeReset.addEventListener('click', function () {
      state.windowSize = null;
      applyWindowSize();
      saveWindowSize();
    });
    footer.appendChild(sizeReset);
    footer.appendChild(copyBtn);
    var resize = document.createElement('button');
    resize.type = 'button';
    resize.className = 'st-resize';
    resize.title = '拖动调整宽高；方向键微调，Shift 加速';
    resize.setAttribute('aria-label', '调整窗口大小');
    resize.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><path d="m5 19 14-14M12 19l7-7M18 19l1-1"/></svg>';
    footer.appendChild(resize);

    box.appendChild(header);
    box.appendChild(loading);
    box.appendChild(body);
    box.appendChild(footer);
    state.root.appendChild(box);

    state.box = box;
    state.handle = handle;
    state.body = body;
    state.loading = loading;
    state.copyBtn = copyBtn;

    applyFontSize(state.fontSize);
    applyWindowSize();
    enableDrag(handle, box);
    enableResize(resize, box);
  }

  function applyFontSize(value) {
    state.fontSize = typeof value === 'number' && Number.isFinite(value)
      ? Math.max(MIN_FONT_SIZE, Math.min(MAX_FONT_SIZE, Math.round(value))) : DEFAULT_FONT_SIZE;
    if (!state.body) return;
    state.body.style.fontSize = state.fontSize + 'px';
    state.fontReset.textContent = state.fontSize + 'px';
    state.fontDecrease.disabled = state.fontSize <= MIN_FONT_SIZE;
    state.fontIncrease.disabled = state.fontSize >= MAX_FONT_SIZE;
    queueLayout();
  }

  function readWindowSize(value) {
    return value && Number.isFinite(value.width) && Number.isFinite(value.height)
      && value.width > 0 && value.height > 0
      ? { width: value.width, height: value.height } : null;
  }

  function clampDimension(value, minimum, available) {
    available = Math.max(1, available);
    return Math.round(Math.max(Math.min(minimum, available), Math.min(value, available)));
  }

  function applyWindowSize() {
    if (!state.box) return;
    var size = state.windowSize;
    state.box.style.width = clampDimension(size ? size.width : DEFAULT_WINDOW_WIDTH,
      MIN_WINDOW_WIDTH, window.innerWidth - WINDOW_GAP * 2) + 'px';
    state.box.style.height = size ? clampDimension(size.height, MIN_WINDOW_HEIGHT,
      window.innerHeight - WINDOW_GAP * 2) + 'px' : 'auto';
    state.sizeReset.disabled = !size;
    queueLayout();
  }

  function saveWindowSize() {
    chrome.storage.local.set({ translationWindowSize: state.windowSize }).catch(function () {
      console.warn('划词翻译：窗口尺寸未能保存，请刷新页面后重试。');
    });
  }

  function enableResize(handle, box) {
    var drag = null;
    function resizeTo(width, height) {
      var rect = box.getBoundingClientRect();
      state.windowSize = {
        width: clampDimension(width, MIN_WINDOW_WIDTH, window.innerWidth - rect.left - WINDOW_GAP),
        height: clampDimension(height, MIN_WINDOW_HEIGHT, window.innerHeight - rect.top - WINDOW_GAP),
      };
      applyWindowSize();
    }
    handle.addEventListener('pointerdown', function (e) {
      if (e.button !== 0 || e.isPrimary === false) return;
      var rect = box.getBoundingClientRect();
      drag = { id: e.pointerId, x: e.clientX, y: e.clientY, width: rect.width, height: rect.height };
      state.resizing = true;
      box.classList.add('st-resizing');
      handle.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    handle.addEventListener('pointermove', function (e) {
      if (!drag || e.pointerId !== drag.id) return;
      resizeTo(drag.width + e.clientX - drag.x, drag.height + e.clientY - drag.y);
      e.preventDefault();
    });
    function finish(e) {
      if (!drag || e.pointerId !== drag.id) return;
      drag = null;
      state.resizing = false;
      box.classList.remove('st-resizing');
      saveWindowSize();
    }
    handle.addEventListener('pointerup', finish);
    handle.addEventListener('pointercancel', finish);
    handle.addEventListener('lostpointercapture', finish);
    handle.addEventListener('keydown', function (e) {
      if (e.altKey || e.metaKey || e.ctrlKey || !/^Arrow(Left|Right|Up|Down)$/.test(e.key)) return;
      e.preventDefault();
      e.stopPropagation();
      var rect = box.getBoundingClientRect(), step = e.shiftKey ? 40 : 10;
      resizeTo(rect.width + (e.key === 'ArrowRight' ? step : e.key === 'ArrowLeft' ? -step : 0),
        rect.height + (e.key === 'ArrowDown' ? step : e.key === 'ArrowUp' ? -step : 0));
      saveWindowSize();
    });
  }

  // ---- 拖拽 ----
  function enableDrag(handle, box) {
    var dragging = false;
    var offX = 0;
    var offY = 0;
    handle.addEventListener('pointerdown', function (e) {
      if (e.button !== 0 || e.isPrimary === false) return;
      dragging = true;
      var r = box.getBoundingClientRect();
      offX = e.clientX - r.left;
      offY = e.clientY - r.top;
      try {
        handle.setPointerCapture(e.pointerId);
      } catch (_) {}
      e.preventDefault();
    });
    handle.addEventListener('pointermove', function (e) {
      if (!dragging) return;
      var left = e.clientX - offX;
      var top = e.clientY - offY;
      left = Math.max(WINDOW_GAP, Math.min(left, window.innerWidth - box.offsetWidth - WINDOW_GAP));
      top = Math.max(WINDOW_GAP, Math.min(top, window.innerHeight - box.offsetHeight - WINDOW_GAP));
      box.style.left = left + 'px';
      box.style.top = top + 'px';
    });
    function endDrag(e) {
      dragging = false;
      try {
        handle.releasePointerCapture(e.pointerId);
      } catch (_) {}
    }
    handle.addEventListener('pointerup', endDrag);
    handle.addEventListener('pointercancel', endDrag);
    handle.addEventListener('lostpointercapture', function () { dragging = false; });
  }

  // ---- 选区与浮标 ----
  function captureContext(range, selectedText) {
    var node = range.commonAncestorContainer;
    var element = node.nodeType === 1 ? node : node.parentElement;
    if (!element || element.closest('input,textarea,[contenteditable="true"],[role="textbox"]')) return {};
    var block = element.closest('p,li,td,th,blockquote,pre,figcaption,h1,h2,h3,h4') || element;
    var nearby = '';
    // Inspect only the selected local block, never the full document or form values.
    if (block !== document.body && block !== document.documentElement) {
      var raw = (block.innerText || '').replace(/\s+/g, ' ').trim();
      var selected = selectedText.replace(/\s+/g, ' ').trim();
      var index = raw.indexOf(selected);
      if (index >= 0) nearby = raw.slice(Math.max(0, index - 250), index) + ' [选区] ' + raw.slice(index + selected.length, index + selected.length + 250);
      if (raw === selected) nearby = '';
    }
    var section = element.closest('section,article');
    var heading = section && section.querySelector('h1,h2,h3');
    var result = { title: document.title, heading: heading ? heading.textContent : '', nearby: nearby };
    return API.sanitizeContext ? API.sanitizeContext(result) : {};
  }

  function onMouseUp(e) {
    if (!state.enabled) return;
    if (state.host && e.target === state.host) return; // 点在自己 UI 上
    setTimeout(function () {
      var sel = window.getSelection();
      var text = sel ? String(sel).trim() : '';
      if (!text || !sel.rangeCount) {
        hideIcon();
        return;
      }
      var range = sel.getRangeAt(0);
      var rects = range.getClientRects();
      var rect = rects.length ? rects[rects.length - 1] : range.getBoundingClientRect();
      if (!rect || (!rect.width && !rect.height)) {
        hideIcon();
        return;
      }
      state.pendingText = text;
      state.pendingContext = captureContext(range, text);
      try {
        chrome.runtime.sendMessage({ action: 'warmCodex', text: text, context: state.pendingContext }, function () { void chrome.runtime.lastError; });
      } catch (_) {}
      state.lastRect = rect;
      showIcon(rect);
    }, 0);
  }

  function onMouseDown(e) {
    if (state.host && e.target === state.host) return; // 点在 UI 上，保留
    hideIcon();
  }

  function showIcon(rect) {
    ensureHost();
    var icon = state.icon;
    icon.style.display = 'inline-flex';
    var iw = icon.offsetWidth || 36;
    var left = rect.right + 6;
    var top = rect.bottom + 6;
    if (left + iw > window.innerWidth - 4) left = window.innerWidth - iw - 4;
    if (top + 30 > window.innerHeight - 4) top = rect.top - 32;
    icon.style.left = Math.max(4, left) + 'px';
    icon.style.top = Math.max(4, top) + 'px';
  }

  function hideIcon() {
    if (state.icon) state.icon.style.display = 'none';
  }

  function onIconClick() {
    var text = state.pendingText;
    if (!text) return;
    hideIcon();
    state.selectionText = text;
    state.selectionContext = state.pendingContext;
    translate(text);
  }

  function showBox(rect) {
    ensureHost();
    var box = state.box;
    box.style.display = 'flex';
    applyWindowSize();
    // 先放到选区下方，渲染后再夹紧进视口
    var left = rect ? rect.left : 40;
    var top = rect ? rect.bottom + 12 : 40;
    box.style.left = Math.max(WINDOW_GAP, left) + 'px';
    box.style.top = Math.max(WINDOW_GAP, top) + 'px';
    requestAnimationFrame(function () {
      var bw = box.offsetWidth;
      var bh = box.offsetHeight;
      var l = parseFloat(box.style.left);
      var t = parseFloat(box.style.top);
      if (l + bw > window.innerWidth - WINDOW_GAP) l = window.innerWidth - bw - WINDOW_GAP;
      if (t + bh > window.innerHeight - WINDOW_GAP) {
        // 放不下就移到选区上方
        t = rect ? rect.top - bh - 12 : window.innerHeight - bh - WINDOW_GAP;
      }
      box.style.left = Math.max(WINDOW_GAP, l) + 'px';
      box.style.top = Math.max(WINDOW_GAP, t) + 'px';
    });
  }

  function hideBox() {
    if (state.box) state.box.style.display = 'none';
    disconnectPort();
  }

  // ---- 翻译 ----
  function setLoading(on) {
    if (state.loading) state.loading.style.display = on ? 'flex' : 'none';
    if (state.body) state.body.style.display = on ? 'none' : 'block';
  }

  // 仅供样式使用的阶段标记：loading（等待/流式输出）、done、error。
  function setPhase(phase) {
    if (state.box) state.box.setAttribute('data-phase', phase);
  }

  function renderText(text, isError) {
    var body = state.body;
    body.className = 'st-body' + (isError ? ' st-error' : '');
    if (isError) setPhase('error');
    body.textContent = text;
    state.copyBtn.disabled = !state.translation;
    queueLayout();
  }

  function queueLayout() {
    if (!state.layoutFrame) state.layoutFrame = requestAnimationFrame(function () {
      state.layoutFrame = null;
      if (!state.box || state.box.style.display === 'none') return;
      var rect = state.box.getBoundingClientRect();
      if (rect.bottom > window.innerHeight - WINDOW_GAP) state.box.style.top = Math.max(WINDOW_GAP, window.innerHeight - rect.height - WINDOW_GAP) + 'px';
      if (rect.right > window.innerWidth - WINDOW_GAP) state.box.style.left = Math.max(WINDOW_GAP, window.innerWidth - rect.width - WINDOW_GAP) + 'px';
    });
  }

  function disconnectPort() {
    if (state.port) {
      try {
        state.port.disconnect();
      } catch (_) {}
      state.port = null;
    }
  }

  function translate(text) {
    disconnectPort();
    state.translation = '';
    if (state.timingLabel) { state.timingLabel.textContent = ''; state.timingLabel.title = ''; }
    var startedAt = performance.now();
    var firstTokenMs = null;
    function updateTiming(done, cached) {
      var elapsed = performance.now() - startedAt;
      if (cached) state.timingLabel.textContent = '缓存 · ' + (elapsed / 1000).toFixed(1) + 's';
      else state.timingLabel.textContent = (firstTokenMs === null ? '' : '首字 ' + (firstTokenMs / 1000).toFixed(1) + 's') +
        (done ? ' · 完成 ' + (elapsed / 1000).toFixed(1) + 's' : '');
    }
    if (state.title) state.title.textContent = '翻译中';
    setPhase('loading');
    renderText('');
    setLoading(true);
    if (state.loadingLabel) state.loadingLabel.textContent = '正在连接翻译模型…';
    showBox(state.lastRect);

    var port;
    try {
      if (!chrome.runtime || !chrome.runtime.id) throw new Error('扩展上下文已失效，请刷新页面。');
      port = chrome.runtime.connect({ name: 'translate' });
    } catch (e) {
      setLoading(false);
      renderText(String((e && e.message) || e), true);
      showBox(state.lastRect);
      return;
    }
    state.port = port;
    var completed = false;

    port.onMessage.addListener(function (msg) {
      if (!msg || state.port !== port) return;
      if (msg.type === 'progress') {
        if (state.loadingLabel && !state.translation) state.loadingLabel.textContent = msg.message || '正在翻译…';
      } else if (msg.type === 'delta') {
        if (!msg.text) return;
        // Models may stream leading blank lines separately from the translation.
        // Normalize the accumulated text so display and clipboard stay consistent.
        state.translation = (state.translation + msg.text).trimStart();
        if (!state.translation) return;
        if (firstTokenMs === null) { firstTokenMs = performance.now() - startedAt; updateTiming(false); }
        setLoading(false);
        renderText(state.translation);
      } else if (msg.type === 'done') {
        completed = true;
        if (state.title) state.title.textContent = '译文';
        setPhase('done');
        setLoading(false);
        if (typeof msg.text === 'string') { state.translation = msg.text.trimStart(); renderText(state.translation); }
        if (!state.translation) renderText('（无译文）', true);
        else {
          if (firstTokenMs === null) firstTokenMs = performance.now() - startedAt;
          updateTiming(true, msg.timing && msg.timing.cached);
          if (msg.timing && typeof msg.timing.setupMs === 'number') state.timingLabel.title = '本地准备 ' + (msg.timing.setupMs / 1000).toFixed(2) + 's；推理强度 ' + msg.timing.effort;
        }
        disconnectPort();
      } else if (msg.type === 'error') {
        completed = true;
        if (state.title) state.title.textContent = '翻译失败';
        setLoading(false);
        showError(msg);
        disconnectPort();
      }
    });
    port.onDisconnect.addListener(function () {
      if (state.port !== port) return;
      state.port = null;
      if (!completed) {
        setLoading(false);
        renderText('翻译连接已中断，请重试。', true);
        showBox(state.lastRect);
      }
    });

    try {
      port.postMessage({ type: 'start', text: text, context: state.selectionContext });
    } catch (e) {
      setLoading(false);
      renderText(String((e && e.message) || e), true);
      showBox(state.lastRect);
    }
  }

  function showError(msg) {
    renderText(msg.message || '翻译失败', true);
    if (msg.code === 'NO_CONFIG') {
      var btn = document.createElement('button');
      btn.className = 'st-setup-btn';
      btn.textContent = '打开设置';
      btn.addEventListener('click', function () {
        try {
          chrome.runtime.sendMessage({ action: 'openOptions' });
        } catch (_) {}
      });
      state.body.appendChild(document.createElement('br'));
      state.body.appendChild(btn);
    }
  }

  function onCopy() {
    var t = state.translation || '';
    if (!t) return;
    var done = function () {
      state.copyLabel.textContent = '已复制';
      state.copyBtn.classList.add('st-copied');
      setTimeout(function () {
        state.copyLabel.textContent = '复制译文';
        state.copyBtn.classList.remove('st-copied');
      }, 1200);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(t).then(done, function () {
        fallbackCopy(t, done);
      });
    } else {
      fallbackCopy(t, done);
    }
  }

  function fallbackCopy(text, done) {
    try {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.style.cssText = 'position:fixed;left:-9999px;top:0;';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      done();
    } catch (_) {}
  }

  window.addEventListener('resize', applyWindowSize);
  document.addEventListener('mouseup', onMouseUp, true);
  document.addEventListener('mousedown', onMouseDown, true);
})();
