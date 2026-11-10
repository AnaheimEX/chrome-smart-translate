# Smart Translate Agent 交接

更新：2026-10-18；2026-10-23 追加视觉改版；2026-10-24 配色改为「晴空」（均见第 3 节）。对象：划词智能翻译的 Chrome 与 Safari 两个版本。

## 1. 接手先读

当前交付是可调尺寸的新版译文浮窗。代码、Safari 应用及扩展注册已更新；没有后台构建任务或测试服务需要继续等待。用户此轮只要求交接，未指定新的功能任务。

1. 在下方项目目录执行 `git status --short`，保留工作区全部现有改动。
2. 修改浮窗时先读 `src/content.js`；涉及 Safari 打包再读 `safari/prepare.py` 和 `safari/README.md`。
3. 根据新的任务选择检查范围。真实 Safari 验收与本地模拟页验收要分别记录。

**代码已全部提交。** 2026-10-24 按用户要求清理了版本历史：仓库只保留一个提交（「晴空」配色版），GitHub 上只有 `main` 分支，更早的提交已不存在。当前仓库目录里没有 `safari/`，Safari 打包源不在版本库中。

## 2. 目录和当前产物

| 对象 | 位置 / 版本 |
| --- | --- |
| 维护源码 | `~/Downloads/Project/Safari-extensions/chrome-smart-translate` |
| Chrome 加载目录 | 项目根目录，`manifest.json` 为 **4.3.3** |
| Safari 用户使用的应用 | `~/Downloads/Project/Safari-extensions/Smart Translate Safari.app` |
| Safari 当前版本 | **4.4.3，Build 4**；交接时已读取安装包确认 |
| Safari 构建输出 | `safari/dist/Smart Translate Safari.app` |
| Safari 生成资源 | `safari/WebExtension/`、`safari/Project/Smart Translate Safari/` |
| Safari 构建缓存 | `safari/build/`，不是维护源 |

原先的 `~/Downloads/Project/chrome-smart-translate` 已不是当前路径。

本会话还处理过其他 Safari 扩展；本交接不包含它们。Vimium C 已按用户要求卸载，应用及源码移至废纸篓，不要恢复或把它的修复混入本项目。

## 3. 当前功能和维护入口

| 文件 | 责任 |
| --- | --- |
| `src/content.js` | 选区、浮标、Shadow DOM 浮窗、流式译文、字号、拖动/缩放、复制 |
| `src/background.js` | 翻译请求、缓存、API/订阅分流、账号状态与取消 |
| `src/prompt.js` | 共用翻译 Prompt、上下文整理 |
| `src/options.*`、`src/popup.*` | 设置页和扩展工具栏弹窗 |
| `bridge/subscription.js` | Chrome 的独立网页授权、订阅模型及请求 |
| `bridge/host.js`、`bridge/install.js` | Chrome Native Messaging 入口与安装 |
| `safari/Native/SubscriptionService.swift` | Safari 内置授权和订阅服务 |
| `safari/Native/SafariWebExtensionHandler.swift` | Safari 原生消息入口 |
| `safari/Support/safari-native.js` | Safari JS 到原生异步消息适配 |
| `safari/prepare.py` | 将共用源码同步、调整为 Safari 资源；更新 Xcode 构建配置 |
| `safari/Support/` | Safari 宿主应用维护源 |

订阅授权使用扩展自己的登录状态，不读取本机 Codex、Chrome 或其他应用的账号。代码中的 `codex` 命名和 `chatgpt.com/backend-api/codex` 请求不代表读取本机 Codex 登录信息。

Chrome 订阅连接仍需 `node bridge/install.js`；Safari 订阅连接已内置到 Swift 应用，不依赖 Node Native Host。仅调整浮窗不需要重装 Chrome 订阅连接。修改连接代码或移动 Chrome 加载目录后，应按 README 重新安装连接。不要在交接记录中导出令牌、Cookie 或真实凭据。

### 配色改版（2026-10-24，「晴空」）

用户反馈「午夜鸢尾」的蓝色太暗，改为明亮配色。只改颜色与少量装饰，元素 ID、存储键、消息协议、展示钩子和交互逻辑都不变；下方 10-23 记录里关于配色的描述已被本节取代，布局与动画约束仍有效。

