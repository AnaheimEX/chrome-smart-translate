# Chrome 划词智能翻译扩展 — 设计文档

- 日期：2026-06-11
- 产物目录：`~/Downloads/Project/chrome-smart-translate`
- 状态：设计已确认，待写实现计划

## 1. 目标

一个 Chrome (Manifest V3) 扩展：在网页上选中任意语言文本后，于选区末尾弹出「译」浮标，点击后在可拖拽、自适应的浮框中**流式**展示译成简体中文的结果。翻译会**结合内容领域与语境**选用对应中文圈术语（游戏、ACG 等）。支持接入任意**兼容 OpenAI 接口**的自定义 provider，并能按 base url + api key **拉取可选模型列表**。

## 2. 选型（已确认）

| 维度 | 决定 |
|------|------|
| 平台 | Chrome Manifest V3 |
| 技术栈 | 纯原生 JS，零依赖、零构建，直接「加载已解压扩展」 |
| 译文显示 | 流式逐字（`stream: true`，经 Port 转发增量） |
| 领域识别 | 默认全自动（模型自判）+ 浮框手动切换 + 设置页全局默认领域 |
| 领域预设 | 4 个：🤖 自动 / 🎮 游戏 / 🌸 ACG 二次元 / 💬 通用 |
| 目标语言 | 划词翻译固定简体中文；弹窗文本翻译可选英语/日语 |
| 网络位置 | 全部在 service worker（凭 host_permissions 跨域，规避 CORS） |
| 样式隔离 | 浮标/浮框挂在 Shadow DOM |

## 3. 目录结构

```
chrome-smart-translate/
├── manifest.json
├── src/
│   ├── domains.js        # 单一真源：self.SMART_TRANSLATE_DOMAINS = [{key,label,prompt}]
│   ├── background.js     # service worker：importScripts('domains.js')；流式翻译 + 拉取模型
│   ├── content.js        # 划词监听 + 「译」浮标 + 译文浮框 + 拖拽（Shadow DOM）
│   ├── content.css       # 注入 Shadow DOM 的样式
│   ├── options.html
│   ├── options.js        # base url / api key / model（拉取或手动）/ 默认领域 / 温度
│   ├── options.css
│   ├── popup.html
│   └── popup.js          # 启用开关 + 打开设置入口
├── icons/                # icon16.png / icon48.png / icon128.png
├── docs/superpowers/specs/2026-06-11-chrome-smart-translate-design.md
└── README.md
```

## 4. 组件与职责（各自隔离、接口清晰）

### 4.1 `domains.js`（共享配置，单一真源）
- 导出 `self.SMART_TRANSLATE_DOMAINS`：领域数组，每项 `{ key, label, prompt }`。
- `self` 在 service worker 全局与 content 脚本隔离世界中都可用；background 用 `importScripts`，content 按 manifest 中排在 `content.js` 前加载，二者共享同一定义，避免漂移。

### 4.2 `background.js`（service worker）
- 职责一 **翻译**：监听 `chrome.runtime.connect`（name=`translate`）。收到 `{text, domainKey}` 后读取 `chrome.storage.local` 配置，构造消息体，POST `${baseUrl}/chat/completions`（`stream:true`），解析 SSE，逐块 `port.postMessage({type:'delta', text})`，结束 `{type:'done'}`，出错 `{type:'error', message}`。
- 职责二 **拉取模型**：监听 `chrome.runtime.onMessage`（`{action:'fetchModels'}`），GET `${baseUrl}/models`，返回 `{ok, models}` 或 `{ok:false, error}`。
- 依赖：`chrome.storage.local`、`domains.js`、用户配置的 provider。

### 4.3 `content.js`（页面注入）
- 监听 `mouseup`：取 `window.getSelection().toString().trim()`，非空则按选区末尾 `getBoundingClientRect()` 定位「译」浮标。
- 点浮标 → 在选区附近创建/复用浮框（Shadow DOM 容器内），进入 loading → `chrome.runtime.connect` 发 `{text, domainKey}`，把 `delta` 追加进译文区。
- 浮框结构：`[把手(可拖拽) | 领域下拉(默认=全局默认领域) | 关闭✕]` / `译文区(流式、自动换行)` / `[复制]`。
- 切换领域下拉 → 用新 `domainKey` 重译当前选区。
- 拖拽：把手 pointer 事件；初始定位并 clamp 进可视区。
- 自适应：`max-width` 限宽、宽随内容、`white-space:normal; word-break:break-word` 换行、高随文本增长。
- 新选区或点击浮框外空白 → 隐藏旧浮标；浮框保留至手动关闭。
- 依赖：`chrome.runtime`、`domains.js`、`chrome.storage.local`（读默认领域）。

