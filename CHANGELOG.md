# CHANGELOG — 我的世界 IPv6 联机工具

> 版本号规则：从 V90 起每次代码改动递增一个主版本号（V90 → V91 → V92 …），不再使用 69.x / 85.x 序列。
> 版本号单一来源为 `Cargo.toml` 与 `tauri.conf.json`（均为 `X.0.0`）；运行期显示取主版本号拼 `v`，即 `v{X}`，不带 `.0.0`。
> 后端 `lib.rs::APP_VERSION` 由 `concat!("v", env!("CARGO_PKG_VERSION_MAJOR"))` 派生；前端 `app-i18n.js` 运行期由 `getVersion()` 同步。

## [V115] — 2026-07-13
### Bug 修复（全量扫描，基于 SOURCE_INDEX.md 系统自主发现）
- **app.js（8 项）**：
  - 移除 V113 遗留的无条件 success 覆盖（L568-571），恢复正确的成功/失败逻辑
  - 修复 `intraStepTimer` 泄漏（`stopIntraStepProgress()` 定义在 try 内，finally 无法访问），提前到顶层声明
  - `format_ipv6_address` 后端返回 null 时不再显示"null"，回退为 `[addr]:port`
  - `bindGlobalKeyboardShortcuts` 添加 `_keydownBound` 防重复绑定（返回用户路径）
  - `renderProbeCard` 增加 metric 字段 null 防御（`?? 0`），防止 null 隐式转 0 导致误分类
  - catch 块硬编码 9 步循环改为遍历实际 DOM 步骤项数量
  - `cleanCacheDir` 增加 result 非空对象校验，后端 null 时不再静默报告成功
  - `loadAppConfig` catch 保留已有 records，配置加载失败不再清空历史
- **app-i18n.js（3 项）**：
  - 补充缺失的 `history.record` 翻译键（app.js 调用但无定义）
  - 删除 `history.empty` 中英文重复定义
  - 版本号同步至 v115
- **index.html（1 项）**：
  - `#history-data-path` 移除 `data-i18n`，防止 `applyTranslations()` 覆盖运行时写入的实际路径
- **Rust lib.rs（2 项）**：
  - HTTP 延迟值 `.trim_end_matches(')')`，修复 `"1234ms)"` 污染 step latency 字段
  - `delete_record` 索引越界时返回 `Err`，不再静默忽略
- **资源清理**：删除 `src/assets/anime.min.js`（HTML 注释标注移除但未执行）
- **背景资源**：壁纸由 `壁纸.webp` 替换为 `wallpaper.gif`（动态背景）

## [V95] — 2026-07-11
### 严重 Bug 修复（全按钮点不动）
- **根因（P0）**：`clipboard.js` 与 `app.js` 均在顶层用 `const` 声明了同名 `CLIPBOARD_TIMEOUT`，两个 classic `<script>` 共享同一全局词法环境，浏览器在**编译 `app.js` 时即抛 `SyntaxError: Identifier 'CLIPBOARD_TIMEOUT' has already been declared`**，导致**整个 `app.js` 一行不执行** → `init()` 永不调用 → 所有按钮无事件绑定 → 表现为"无法点击任何按钮，疑似被透明东西挡住"（先加载的 `fx-particles.js` 仍在跑，点击会迸发粒子动画，造成"有反馈但按钮没反应"的被拦截错觉）。
- **修复**：将 `clipboard.js` 整体包进 IIFE，常量不再泄漏到全局，消除跨文件顶层 `const` 撞名（同时符合项目"禁止跨文件重复顶层 const"硬约定）；`app.js` 自带的 `const CLIPBOARD_TIMEOUT = window.__APP__.CLIPBOARD_TIMEOUT` 成为唯一声明（值同为 3000，行为不变）。
- **连带修复（同次排查发现的其他 bug）**：
  - 移除 `index.html` 中 V94 添加的 `<meta http-equiv="Content-Security-Policy">`：它与 `tauri.conf.json` 自带 CSP（含 `'unsafe-inline'`）取交集，会禁用所有内联 `onclick` 并收紧 `img-src`（破坏 `asset:`/`blob:` 图片）。现统一以 Tauri 配置为准。
  - 删除 `index.html` 中重复的一套调试日志容器/按钮（`debug-log-container`/`debug-log-content`/`btn-toggle-debug` 出现两次，非法 HTML 且 `getElementById` 只取第一个）。
  - `#btn-generate-addr`（配置页"生成连接地址"）默认 `opacity:0; pointer-events:none`，仅 `.config-card:hover` 才显示——与"V94 始终显示"注释矛盾。修正为默认常显。
  - `applyTranslations()` 直接对 `btn-language`/`btn-theme` 设 `.textContent`，会清空其内部的 `.liquidGlass-text` 子节点（破坏玻璃按钮结构）。改为只更新内部 `.liquidGlass-text` 的文本。
  - `debugLog()` 用 `innerHTML +=` 拼接未转义内容，改为先经 `escapeHtml()`，消除 XSS/布局破坏隐患。