- **品牌色**：天蓝渐变 `#5c9dff → #2f74ff → #1f8cf5`（印章、图标），按钮渐变 `#2f6bff → #2b7af4`，文字强调色 `#1f63f0`。点缀色是杏橙火花 `#ffaa4d`：「译」浮标里的菱形点、设置页/弹窗印章右上角的圆点、扩展图标右上角（≤32px 时省略）、浮窗顶部细线的末端。
- **浮窗跟随系统明暗**：浅色为白色毛玻璃、深色文字；深色改为中性石墨灰（`#25282f → #1a1c22`），不再是藏青。所有颜色都是 `:host` 上的变量，深色只在 `@media(prefers-color-scheme:dark)` 里覆盖变量。「译」浮标在两种模式下都是天蓝渐变实底、白字。
- **设置页与弹窗**：浅色背景带天蓝与暖杏两团光晕；深色背景为中性石墨（`#101216`），主按钮渐变配深色文字。
- **对比度**：浅色正文、强调文字、浅色按钮文字均 ≥ 4.6:1；主按钮白字 4.0–4.5:1（改版前最低 3.7:1）；深色强调色在卡片上约 7:1，深色主按钮深字 ≥ 6.5:1。
- **图标**：已用 `./tools/gen-icons.sh` 重新生成四个尺寸。
- **验证**（本地模拟页 + 应用内置浏览器，无真实账号）：浮窗的浮标出现、点击翻译、完成/加载/出错/未配置四种状态、字号 A+/A−/恢复与保存、复制及 1.2s 复原、方向键缩放与保存、恢复自动大小、真实鼠标拖动标题栏与右下角缩放柄、Esc 关闭；设置页的服务切换、显示密钥、拉取模型、自绘下拉开合与箭头旋转、恢复预设、保存、订阅登录流程；弹窗的整行开关与状态文字；浅色、深色截图逐页查看。`node --check` 全部脚本、`node --test` 四个测试文件（45 项）通过。未在真实 Chrome 扩展进程和 Safari 中验收，Safari 未重新构建。
- 本地预览：`.claude/launch.json` 里的 `ui-fixture` 配置启动 `tests/ui-fixture.cjs`（未提交；Node 路径是本机 fnm 的绝对路径）。

### 视觉改版（2026-10-23，「午夜鸢尾」）

只改外观，不改功能：所有元素 ID、存储键、消息协议和交互逻辑保持不变。

- **统一品牌**：蓝紫渐变 `#7aa2f7 → #bb9af7`。扩展图标、弹窗、设置页和浮窗标题共用「译」字印章。浮窗固定深色（沿用 10-20 的深色基调）；设置页与弹窗跟随系统明暗，深色与浮窗同色系。
- **浮窗**（`content.js` 的 `STYLE`）：深色毛玻璃、顶部渐变细线、分段字号控件、骨架屏加载、复制成功变绿并换成对勾、出错时印章变红。「译」浮标是带渐变描边的深色胶囊。
- **展示钩子**（只供 CSS 使用）：`.st-box[data-phase=loading|done|error]` 由 `setPhase()` 设置，所有错误都经 `renderText(…, true)` 进入 error；复制成功时 `.st-btn` 带 `.st-copied` 类，1.2s 后移除。
- **动画约束**：浮窗本身只淡入（`st-fade`），位移动画只放在子元素上（`st-rise`）。拖动、缩放和视口夹紧都读取 `.st-box` 的 `getBoundingClientRect()`，给它加 transform 会让刚出现时的拖动偏移几个像素。
- **设置页**：分为「翻译服务」「翻译 Prompt」两张卡片，底部有吸附保存栏；状态提示改为带色点的胶囊，内容为空时不占位；`[hidden]` 全局加了 `!important`，带 flex 布局的字段也能正确隐藏。模型下拉箭头通过 `:has()` 旋转，脚本仍只切换 ▾/▴ 字符。
- **弹窗**：整行点击即可切换「启用划词翻译」，开关使用渐变色。
- **图标**：设计源是 `tools/icon.html`，运行 `./tools/gen-icons.sh` 生成 16/32/48/128 四个尺寸（本机 Chrome 无头渲染，依赖 PingFang SC 字体）。旧的 `tools/gen-icons.js` 只会画蓝色气泡，已删除。
- **验证**：jsc 语法检查；无头 Chrome 跑 fixture 模拟页，覆盖浮窗 36 项交互（字号、键盘缩放、拖动、复制、Esc、加载/出错/完成）、设置页 29 项、弹窗 6 项，以及浅色、深色截图。未在真实扩展进程和 Safari 中验收，Safari 也未重新构建。
- 模拟页注意：`tests/ui-fixture.cjs` 的 mock 端口在 `disconnect()` 时会触发本端 `onDisconnect`，真实 Chrome 不会。所以在模拟页里「加载中点关闭」会重新显示「连接中断」，改版前后都是如此。