### 4.4 `options.*`（设置页）
- 字段：Base URL、API Key、Model（下拉，可「拉取模型」填充，失败回退手动输入 id）、默认领域（下拉，默认自动）、温度（默认 0.3）。
- 「拉取模型」→ 经 background `fetchModels`。保存到 `chrome.storage.local`。
- 依赖：`chrome.storage.local`、background `fetchModels`、`domains.js`。

### 4.5 `popup.*`（工具栏弹窗）
- 启用/停用开关（存 `chrome.storage.local.enabled`，content 据此决定是否弹浮标）+「打开设置」按钮（`chrome.runtime.openOptionsPage()`）。

## 5. 数据流（划词→流式译文）

```
用户选词(mouseup)
  └─ content.js 显示「译」浮标
       └─ 点击 → content.js 弹浮框(loading) + connect Port{text,domainKey}
            └─ background.js 读配置 → POST /chat/completions stream
                 └─ SSE 增量 → port.postMessage(delta) ─┐
                                                         └─ content.js 追加进浮框(自适应)
            done/error → 关闭 Port / 浮框显示错误
```

## 6. 领域感知翻译（核心）

公共系统提示（base）：
> 你是一个专业的翻译引擎。请将用户提供的文本翻译成自然、地道、流畅的简体中文。规则：保留专有名词、品牌名、人名的通行译法或原文；代码、变量名、URL 原样保留；只输出译文本身，不要输出原文、解释、注释或引号。

各领域追加提示（`domains.js` 中的 `prompt`）：
- **🤖 自动 (auto, 默认)**：先判断文本所属领域与语境，再采用该领域中文母语者惯用的专业术语与表达。例如游戏内容用游戏业界/玩家圈术语；日本 ACG/二次元用御宅文化圈译名与黑话；科技、财经、影视等同理。
- **🎮 游戏 (game)**：电子游戏相关。使用中文游戏业界与玩家社群术语，如 nerf→削弱、buff→增益/加强、build→配装/构筑；保留 roguelike、Boss、speedrun 等通行说法；游戏/角色名优先官方或玩家通行译名。
- **🌸 ACG 二次元 (acg)**：日本动画/漫画/游戏/轻小说相关。使用中文御宅圈译名与黑话（傲娇、中二、废萌、里番、本命、推し→推 等）；作品/角色名优先官方或圈内通行译名；保留必要日文专有名词。
- **💬 通用 (general)**：用通顺自然的现代中文表达，避免生硬直译与翻译腔。

最终 system prompt = base + 选定领域的 prompt。user 消息 = 选中的原文。

## 7. 错误处理与边界

- 未配置（缺 baseUrl/apiKey/model）→ 浮框提示「请先在扩展设置中配置 API」+「打开设置」按钮。
- API 返回 4xx/5xx → 浮框显示状态码与错误信息（含 provider 返回的 message）。
- 网络失败/超时 → 浮框显示「请求失败」+ 原因。
- `/models` 拉取失败 → 设置页提示并保持手动输入框可用。
- 空选区不弹浮标。
- 浮框样式经 Shadow DOM 隔离，避免被网页 CSS 破坏或污染网页。

## 8. 权限（manifest）

- `permissions: ["storage"]`
- `host_permissions: ["http://*/*", "https://*/*"]`（调用任意自定义 provider）
- `content_scripts.matches: ["<all_urls>"]`，`js: ["src/domains.js","src/content.js"]`，`css:["src/content.css"]`，`run_at: document_idle`
- `background.service_worker: src/background.js`
- `options_page` + `action.default_popup`

## 9. 可验证成功标准

1. chrome://extensions「加载已解压扩展」无报错。
2. 设置页能保存 base url/key/model；「拉取模型」能列出模型，失败时可手动输入并保存。
3. 普通网页选中英/日文，选区末尾出现「译」浮标。
4. 点浮标弹浮框，译文流式逐字出现，最终为简体中文。
5. 浮框可拖拽、长文自动换行、随内容增高，复制/关闭按钮有效。
6. 切换浮框领域下拉触发重译，且术语风格随领域变化（游戏 vs ACG 对同一句差异可见）。
7. 未配置时浮框给出友好提示并能一键打开设置。
8. 浮标/浮框在多种网站样式不被破坏。

## 10. 不在 v1 范围（YAGNI）

- iframe 内选词翻译（README 注明；后续加 `all_frames` + 裁切处理）。
- 右键菜单触发、翻译历史/缓存、自定义领域、多目标语言。