- **版本号同步**：5 处对齐到 `v95` / `95.0.0`（`Cargo.toml` 94→95；`tauri.conf.json` 已是 95；`app-i18n.js` APP_VERSION `v94`→`v95`；`lib.rs` 由 `CARGO_PKG_VERSION_MAJOR` 自动派生）。

## [V94] — 2026-07-11
### 变更（UI 优化专项）
- **标题样式回退（用户要求）**：
  - 移除 V93 引入的 `.page-title` / `.main-title` 蓝绿渐变文字（绿→蓝品牌渐变）与 `-webkit-text-fill-color: transparent`，恢复中性 `var(--color-text)` + 轻量文字阴影。
  - 移除 `.page-title::after` 标题下方渐变装饰条（用户明确不希望标题下有带颜色的元素）。
  - 各子页面标题增加 `margin-top` 向下微调，主页 `#page-home` 增加 `padding-top`，标题更趋垂直居中。
  - 免责声明页小节标题 `.disclaimer-content h3` 的绿色左 accent 条 + 蓝色底部细线改为中性 `--color-border`，仅靠字重/字号建立层级（遵循"避免五颜六色"）。
- **配色方案重构（参考优秀 UI 配色调研，60-30-10）**：
  - 主强调色 `--color-accent` 由柠檬绿 `#A3E635` 改为克制靛蓝 `#6366F1`（仅用于输入框聚焦环等少量交互态，10% 占比），整体回到中性主导。
  - 内联硬编码 hex（蓝/绿/红/琥珀）全量替换为语义化 CSS 变量与 `.em-*` 文字层级 class，杜绝散落硬编码。
- **全文本层级系统（Text Hierarchy System）**：
  - 新增 `.em-strong / .em-italic / .em-underline / .em-key / .em-link / .em-ok / .em-danger / .em-warn / .em-soft` 统一语义类（均走 `var(--color-*)`，亮/暗主题自适应）。
  - 对**全部文字性内容**（i18n 中英双语字典 `app-i18n.js` + `index.html` 静态文案 + 免责声明正文）按重要性与文本逻辑增补加粗 / 下划线 / 斜体 / 状态色，建立一致的视觉层级。
- **版本号同步**：5 处版本号递增至 `v94` / `94.0.0`（`Cargo.toml`、`tauri.conf.json`、前端 `APP_VERSION` 与 `index.html` 副标题；`lib.rs` 由 `CARGO_PKG_VERSION_MAJOR` 自动派生）。

## [V93] — 2026-07-11
### 变更
- **标题样式统一升级（所有页面）**：
  - 抽出统一 `.page-title` 视觉语言：渐变文字（`var(--color-text)` → `var(--color-green-600)` → `var(--color-blue-500)`）+ 标题下方居中渐变装饰条，应用于配置/连接地址/IPv6 异常处理/IPv6 网络性能诊断/历史检测记录/免责声明全部子页面。
  - 主页 `.main-title` 渐变由硬编码 hex（`#1F2937`/`#4B5563`）改为语义变量（绿→蓝品牌渐变），消除硬编码颜色。
  - 免责声明页小节标题 `.disclaimer-content h3` 增加绿色左侧 accent 条 + 蓝色底部细线，层级更清晰、更醒目。
  - 全程使用 CSS 变量，无新增硬编码颜色；标题字号沿用 `clamp()` 响应式，移动端自适应不变。