### 最近三轮 UI 改动

- **译文开头空白**：流式累积和最终结果用 `trimStart()` 清理前导空白；正文内部换行保留，复制使用同一份文本。只有空白的初始流片段不会提前关闭加载状态。
- **字号**：顶部 `A− / A+`，每次 2px，12–28px；点击中间字号恢复默认 14px。保存键为 `translationFontSize`。
- **窗口尺寸**：标题栏拖动；右下角拖拽柄调整宽高；方向键每次 10px、Shift＋方向键每次 40px；底栏回转箭头恢复自动大小。
- **尺寸记忆**：保存键 `translationWindowSize`，值为 `{ width, height }`；`null` 表示自动大小。默认宽 420px，手动尺寸通常最小 280×160px，可见视口不足时允许进一步收缩；预留 12px 视口边距。
- **阅读布局**：正文独立滚动，标题栏和底栏不随正文滚走；统一圆角与图标（配色已被 10-23 视觉改版取代）、1.8 倍行距、清晰键盘焦点、减少动画偏好适配。窗口内焦点下 Esc 关闭，不接管整张网页的 Esc。
- **存储范围**：字号与尺寸在同一个浏览器扩展的网页之间同步；Chrome 和 Safari 的偏好分别存储。

关键函数：`applyFontSize`、`readWindowSize`、`applyWindowSize`、`enableResize`、`saveWindowSize`、`queueLayout`。缩放期间只更新显示，指针操作结束后保存。窗口随浏览器视口变化重新约束尺寸和位置。

## 4. 已验证与未验证

### 本次已执行

- `node --check src/content.js`、`node --check tests/ui-fixture.cjs`、`git diff --check` 通过。
- Ego 浏览器中运行现有本地模拟页面，使用真实 `src/content.js` 和模拟 Chrome/Native Messaging 接口，无真实账号或模型请求。
- 鼠标拖拽改变窗口尺寸；方向键调整尺寸；字号调整可见。
- 页面刷新后恢复 **500×469、16px**；恢复自动大小回到 **420px 宽**。
- 长文在缩小的窗口中独立滚动，底栏仍可见；模拟 **360×300** 布局视口时测量窗口和底栏未越界。
- 查看过浅色和深色界面截图（本地模拟页，不是实际 Safari 扩展截图）。旧版截图已于 2026-10-24 从仓库删除。
- 显式聚焦窗口内控件后，真实 Escape 按键关闭窗口。
- Safari 双架构 Release 构建成功，深度签名校验通过；已将产物复制到用户应用路径并重新注册。
- 交接时确认安装包的 `src/content.js` 与 `safari/WebExtension/src/content.js` 字节一致，版本为 4.4.3 / Build 4。

### 尚未覆盖

- 本轮未操作真实 Safari，也未在真实 Chrome 扩展进程中验收新版 UI。
- 本轮未重新验证真实 ChatGPT 登录、模型列表、真实翻译请求或额度；UI 模拟不能证明这些链路正常。
- 本轮未重新跑所有历史 Node/Swift 测试，不要将 README 中的旧测试数量当成本轮结果。
- 无已确认的待修 UI 缺陷；实际浏览器中的缩放、跨网页同步、更新加载状态仍适合下一次用户验收。

测试工具注意：Ego 的截图/页面操作可能影响焦点。曾出现截图后直接按 Esc 没关闭；显式 `page.focus('.st-resize')` 后按 Esc 两次复核均正常。不要据此修改窗口外网页的全局快捷键。模拟视口的 DOM 几何检查与截图捕获结果应分别看待。

## 5. 改动、生成与安装

共用逻辑在根目录 `src/` 修改。Safari 差异放入 `safari/prepare.py`、`safari/Support/` 或 `safari/Native/`；直接修改生成的 `WebExtension` 或项目 Resources 会在下一次同步时被覆盖。

版本入口：Chrome 的 `manifest.json`；Safari 的 `safari/prepare.py` 中 `manifest.update`、`MARKETING_VERSION`、`CURRENT_PROJECT_VERSION`。当前分别为 4.3.3、4.4.3、4。