- **Bug 修复（网络性能诊断页首次进入显示异常元素）**：
  - 根因：诊断结果区/分数条依赖 HTML 内联 `display:none` 隐藏，存在被任意边缘情况覆盖的风险。
  - 修复（防御性，双保险）：① CSS 层将 `.probe-score-box` / `.probe-summary` 默认 `display` 改为 `none`，不依赖内联属性；② 抽出 `resetLatencyPageUI()`，在**进入与离开**第 5 页时均强制重置（隐藏分数条/摘要/结果、清空输入框、复位起始按钮与评分环）。确保首次进入只显示应显示的元素。
- **版本号同步**：5 处版本号递增至 `v93` / `93.0.0`（`Cargo.toml`、`tauri.conf.json`、前端 `APP_VERSION` 与 `index.html` 副标题；`lib.rs` 由 `CARGO_PKG_VERSION_MAJOR` 自动派生）。

## [V92] — 2026-07-11
### 变更
- **T1 版本号统一**：5 处版本号收敛为单一来源（`Cargo.toml` + `tauri.conf.json`）。
  - 后端 `lib.rs::APP_VERSION` 改为 `concat!("v", env!("CARGO_PKG_VERSION_MAJOR"))`，编译期从 Cargo 主版本号派生（如 `92.0.0 → v92`）。
  - 前端 `app-i18n.js` 新增 `refreshAppVersionFromTauri()`：运行期从 `getVersion()` 取主版本号拼 `v`，覆盖静态兜底；失败静默回退。
  - 显示格式固定为 `v{主版本号}`，**不再显示 `.0.0`**。
- **T7 常驻提权**：本 Tauri 版本（2.x）的窗口配置**不支持** `runAsAdmin` 字段（构建期会报 unknown field）。改用 `build.rs` 注入 Windows 应用程序清单 `requestedExecutionLevel="requireAdministrator"`，每次启动弹 UAC，常驻管理员权限（保留 Common-Controls v6 依赖以兼容原生对话框/主题）。
- **T5 CSS 颜色变量清理**：`style.css` / `index.html` / `app.js` 中 80 处硬编码 6 位 hex 颜色替换为语义化 `--color-*` 变量；`:root` 扩展状态/评分色板（精确 hex 值，零视觉差异）。
- **T4 残余清理（部分）**：建立本 CHANGELOG 汇总历史版本标记；工作目录历史诊断/旧版本 exe 归档（见交付说明）。

## [V91] — 2026-07-11
- 修复 V90 标题栏改 `absolute` 后主内容区被压缩未拉回的问题：`body` 移除 `padding-top:38px`，`#app` 改为 `position:absolute; top:38px; left:0; right:0; bottom:0`，保留 8/12px 内缩与圆角，主内容区几何恢复至标题栏下沿到底部。

## [V90] — 2026-07-11
- 标题栏偏移修复：标题栏 `position: absolute; top:0; left:0; right:0`（此前在 Tauri WebView 下出现偏移）。

## [V85.x] — 2026-07-10
- 安全 UI 改进（免责声明模态、外部服务 fallback 调整、CSP 收窄）。
- 版本序列 V85.0.1 → V85.0.4（此序列后续弃用）。

## [V69 / V69.1] — 2026-07-09 ~ 07-10
- 以 V69 为地基重建 `tauri_ipv6` 源码（原生 HTML/CSS/JS 前端 + Tauri v2 Rust 后端）。
- 移植 i18n 多语言、主题切换、安全 UI。
- V69.1：正则 `Lazy<Regex>` 全局预编译、CDN 依赖离线化（`lib/` 本地化）、后端单元测试、提示框改模态。
- 诊断版本 `diag_00~05` 用于标题栏/拖拽/背景/粒子问题定位。

## [V65] — 早期基线
- 引入 `debug_log!` 调试日志宏（按需写文件）、`APP_VERSION` 常量雏形、ChaCha20-Poly1305 历史记录加密。