```sh
cd ~/Downloads/Project/Safari-extensions/chrome-smart-translate

# 只同步 Safari 源码资源
python3 safari/prepare.py

# 构建 Safari 安装包（完整 Xcode；脚本会先同步资源）
./safari/build.command

# 更新用户正在使用的应用，不能只停留在 dist
ditto 'safari/dist/Smart Translate Safari.app' '../Smart Translate Safari.app'
codesign --verify --deep --strict '../Smart Translate Safari.app'

# 更新 LaunchServices / Safari 扩展注册
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f '~/Downloads/Project/Safari-extensions/Smart Translate Safari.app'
/usr/bin/pluginkit -a '~/Downloads/Project/Safari-extensions/Smart Translate Safari.app/Contents/PlugIns/Smart Translate Safari Extension.appex'
```

应用标识 `com.example.smarttranslate.safari`；扩展标识 `com.example.smarttranslate.safari.Extension`。当前为本机 ad-hoc 签名，不是已公证的发布包。Safari 启用相关说明见 `safari/README.md`；不要把未签名扩展选项或网站访问权限问题当作 JS 故障。

Chrome 更新后重新加载扩展并刷新旧网页。Safari 更新后需要退出重开并刷新旧网页；已经注入的旧内容脚本不会因磁盘文件更新而自动替换。用户之前多次要求先交付代码、自己稍后验证，不要自动操作其 Safari 会话。

## 6. 按任务选择检查

UI 本地模拟服务：

```sh
node tests/ui-fixture.cjs
# http://127.0.0.1:39617/tests/article.html
# http://127.0.0.1:39617/src/options.html
```

服务仅监听本机。`tests/ui-fixture.cjs` 提供模拟存储、授权和双向 port；`tests/article.html` 加载真实内容脚本。页面的 `TEST.translation` 可设成多段长文，再选中测试段落、点击「译」。服务启动后的代码变更可能需要重启服务和刷新页面。测试服务在交接前已停止，Ego 测试任务已关闭。

按涉及范围选用现有检查，不需要为阅读本交接而全量执行：

```sh
node --test tests/translation.test.cjs tests/latency-prompt.test.cjs
node --test tests/bridge.test.cjs tests/install.test.cjs
node --test safari/Tests/native-transport.test.cjs

# Safari 原生服务测试的编译/执行命令见 safari/README.md
```

这些测试主要模拟服务边界。UI 交互仍应通过选区、翻译按钮、字号按钮、缩放柄、复制/关闭等用户操作确认。验收报告分别说明：源码检查、模拟页面、Safari 构建/签名、实际浏览器操作、真实账户请求。

## 4.4.0 — 弹窗文本翻译（中文 → 英语/日语）

新增功能（用户需求：把输入框中输入的中文翻译成英文或日文）：

- `src/popup.html` / `src/popup.js`：弹窗新增文本输入区 + 目标语言下拉（英语/日语）+ 翻译按钮。
  输入中文后点「翻译」（或按 Enter），结果流式显示在输入区下方，可一键复制。
  与划词翻译共用同一个翻译端口与服务（ChatGPT 订阅或兼容 API），未登录/未配置时给出提示。
- `src/prompt.js`：新增 `TARGET_PROMPTS`（English/Japanese）。`prepareTranslation` 支持
  `context.target`：弹窗指定目标语言时，该语言预设**覆盖**用户提示词里固定的翻译方向；
  未指定时仍走设置页保存的提示词。目标语言同样被 `sanitizeContext` 清洗并限长（50 字符），
  任意目标语言字符串不会原样进入系统提示词（未命中预设时回退英语）。
- `src/background.js`：翻译端口（`name: 'translate'`）接受来自扩展自身页面的连接
  （弹窗页 URL 为 `chrome-extension://`，不再强制 `https?://`）。`sender.id` 校验不变。
- `src/ui.css`：新增 `.translate-section` 相关样式（与现有「晴空」设计语言一致）。
- `tests/ui-fixture.cjs`：本地模拟页现在也注入 popup 页（fixture + prompt.js + background.js），
  可在 `http://127.0.0.1:39617/src/popup.html` 手动验收弹窗翻译。
- `tests/translation.test.cjs`：新增 2 个测试（弹窗端口被接受 + 目标语言选择提示词；
  未设目标保持自定义提示词、注入式目标回退英语）。
- `manifest.json` 版本升至 4.4.0。

验收记录：

- `node tests/*.test.cjs`：translation 25、bridge 17、latency-prompt 4、install 1，全部通过。
- 本地无头 Chrome（ui-fixture）E2E：空输入提示、英语/日语翻译、流式显示、复制按钮、
  Enter 提交、原启用开关均正常；弹窗布局无横向溢出（body 高 421px）。
