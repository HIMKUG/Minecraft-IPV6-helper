# 项目源代码索引（Source Code Block Index）

本索引扫描项目下全部**手写源代码文件**，将每个文件划分为若干连续“代码块”，
并给出每块的行号区间（如 `L10-L45`）与基于语法特征（类 / 函数 / 注释 / 导入 / 属性等）自主判断的功能简述。

**划分依据**：以类定义、函数声明、注释块、导入语句、Rust 属性（`#[...]`）、
CSS 分区注释与 `@` 规则等为结构信号，结合花括号深度（`{ }`）确定每块的实际起止行。
块内实现细节已忽略，仅保留对外结构轮廓。

**范围说明**：
- 已索引：前端 `src/*.js`、`src/*.html`、`src/*.css`，Tauri 后端 `src-tauri/**/*.rs` 与 `build.rs`。
- 已排除（构建产物 / 依赖 / 二进制，非手写源码）：`src-tauri/target/`、`node_modules/`、`*.exe`、`*.pdb`、`Cargo.lock`、`package-lock.json`、图片 / 字体等二进制资源。
- 第三方压缩库（vendored minified）按单块处理；以 IIFE 封装的模块按整模块结构拆分。

---

## `src/index.html`

_人工整理，共 21 个代码块，文件 737 行_

- **L1-L2**　文档声明与根元素（<!DOCTYPE html> + <html lang="zh-CN">）
- **L3-L19**　<head> 区块（meta、title、CSP、样式表链接、内联 <style> 字体定义）
- **L20-L38**　<body> 起始 + SVG 毛玻璃滤镜定义（Liquid Glass 滤镜）
- **L39-L43**　背景层（壁纸 / RGB 幻彩 / 粒子背景 div）
- **L45-L74**　标题栏 <header id="title-bar">（语言 / 主题 / 最小化 / 关闭按钮）
- **L77-L79**　<main id="app"> 入口 + 内部 RGB 背景层
- **L80-L135**　页面 0 主页 page-home（Hero / 操作卡片 / 次要入口 / 开发者卡片）
- **L137-L283**　页面 1 监测页 page-detect（8-bit loading / 步骤卡片 / 操作与引导按钮）
- **L285-L337**　页面 2 配置页 page-config（端口输入 / 指南卡片）
- **L339-L378**　页面 3 结果页 page-result（地址展示 / 复制 / 诊断按钮）
- **L380-L439**　页面 4 故障页 page-fault（快速 / 深度修复 + 日志 + 验证区）
- **L441-L490**　页面 5 延迟检测页 page-latency（v6-probe 诊断 + 评分环 + 卡片容器）
- **L492-L519**　页面 6 历史记录页 page-history（记录列表 / 清除按钮）
- **L521-L567**　页面 7 免责声明页 page-disclaimer（完整免责声明文本）
- **L570-L598**　首次启动免责声明弹窗 page-first-run
- **L600-L623**　自定义确认对话框 confirm-modal
- **L625-L648**　浮窗按钮组 floating-btns（历史 / 延迟 / 免责声明）
- **L650-L681**　修复进度模态弹窗 repair-modal
- **L683-L713**　历史记录详情弹窗 history-detail
- **L715-L731**　脚本引入（tsparticles / liquid-glass / fx-particles / clipboard / app-i18n / app.js）+ 调试日志 UI
- **L733-L736**　结束标签 </body></html>

## `src/style.css`

_自动扫描，共 248 个代码块，文件 3783 行_

- **L1-L6**　Apple-style Liquid Glass Theme 功能不退化版本 — 保留所有原有 ID / class / DOM 结构，仅升级视觉与动效 4 层…
- **L7-L11**　优化字体渲染
- **L12-L23**　:root {
- **L24-L44**　扩展语义色板（与 :root 既有主色一致，供状态/评分/标记使用，避免散落 hex）
- **L45-L52**　调试面板配色（替代内联硬编码 hex，遵循"禁止硬编码颜色"约定）
- **L53-L73**　Liquid Glass tokens
- **L74-L82**　设计系统：8px Grid 间距尺度
- **L83-L95**　字体层级系统
- **L96-L107**　卡片样式系统
- **L108-L111**　由 liquid-glass.js 写入的鼠标位置
- **L112-L116**　z-index 模态弹窗量表
- **L117-L134**　暗色主题支撑令牌（亮色值 原字面量，外观不变）
- **L135-L138**　弹窗/覆盖层背景色（支持主题切换）
- **L139-L145**　暗色主题 [data-theme "dark"] — 增量新增，零重构覆盖 :root 令牌 仅覆盖颜色类令牌，DOM 结构与其它样式一律不动，确保零回归风险
- **L146-L158**　Liquid Glass 暗色令牌
- **L159-L165**　卡片暗色
- **L166-L184**　组件表面令牌（暗色）
- **L185-L194**　暗色下压暗背景层，保证玻璃质感与文字对比度
- **L195-L225**　文本层级系统（Text Hierarchy System） 统一语义化文字强调：加粗 / 斜体 / 下划线 / 状态色
- **L226-L233**　html 也要透明，否则 WebView2 默认白底会覆盖 body 圆角
- **L234-L235**　不再用 body padding 预留标题栏高度（flex+padding 在 Tauri WebView 下 可能导致 #app 高度计算异常、主内容被压缩）
- **L236-L238**　窗口级圆角 — decorations:false + transparent:true 已在 tauri.conf.json 配置 body 完全透明，圆角外…
- **L239-L240**　触发硬件加速合成层，让 border-radius 裁剪传递到 DWM 像素合成阶段
- **L241-L243**　移除 will-change: transform — 持久 will-change 浪费 GPU 显存 body 不需要持续合成层（动画时再加）
- **L244-L257**　壁纸背景层 — absolute，受 body overflow:hidden 裁剪圆角
- **L258-L262**　@keyframes bgSlowDrift {
- **L263-L282**　Layer 1: RGB 幻彩背景（独立全屏层，做色相漂移） 改为 absolute — body 的 overflow:hidden 才能裁剪圆角 加 wil…
- **L283-L290**　@keyframes rgbHueDrift {
- **L291-L296**　@keyframes rgbPan {
- **L297-L308**　强制粒子 canvas 不拦截点击
- **L309-L319**　爆发粒子 Canvas — 必须在所有按钮后面
- **L320-L321**　Title Bar — 玻璃顶栏
- **L322-L326**　修复标题栏偏移：脱离文档流，绝对定位于窗口最顶端， 不受 Tauri WebView 顶部内边距/安全区影响
- **L327-L344**　标题栏 z-index 提高到 1200，高于所有弹窗
- **L345-L369**　顶部圆角与窗口对齐（保持原始 28px 圆角，不改用户设计）
- **L370-L389**　标题栏按钮 — 同时具有 .liquidGlass-wrapper，需重置 width/100%
- **L390-L402**　语言切换按钮样式 - 宽度50px，hover时扩展到65px
- **L403-L420**　hover 时向左延伸宽度，幅度居中
- **L421-L422**　Layer 2: 主玻璃壳 #app 恢复 结构：保留 position:relative 但不设 z-index（避免 stacking context） 内…
- **L423-L438**　修复主内容被压缩：脱离 flex 拉伸，改为绝对定位精确填充标题栏下方
- **L439-L442**　#app 内部专属 RGB 背景层 关键：作为 #app 的子元素，与内部按钮同处一个 stacking context 内部按钮 effect 层的 back…
- **L443-L456**　z-index 移除 — 由 HTML 顺序保证 #app-rgb-bg 在 .page 之下
- **L457-L468**　鼠标跟随光晕（黑色）
- **L469-L473**　z-index 改为 0，避免 -1 被父级 stacking context 遮挡
- **L474-L482**　微噪点纹理 — 给玻璃一个"非纯色"质感
- **L483-L486**　z-index 改为 0，避免 -1 被父级 stacking context 遮挡
- **L487-L516**　Pages — 内容承载层，保留原 display/fade 切换逻辑 【关键修复 — 深层次 bug】 原 .page { z-index: 1 } 会创建新…
- **L517-L520**　@keyframes pageEnter {
- **L521-L525**　@keyframes pageLeave {
- **L526-L541**　内部元素优雅进入 — 错位淡入
- **L542-L551**　glass-card 错位淡入（用 opacity 避免破坏 backdrop-filter）
- **L552-L555**　@keyframes elementSlideUp {
- **L556-L561**　@keyframes cardFadeIn {
- **L562-L563**　Back button 样式已移除 — 使用 liquidGlass-wrapper 结构
- **L564-L569**　通用卡片组件 — 统一的玻璃卡片视觉语言 【关键修复 — 】 原 .glass-card { backdrop-filter: blur(8px) } 会创建新…
- **L570-L578**　backdrop-filter 移除 — 避免创建 stacking context 阻挡 effect 看 body 背景
- **L579-L586**　移除 transform 过渡，改用 background/box-shadow/border-color， 避免 hover transform 创建 sta…
- **L587-L597**　所有 glass-card hover 时背景增强 — 移除 transform: scale 避免创建 stacking context
- **L598-L631**　页面头部组件：返回按钮 + 标题一体化 收紧间距，减少垂直空间浪费
- **L632-L633**　标题下方装饰条已移除 —— 用户要求标题下不要任何带颜色的元素
- **L634-L645**　页面底部副标题 — 原灰字从标题旁移到页面底部
- **L646-L684**　Logo Area
- **L685-L688**　主页卡片布局 — 垂直堆叠，清晰分组
- **L689-L693**　上少下多的不对称 padding，让内容上移 使页面垂直中心落在"开始检测"和"专业测试网站"两个按钮之间
- **L694-L717**　主页标题区去框 — 标题只是标题，不需要玻璃卡片
- **L718-L734**　Buttons — macOS Liquid Glass Effect（毛玻璃图标精确版本）
- **L735-L745**　macOS Liquid Glass Effect — 严格按参考文件实现 4 层结构: wrapper → effect(模糊+滤镜) → tint(遮罩) …
- **L746-L761**　果冻过冲曲线仅用于 transform，其余属性用 ease，避免对非位移属性过冲
- **L762-L774**　【effect 层】绝对定位铺满 wrapper - backdrop-filter: blur(12px) 背景模糊（增强到 12px 让效果明显） - fi…
- **L775-L784**　【tint 层】绝对定位铺满，rgba(255,255,255,0.25) 玻璃材质色
- **L785-L796**　【shine 层】绝对定位铺满，两层 inset 内阴影 (左上亮右下弱亮) 曲面反光 - inset 2px 2px 1px 0 rgba(255,255,2…
- **L797-L812**　鼠标跟随光晕层 — 在 text 之上，照亮按钮
- **L813-L841**　暗色主题下调高强度，避免过曝
- **L842-L853**　【text 层】按钮文字，z-index 最高，不能被模糊影响 pointer-events: none 让点击穿透到 wrapper（关键修复）
- **L854-L855**　液态玻璃按钮变体 — 不同尺寸的圆角和 padding
- **L856-L862**　标准按钮 — 类似参考的 .button
- **L863-L876**　hover 液态膨胀：幅度居中（与之间），参考开发者卡片动效 贝塞尔曲线改为 cubic-bezier(0.175, 0.885, 0.32, 2.2) 轻微过…
- **L877-L884**　小按钮变体（返回按钮等）
- **L885-L892**　返回按钮弹跳幅度居中
- **L893-L894**　按钮变体颜色
- **L895-L899**　免责声明按钮 — 红色
- **L900-L918**　继续按钮 — 绿色调
- **L919-L926**　V113: 蓝色按钮 — 信息/诊断/外链用（基础文字保持默认黑色，悬停变蓝）
- **L927-L940**　基础文字保持默认色，不设color
- **L941-L948**　V113: 琥珀色按钮 — 警告/修复用（基础文字保持默认黑色，悬停变琥珀）
- **L949-L962**　基础文字保持默认色，不设color
- **L963-L974**　返回按钮 — 浅红调
- **L975-L980**　复制成功
- **L981-L984**　移除 transform 的 !important，让基础 transform 仍能正常过渡
- **L985-L1001**　禁用状态
- **L1002-L1010**　开始检测按钮 — 主页核心 CTA，蓝色调液态玻璃
- **L1011-L1027**　开始检测按钮 hover 幅度居中
- **L1028-L1031**　亮色模式用黑色，暗色模式用白色
- **L1032-L1038**　专业测试按钮 — Q弹幅度居中
- **L1039-L1071**　果冻过冲曲线仅用于 transform，其余属性用 ease
- **L1072-L1086**　【C1 修复】暗色主题下彩色按钮文字改用浅色令牌，保证可读（亮色主题维持深色令牌以对比浅色按钮底）
- **L1087-L1184**　Step Indicators — 透镜感小玻璃点
- **L1185-L1234**　@keyframes lgPulseDot {
- **L1235-L1243**　Config / Result / Fault 卡片 — 内部小玻璃
- **L1244-L1260**　配置页卡片 — 添加毛玻璃效果
- **L1261-L1304**　端口指南卡片 — 添加毛玻璃效果
- **L1305-L1321**　backdrop-filter 移除 — 避免创建 stacking context 阻挡 effect 看 body 背景
- **L1322-L1337**　结果页操作按钮组 — 统一按钮间距和大小 gap 改用 clamp 适配小窗口（合并了原先在小窗口媒体查询里的重复定义）
- **L1338-L1370**　合并两个 hint 为一个段落，减少堆叠感
- **L1371-L1407**　端口号专用：等宽字体 + 右对齐数字感
- **L1408-L1449**　结果页卡片 — 收紧 padding，避免与 result-section 双重间距
- **L1450**　result-hint 已在上方统一定义，此处删除重复
- **L1451-L1452**　result-hint-accent 已在上方统一定义
- **L1453-L1483**　合并重复的 fault-section 定义，统一间距
- **L1484-L1506**　移除 backdrop-filter 避免创建 stacking context
- **L1507-L1511**　Latency Section — 统一 max-width 与 latency-card 一致
- **L1512-L1515**　减少输入框和按钮之间的间距
- **L1516-L1537**　诊断页输入提示 — 空输入时醒目提示
- **L1538-L1551**　配置卡片/延迟卡片 hover 显示按钮 — Q弹入场动画 诊断按钮改为始终显示（不再隐藏）
- **L1552-L1559**　诊断按钮始终可见
- **L1560-L1572**　配置卡片 hover → 显示生成按钮（始终显示，禁用态由文字提示）
- **L1573-L1574**　诊断按钮始终可见，不再需要 hover 显示逻辑
- **L1575-L1584**　按钮自身 hover 弹跳（幅度居中）
- **L1585-L1616**　移除 backdrop-filter 避免创建 stacking context
- **L1617-L1655**　移除 backdrop-filter 避免创建 stacking context
- **L1656-L1664**　Scrollbar
- **L1665-L1666**　FX Canvas — 爆发粒子层（已在文件顶部定义，此处仅保留注释）
- **L1667-L1683**　Detect Page — 全新的左右布局 + 毛玻璃框 + 状态文字
- **L1684-L1708**　检测页头部：居中对齐，强调百分比数字
- **L1709-L1719**　百分比居中、黑色、更醒目
- **L1720-L1741**　步骤卡片 — 继承 glass-card 视觉语言 检测完成后 detect-actions 显示会挤压此框
- **L1742-L1761**　检测完成状态文字
- **L1762-L1780**　检测完成操作按钮 — 统一宽度与步骤框一致
- **L1781-L1813**　检测失败操作按钮 — 统一宽度
- **L1814-L1820**　检测失败引导卡片
- **L1821-L1829**　移除 backdrop-filter 避免创建 stacking context
- **L1830-L1854**　@keyframes guideFadeIn {
- **L1855-L1861**　修复步骤卡片（流式显示当前修复哪一步）
- **L1862-L1866**　设置 max-height: 320px 启用自身滚动； 在 .repair-modal-body 内则让外层滚动（max-height: none）
- **L1867-L1880**　模态内层不限制高度，让外层 .repair-modal-body 负责滚动
- **L1881-L1885**　移除 backdrop-filter 避免创建 stacking context
- **L1886-L1890**　@keyframes stepSlideIn {
- **L1891-L1950**　历史详情步骤项 — 用于历史记录详情弹窗中的步骤展示
- **L1951-L2007**　Spinner
- **L2008-L2049**　@keyframes spin {
- **L2050-L2059**　修复验证区
- **L2060-L2099**　@keyframes verifyFadeIn {
- **L2100-L2101**　继续按钮使用 liquidGlass-green 变体
- **L2102-L2114**　专业测试网站链接按钮
- **L2115-L2116**　btn-link 系列样式已移除 — 使用 liquidGlass-wrapper 结构
- **L2117-L2129**　开发者展示区域
- **L2130-L2171**　移除 backdrop-filter 避免创建 stacking context
- **L2172-L2194**　@keyframes avatarRainbowGlow {
- **L2195-L2199**　仅 home 页显示时运行
- **L2200-L2230**　@keyframes namePulse {
- **L2231-L2243**　History & Disclaimer Pages
- **L2244-L2262**　history-list 宽度跟随父容器
- **L2263-L2267**　移除 backdrop-filter 避免创建 stacking context
- **L2268-L2322**　点击卡片打开详情弹窗，改为 pointer
- **L2323-L2331**　history-footer 宽度与 card 一致，按钮右对齐
- **L2332-L2337**　故障页卡片 — 已合并 fault-section 到上方统一定义
- **L2338-L2343**　延迟检测页卡片 — 已合并 latency-section 到上方统一定义
- **L2344-L2350**　历史页外层容器 — 原类名 .history-card 与单条记录的 .history-card 冲突，导致两套定义互相覆盖（前者有背景+模糊，后者只有 max…
- **L2351-L2354**　免责声明页卡片 — 统一宽度 420px
- **L2355-L2359**　改用 60vh 简化 calc(100vh - 180px) 适配，避免硬编码偏移
- **L2360-L2361**　btn-danger 样式已移除 — 使用 liquidGlass-wrapper 结构
- **L2362-L2364**　Disclaimer Page 移除双重玻璃背景 — disclaimer-content 在 glass-card 内部， 不需要自己的背景+模糊（glass…
- **L2365**　max-width 600px 移除 — 不能超出 disclaimer-card 的 420px
- **L2366-L2419**　background + backdrop-filter + border 移除 — 避免与 glass-card 双重玻璃
- **L2420-L2427**　First-Run Modal
- **L2428-L2432**　模态弹窗 z-index 使用变量统一管理
- **L2433-L2439**　不再继承 .page 的样式，作为独立 modal
- **L2440-L2460**　移除 !important，first-run modal 自身定义已确保 display 优先级
- **L2461-L2471**　@keyframes modalPopIn {
- **L2472-L2520**　@keyframes iconBounce {
- **L2521-L2522**　btn-agree / btn-disagree 样式已移除 — 使用 liquidGlass-wrapper 结构
- **L2523**　Floating Buttons (历史 + 声明)
- **L2524-L2528**　浮动按钮：position:fixed 必须保留，否则 left/bottom/right 失效
- **L2529-L2551**　浮动按钮 z-index 使用变量统一管理
- **L2552-L2598**　浮动按钮弹跳幅度居中
- **L2599-L2600**　#btn-start-detect 重复定义已合并至主定义（见 845 行附近）， 小窗口压缩由 @media (max-height: 580px), (ma…
- **L2601-L2696**　Port Hint Section (端口填写提示) 移除双重玻璃 — 在 glass-card 内部不需要自己的背景+模糊
- **L2697-L2706**　Custom Confirm Modal
- **L2707-L2711**　确认弹窗 z-index 使用变量统一管理
- **L2712-L2733**　深度修复：默认不拦截点击
- **L2734-L2793**　@keyframes modalFadeIn {
- **L2794-L2795**　btn-cancel / btn-confirm-danger 样式已移除 — 使用 liquidGlass-wrapper 结构
- **L2796-L2797**　修复模态弹窗（仿"清除历史记录"对话框样式）
- **L2798-L2811**　弹窗打开/关闭动画 — scale + fade + blur 模糊退出
- **L2812-L2857**　深度修复：防御性 pointer-events
- **L2858-L2897**　@keyframes modalSlideUp {
- **L2898-L2910**　复用 的 .repair-step-item 样式（在模态里也能用）
- **L2911-L2951**　@keyframes footerSlideUp {
- **L2952**　红色按钮样式（用于"无视风险后继续"）
- **L2953-L2978**　wrapper 背景保持透明，颜色由 tint 层提供
- **L2979-L2980**　柔性框架 (Fluid Layout) — 适配不同窗口缩放 核心策略： 1. clamp() 让 padding/gap/字号随视口自适应 2. 媒体查询在极…
- **L2981-L2987**　覆盖 .page 的固定 padding/gap 为 clamp 自适应值
- **L2988-L3013**　内容多的页面允许垂直滚动，避免内容看不全
- **L3014**　glass-card 在小窗口下缩小 max-width 与 padding
- **L3015-L3021**　已合并到主 .glass-card 定义中，避免重复定义
- **L3022-L3031**　logo 图标随窗口缩放
- **L3032-L3041**　配置页 / 延迟页 / 历史页等内容多的页面：让 glass-card 可伸缩
- **L3042-L3052**　port-hint-card 长内容：内部可滚动，避免撑高页面
- **L3053-L3062**　延迟表格在小窗口下水平滚动
- **L3063**　极小窗口（高度 < 580px 或宽度 < 400px）进一步压缩
- **L3064-L3095**　@media (max-height: 580px), (max-width: 400px) {
- **L3096-L3111**　同时覆盖 #btn-start-detect 的 hover padding 避免跳变
- **L3112-L3118**　小窗口下压缩步骤框高度（避免与基础 min-height: 120px 冲突）
- **L3119**　中等窗口（400-480px 宽）适度压缩
- **L3120-L3128**　@media (max-width: 480px) {
- **L3129**　高窗口（> 800px）放宽留白
- **L3130-L3139**　@media (min-height: 800px) {
- **L3140-L3149**　确保结果页地址框在小窗口下不溢出
- **L3150-L3151**　result-actions 重复定义已合并至主 .result-actions（见上方）
- **L3152-L3157**　历史卡片 / 免责声明 在小窗口下压缩
- **L3158-L3159**　检测页步骤框小窗口压缩已移至 @media (max-height: 580px), (max-width: 400px)
- **L3160-L3170**　v6-probe 延迟诊断卡片样式
- **L3171-L3174**　@keyframes probeSpin { to { transform: rotate(360deg); } }
- **L3175-L3188**　summary 隐藏时不占空间
- **L3189-L3254**　综合评分展示区
- **L3255-L3319**　probe-results 与 latency-card 宽度对齐
- **L3320-L3378**　卡片左侧色条
- **L3379**　小窗口下 probe 指标网格改为 2 列
- **L3380-L3388**　@media (max-width: 360px) {
- **L3389-L3419**　8-bit 像素点 loading 动画 — 基于 loading.txt 参考代码重写 16 个方块围成圆形，按 ball-8bits 关键帧闪烁，形成 8-…
- **L3420-L3437**　16 个方块按圆形均匀分布（百分比定位，来自 loading.txt 参考代码）
- **L3438-L3443**　@keyframes ball-8bits-8bit {
- **L3444-L3454**　检测页 loading 区 — 居中包含 loading 动画 padding 留足空间防止 8-bit 球体溢出与下方 UI 重叠
- **L3455-L3471**　百分比数字绝对居中在 loading 动画正中间，使用像素字体
- **L3472**　无障碍支持 — 尊重用户的减少动画偏好
- **L3473-L3483**　@media (prefers-reduced-motion: reduce) {
- **L3484-L3485**　任务三：修复 .repair-modal-card 类名定义 原 HTML 使用了 .repair-modal-card 但 CSS 仅有 .repair-mo…
- **L3486-L3499**　使用 CSS 变量，支持主题切换
- **L3500**　任务一：历史详情弹窗三段式布局样式
- **L3501**　历史详情弹窗样式
- **L3502-L3562**　提高特异性替代 !important，避免级联冲突
- **L3563-L3574**　历史卡片诊断记录类型徽章
- **L3575**　任务一：自定义滚动条（替换浏览器默认滚动条）
- **L3576-L3593**　自定义滚动条（WebKit/Chromium）
- **L3594-L3599**　Firefox 兼容
- **L3600-L3641**　全局应用到所有 overflow 容器
- **L3642-L3678**　toast 提示（#15），替代原生 alert，匹配 Liquid Glass 风格，深浅色自适应
- **L3679-L3684**　全局焦点可见样式，提高键盘导航可访问性
- **L3685-L3686**　文字特效合集（移植自 resources/资料/好看的文字效果30.html）
- **L3687-L3711**　-- 效果 #04：3D 立体叠加（保留原色，仅取透视+阴影偏移结构） ----
- **L3712-L3726**　-- 效果 #09：打字机（保留原色，由 JS 动态触发动画） ----
- **L3727**　优化打字机展开动画
- **L3728-L3737**　@keyframes ef09a {
- **L3738-L3743**　@keyframes ef09b {
- **L3744-L3758**　-- 效果 #17：光泽扫过（Shimmer） ----
- **L3759-L3763**　@keyframes ef17 {
- **L3764-L3769**　-- 效果 #20：脉冲呼吸 ----
- **L3770-L3783**　@keyframes ef20 {

## `src/app.js`

_自动扫描，共 87 个代码块，文件 2420 行_

- **L1-L2**　常量/变量 debugLogEnabled 定义
- **L3**　常量/变量 debugLogContent 定义
- **L4-L5**　常量/变量 debugLogContainer 定义
- **L6-L26**　函数 debugLog
- **L27-L32**　函数 toggleDebugLog
- **L33-L35**　全局变量封装到命名空间 window.__APP__，避免污染全局作用域 注意：使用 Object.assign 保留 fx-particles.js 预设置的…
- **L36-L85**　顶层语句 window.__APP__
- **L86-L87**　常量/变量 FADE_OUT_DURATION 定义
- **L88-L89**　常量/变量 FADE_IN_DURATION 定义
- **L90-L91**　常量/变量 DETECT_START_DELAY 定义
- **L92-L93**　常量/变量 INTRA_STEP_SUB_DURATION 定义
- **L94-L95**　常量/变量 PROTOCOL_STACK_DELAY 定义
- **L96**　常量/变量 REPAIR_QUICK_TIMEOUT 定义
- **L97-L98**　常量/变量 REPAIR_DEEP_TIMEOUT 定义
- **L99-L123**　常量/变量 Tauri 定义
- **L124-L131**　函数 safeInvoke
- **L132-L140**　函数 cssVar：获取 CSS 变量实际值 浏览器不会把 'var(--xxx)' 作为合法颜色值解析传给 style.borderColor， 必须通过 getComputed…
- **L141-L228**　函数 switchPage：深度修复：pendingHideTimer 原本是隐式全局变量（未用 var 声明）， 在严格模式或某些 WebView2 环境下会抛 ReferenceErr…
- **L229-L248**　函数 triggerTypewriterOnTarget：页面切换时重启打字机效果（#09）—— 找到目标页面中的 .ef-09 元素，重启宽度动画
- **L249-L305**　函数 runPageSwitchSideEffects：页面切换副作用：放在 switchPage 之外以便多次调用
- **L306-L329**　函数 resetLatencyPageUI：网络性能诊断页 UI 重置（进入/离开页面5时调用） 防御性：不依赖 HTML 内联 display 属性，强制隐藏结果区/分数条/摘要， 并清空输入框、复位起…
- **L330-L341**　函数 updateParticleTheme
- **L342-L370**　函数 initParticles
- **L371-L394**　函数 magnetEffect
- **L395-L418**　函数 burstParticles
- **L419-L436**　函数 updateStep
- **L437-L445**　函数 resetSteps
- **L446-L448**　函数 easeOutCubic：== 平滑进度曲线动画 === 原版用离散步进 (0% → 11% → 22% → ...)，跳跃感强
- **L449-L471**　函数 progressStep
- **L472-L496**　函数 updateProgress
- **L497-L502**　函数 setLoadingMsg：设置 8-bit loading 提示文字
- **L503-L506**　函数 addMessage
- **L507-L521**　函数 shouldShowProTestGuide：isDetecting 已移入 window.__APP__.isDetecting 抽取"是否显示专业测试网站引导"判断逻辑（5 分钟内修复过算已修复）
- **L522-L745**　函数 startDetection
- **L746-L766**　函数 setContinueButtonState：== 继续按钮状态切换 ===
- **L767-L828**　函数 generateAddress：isGeneratingAddress 已移入 window.__APP__.isGeneratingAddress
- **L829-L834**　函数 cleanPortInput：== 端口号 → 生成连接地址按钮状态 === 抽取端口清洗函数，与 generateAddress 保持一致
- **L835-L852**　函数 updateGenerateButtonState
- **L853-L870**　函数 copyResult：copyResult — 委托给 clipboard.js 模块
- **L871-L879**　函数 appendLog
- **L880-L901**　函数 openRepairModal：== 修复模态弹窗辅助函数 ===
- **L902-L912**　函数 closeRepairModal
- **L913-L920**　函数 updateRepairModalStep
- **L921-L941**　函数 renderRepairModalSteps
- **L942-L950**　函数 showRepairModalFooter
- **L951-L997**　函数 runQuickRepair：isQuickRepairRunning / isDeepRepairRunning 已移入 window.__APP__
- **L998-L1042**　函数 runDeepRepair
- **L1043-L1193**　函数 startTracert：isTracertRunning 已移入 window.__APP__.isTracertRunning
- **L1194-L1200**　函数 safeFixed：渲染延迟指标卡片 (ICMP / TCP 共用) safeFixed 防御 null 字段
- **L1201-L1233**　函数 renderProbeCard
- **L1234-L1240**　函数 renderMetricCell
- **L1241-L1259**　函数 renderDnsCard
- **L1260-L1281**　函数 renderPathCard
- **L1282-L1290**　函数 getTheme：== 语言 / 主题 偏好（增量功能，不影响导航与现有逻辑） ===
- **L1291-L1297**　函数 applyTheme
- **L1298-L1306**　函数 toggleTheme
- **L1307-L1317**　函数 initI18nAndTheme
- **L1318-L1359**　函数 initTitleBar
- **L1360-L1383**　函数 bindBtn：全局按钮绑定助手：避免重复绑定（） 将 bindBtn 从 init() 内部移到外部，使页面切换后也能重新绑定新页面的按钮
- **L1384-L1405**　函数 bindBackButtons：绑定返回按钮
- **L1406-L1444**　函数 rebindPageButtons：切换页面后重新绑定该页面的按钮
- **L1445-L1476**　函数 assignButtonColors：V113: 根据按钮语义分配颜色 — 红色=危险/删除, 琥珀色=警告/修复, 绿色=确认/正向, 蓝色=信息/诊断
- **L1477-L1683**　函数 bindHomeButtons：绑定主页按钮
- **L1684-L1718**　函数 bindDisclaimerClicks：绑定 Debug 模式触发（免责声明框点击）
- **L1719-L1791**　函数 bindGlobalKeyboardShortcuts：绑定全局键盘快捷键
- **L1792-L1842**　函数 init
- **L1843-L1847**　顶层语句 document.addEventListener
- **L1848-L1861**　函数 formatTimestamp：================= 历史记录 & 免责声明 ================== appConfig 已移入 window.__APP__.ap…
- **L1862-L1871**　函数 escapeHtml
- **L1872-L1910**　函数 translateBackendText：V113: 将后端返回的中文文本映射为英文（仅英文模式下生效）
- **L1911-L1968**　函数 renderHistory
- **L1969-L2123**　函数 openHistoryDetail：currentDetailRecordIndex 已移入 window.__APP__.currentDetailRecordIndex
- **L2124-L2138**　函数 closeHistoryDetail
- **L2139-L2150**　函数 closeConfirmModal：确认弹窗关闭动画（与 closeHistoryDetail 风格一致）
- **L2151-L2177**　函数 saveCurrentRecordToHistory
- **L2178-L2187**　函数 loadAppConfig
- **L2188-L2200**　函数 showHistoryPage
- **L2201-L2214**　函数 showConfirm：showConfirm 重写为回调式，支持自定义标题/消息/按钮文字 + 关闭动画
- **L2215-L2273**　函数 _showConfirmInternal：实际渲染与绑定（私有）
- **L2274-L2294**　函数 showSimpleMessage：简单消息提示：用与 Liquid Glass 一致的 toast 替代原生 alert（#15）， 非阻塞、自动消失，且用 textContent 渲染避免 X…
- **L2295-L2310**　函数 clearAllData
- **L2311-L2327**　函数 cleanCacheDir
- **L2328-L2349**　函数 firstRunAgree
- **L2350-L2359**　函数 firstRunDisagree
- **L2360-L2363**　函数 showDisclaimerPage
- **L2364-L2390**　函数 showFirstRunModal：抽取 first-run 弹窗显示逻辑，catch 路径也必须显示
- **L2391-L2420**　函数 checkFirstRun

## `src/app-i18n.js`

_自动扫描，共 11 个代码块，文件 839 行_

- **L1-L5**　常量/变量 APP_VERSION 定义
- **L6-L24**　函数 refreshAppVersionFromTauri：* * 运行期从 Tauri 拉取真实版本号，取主版本号拼 'v'（91.0.0 -> v91）， * 覆盖静态兜底 APP_VERSION，并刷新界面文案使其…
- **L25**　启动即异步拉取真实版本（getVersion 为 Promise），成功后刷新UI
- **L26-L27**　顶层语句 refreshAppVersionFromTauri
- **L28-L30**　常量/变量 currentLanguage 定义
- **L31-L753**　常量/变量 I18N 定义
- **L754-L764**　函数 escapeI18nValue：* * Translate a key with optional parameter substitution. * @param {string} key …
- **L765-L775**　函数 t
- **L776-L783**　函数 setLanguage：* Set language and persist preference. @param {string} lang 'zh' | 'en'
- **L784-L792**　函数 getLanguage：* Get saved language, default 'zh'.
- **L793-L839**　函数 applyTranslations：* * Apply translations to all [data-i18n] / [data-i18n-placeholder] elements, * …

## `src/clipboard.js`

_人工整理，共 7 个代码块，文件 113 行_

- **L1-L5**　模块头部 JSDoc 注释（V94 剪贴板模块：封装复制逻辑，Tauri → navigator.clipboard → execCommand 三级降级 + 超时保护）
- **L7-L8**　封装说明注释（IIFE 避免顶层 const 污染全局词法环境，防止与 app.js 撞名）
- **L9-L13**　IIFE 模块封装起始 + 模块常量（'use strict'、CLIPBOARD_TIMEOUT、COPY_SUCCESS_DURATION）
- **L14-L74**　函数 copyToClipboard（含前置 JSDoc）— 复制文本到剪贴板，Tauri invoke → navigator.clipboard → execCommand 三级降级 + 3s 超时保护
- **L75-L104**　函数 copyResult（含前置注释）— 复制结果并触发成功/失败 UI 反馈（onSuccess / onFail）
- **L106-L111**　全局暴露对象 window.Clipboard（导出副本函数与超时常量）
- **L112**　IIFE 闭合并执行 `})();`

## `src/liquid-glass.js`

_人工整理，共 10 个代码块，文件 113 行_

- **L1-L7**　模块头部注释（Liquid Glass 装饰增强：鼠标位置追踪、page 切换 stagger、暴露 LG.stagger）
- **L8-L19**　IIFE 封装起始 + 状态变量（LG 对象、rafId、鼠标坐标 tgtX/tgtY、dirty 脏标记）
- **L20-L30**　函数 tick — 每帧 RAF 平滑更新 CSS 变量 --lg-lx / --lg-ly
- **L31-L41**　函数 onMove — 鼠标移动更新目标坐标与 dirty 标记
- **L42-L45**　函数 onLeave — 离开窗口时停用跟踪
- **L46-L68**　LG.stagger — 通用错位淡入（纯 opacity，避免创建 stacking context 破坏毛玻璃）
- **L69-L80**　LG.staggerPageContent — 对 page 内主要区块做 stagger 进入
- **L81-L105**　LG.init — 初始化鼠标跟踪 + MutationObserver 监听 .page.active 切换
- **L106-L111**　ready / DOMContentLoaded 就绪触发
- **L112-L113**　IIFE 闭合并执行 `})();`

## `src/fx-particles.js`

_人工整理，共 16 个代码块，文件 390 行_

- **L1-L7**　模块头部注释（V48 多核视觉优化：点击爆发 + 常驻 ambient 粒子 + Worker 渲染，不干扰 invoke）
- **L8-L19**　IIFE 封装起始 + CFG 配置常量（爆发数量、ambient 池大小 / 生命周期 / 速度）
- **L20-L47**　常驻 ambient 粒子池（createParticle / ambientPool / ambientActive / acquireAmbient）
- **L48-L62**　状态变量与 ambient 池初始化（initAmbientPool + canvas / ctx / rafId / 时间戳 / 尺寸）
- **L63-L90**　函数 initCanvas / resizeCanvas — Canvas 初始化与尺寸同步（通知 Worker resize）
- **L91-L112**　函数 initWorker — Burst Worker 初始化（OffscreenCanvas + Worker 创建 + 降级处理）
- **L113-L159**　ambient Sprite 缓存（ambientSpriteCache / AMBIENT_HUES / AMBIENT_SIZES / buildAmbientSprite / initAmbientSprites / nearestAmbientSprite）
- **L160-L175**　函数 spawnBurst — 触发爆发（优先 off-thread Worker，主线程 boostBackground 加速色相）
- **L176-L192**　函数 boostBackground — 爆发时临时加速粒子色相动画
- **L193-L215**　函数 spawnAmbient — 从屏幕边缘生成 ambient 粒子
- **L216-L271**　函数 update — 主线程 ambient 更新循环
- **L272-L278**　函数 ensureLoop — 确保 ambient 循环运行
- **L279-L308**　函数 bindCopyButton — 复制按钮绑定（委托 clipboard.js + 延迟 burst）
- **L309-L364**　函数 bindGlobalClicks — 全局点击绑定 + MutationObserver 动态绑定新按钮
- **L365-L375**　函数 init — 初始化总入口（池 / Canvas / Sprite / Worker / 绑定 / 循环）
- **L376-L390**　DOMContentLoaded 就绪触发 + window.__APP__.FX 暴露 + IIFE 闭合 `})();`

## `src/fx-burst-worker.js`

_人工整理，共 14 个代码块，文件 235 行_

- **L1-L5**　模块头部注释（V48 爆发粒子 Worker：OffscreenCanvas 并行渲染，主线程零阻塞）
- **L7-L18**　IIFE 封装起始 + CFG 配置常量（粒子池大小、摩擦、重力、生命周期、色相扩散、玻璃比例）
- **L20-L34**　函数 createParticle — 创建粒子对象
- **L35-L46**　粒子池管理（pool / active 数组 + acquire 获取空闲粒子）
- **L47-L54**　状态变量（canvas / ctx / rafId / dpr / globalHue）
- **L55-L61**　预渲染 Sprite 缓存配置（spriteCache、SPRITE_HUES × SPRITE_SIZES）
- **L62-L77**　函数 buildSprite — 预渲染径向渐变 Sprite（替代 createRadialGradient，加速 20-40×）
- **L78-L87**　函数 initSprites — 初始化 Sprite 缓存
- **L88-L105**　函数 nearestSprite — 就近匹配 Sprite（hue / size）
- **L106-L122**　函数 initCanvas / resize — Canvas 初始化与尺寸适配
- **L123-L154**　函数 spawnBurst — 生成爆发粒子（主逻辑）
- **L155-L210**　函数 update — 粒子物理更新与绘制主循环
- **L211-L217**　函数 ensureLoop — 确保渲染循环运行
- **L218-L233**　self.onmessage — Worker 消息处理（init / resize / burst）

## `src-tauri/build.rs`

_自动扫描，共 2 个代码块，文件 38 行_

- **L1-L2**　导入语句
- **L3-L38**　函数 main

## `src-tauri/src/main.rs`

_自动扫描，共 1 个代码块，文件 7 行_

- **L1-L7**　函数 main：Prevents additional console window on Windows in release, DO NOT REMOVE!!

## `src-tauri/src/lib.rs`

_自动扫描，共 221 个代码块，文件 2903 行_

- **L1-L21**　导入语句
- **L22-L23**　常量/变量 CREATE_NO_WINDOW 定义
- **L24**　V62: 统一版本号 —— 从 Cargo.toml 主版本号派生（91.0.0 -> v91），
- **L25-L26**　顶层语句
- **L27-L28**　常量/变量 APP_VERSION 定义
- **L29**　V67: Debug 模式开关 —— 默认关闭，用户需在免责声明框上 5 秒内点击 10 次开启
- **L30**　顶层语句
- **L31**　导入语句
- **L32-L33**　常量/变量 DEBUG_ENABLED 定义
- **L34**　V69.1: 正则全局预编译（Lazy<Regex>），修复 #2/#3：
- **L35-L36**　顶层语句
- **L37-L38**　常量/变量 RE_DETECT_IPV6 定义
- **L39-L40**　常量/变量 RE_PING_TARGET 定义
- **L41-L42**　常量/变量 RE_TIMEOUT 定义
- **L43**　常量/变量 RE_TRACERT_HOP 定义
- **L44-L45**　常量/变量 RE_TRACERT_MS 定义
- **L46**　V65: 调试日志写入文件（%APPDATA%/IPV6Tool/debug.log）
- **L47-L48**　顶层语句 V67
- **L49**　导入语句
- **L50-L53**　常量/变量 DEBUG_LOG 定义
- **L54**　V67: 替代 eprintln! 的调试日志宏，仅在 DEBUG_ENABLED 为 true 时写入
- **L55-L77**　顶层语句 macro_rules
- **L78-L80**　常量/变量 HISTORY_KEY_LEN 定义
- **L81-L82**　常量/变量 HISTORY_NONCE_LEN 定义
- **L83-L84**　常量/变量 MAX_HISTORY_RECORDS 定义
- **L85-L87**　常量/变量 IPV6_DISPLAY_PREFIX 定义
- **L88-L90**　常量/变量 HTTP_CLIENT_TIMEOUT 定义
- **L91-L92**　常量/变量 HTTP_CONNECT_TIMEOUT 定义
- **L93-L94**　常量/变量 TCP_KEEPALIVE_TIMEOUT 定义
- **L95-L96**　常量/变量 HTTP_TEST_TIMEOUT 定义
- **L97**　常量/变量 HTTP_LARGE_FILE_TIMEOUT 定义
- **L98-L99**　常量/变量 HTTP_DNS_TIMEOUT 定义
- **L100-L101**　常量/变量 NAT66_TIMEOUT 定义
- **L102**　常量/变量 PING_TIMEOUT 定义
- **L103-L104**　常量/变量 TRACERT_TIMEOUT 定义
- **L105-L106**　常量/变量 TCP_CONNECT_TIMEOUT 定义
- **L107-L108**　常量/变量 TCP_HANDSHAKE_TIMEOUT 定义
- **L109-L110**　常量/变量 REPAIR_STEP_TIMEOUT 定义
- **L111-L112**　常量/变量 REPAIR_NETSH_RESET_TIMEOUT 定义
- **L113-L115**　常量/变量 SLEEP_ONE_SECOND 定义
- **L116-L117**　常量/变量 CLIPBOARD_RETRY_INTERVAL 定义
- **L118-L119**　常量/变量 CLIPBOARD_MAX_RETRIES 定义
- **L120-L121**　常量/变量 PING_COUNT 定义
- **L122**　常量/变量 PING_PER_HOP_TIMEOUT_MS 定义
- **L123-L124**　常量/变量 TRACERT_MAX_HOPS 定义
- **L125**　【V48 迭代1.1】reqwest 客户端单例 + 连接池
- **L126**　顶层语句
- **L127-L138**　常量/变量 HTTP_CLIENT 定义
- **L139-L144**　函数 cmd_no_window
- **L145**　V57/V58: 带进程级超时的命令执行，避免外部命令 hang 死阻塞线程
- **L146**　顶层语句
- **L147-L200**　函数 run_cmd_with_timeout
- **L201-L210**　函数 decode_cmd_output
- **L211-L230**　函数 http_get_timeout
- **L231**　V69.1: 外部服务 fallback（#22）—— 按顺序尝试多个端点，返回首个成功且非空的文本
- **L232**　顶层语句
- **L233-L242**　函数 http_get_first_ok
- **L243**　== V51：HEAD 请求版本，只取响应头不下载 body ===
- **L244**　顶层语句
- **L245-L266**　函数 http_head_timeout
- **L267-L273**　结构体 AddressInfo
- **L274-L281**　结构体 HopResult
- **L282-L305**　结构体 LatencyMetric：== v6-probe: 高精度 IPv6 网络性能诊断 ===
- **L306-L333**　结构体 ProbeResult
- **L334-L346**　结构体 DetectionStep
- **L347-L356**　结构体 DetectionResult
- **L357-L361**　结构体 RepairLog
- **L362-L374**　结构体 RepairStep：== V50 重构：修复步骤结构（流式返回，支持前端实时显示当前修复哪一步） ===
- **L375-L386**　结构体 RepairResult
- **L387-L391**　结构体 AppState
- **L392-L789**　函数 detect_ipv6
- **L790-L800**　函数 check_ipv6_connectivity
- **L801-L816**　函数 format_ipv6_address
- **L817**　Bug 修复：windows 0.58 crate 未导出 GlobalFree，用 FFI 直接声明 kernel32 函数
- **L818-L821**　顶层语句 extern
- **L822-L911**　函数 copy_to_clipboard
- **L912-L924**　函数 is_admin
- **L925-L929**　函数 close_window
- **L930-L934**　函数 minimize_window
- **L935-L950**　函数 run_repair_step：== V50 重构：修复流程返回 RepairResult，包含流式步骤 === V58: 辅助：尝试执行一个命令并返回是否成功（带 60s 超时，防止修复命令…
- **L951-L952**　函数 add_repair_step：V94: 辅助函数：添加修复步骤并更新状态（封装重复代码）
- **L953-L954**　顶层语句 steps
- **L955-L956**　顶层语句 name
- **L957-L958**　顶层语句 args
- **L959-L960**　顶层语句 fail_msg
- **L961-L980**　顶层语句
- **L981-L982**　函数 add_deep_repair_step：V94: 辅助函数：添加深度修复步骤（封装手动创建 RepairStep 的重复代码）
- **L983-L984**　顶层语句 steps
- **L985-L986**　顶层语句 name
- **L987**　顶层语句 status
- **L988-L998**　顶层语句
- **L999**　V94: 辅助函数：执行 netsh reset 类命令并更新修复步骤（封装重复的 match 模式）
- **L1000**　顶层语句
- **L1001**　函数 exec_netsh_reset_step
- **L1002-L1003**　顶层语句 steps
- **L1004-L1005**　顶层语句 name
- **L1006-L1007**　顶层语句 args
- **L1008**　顶层语句 program
- **L1009-L1033**　顶层语句
- **L1034-L1134**　函数 run_quick_repair_internal
- **L1135-L1136**　顶层语句 add_repair_step
- **L1137-L1138**　顶层语句
- **L1139-L1140**　顶层语句
- **L1141-L1142**　顶层语句
- **L1143**　顶层语句
- **L1144-L1145**　顶层语句
- **L1146**　== V52 新增 步骤 9: 设置 IPv6 DNS 服务器为自动获取 ===
- **L1147-L1148**　顶层语句
- **L1149-L1150**　常量/变量 ps_dns_auto 定义
- **L1151-L1152**　顶层语句
- **L1153-L1154**　顶层语句
- **L1155-L1156**　顶层语句
- **L1157-L1158**　顶层语句
- **L1159-L1160**　顶层语句
- **L1161-L1162**　顶层语句
- **L1163**　步骤 10: 刷新 DNS 缓存
- **L1164-L1165**　顶层语句 add_repair_step
- **L1166-L1167**　顶层语句
- **L1168-L1169**　顶层语句
- **L1170-L1171**　顶层语句
- **L1172**　顶层语句
- **L1173-L1174**　顶层语句
- **L1175**　顶层语句 steps
- **L1176-L1177**　顶层语句
- **L1178-L1203**　函数 run_quick_repair
- **L1204-L1231**　函数 run_quick_repair_impl：/ 实际的快速修复逻辑（从 run_quick_repair 拆出，便于加锁包裹）
- **L1232-L1254**　函数 run_deep_repair
- **L1255-L1324**　函数 run_deep_repair_impl：/ 实际的深度修复逻辑（从 run_deep_repair 拆出，便于加锁包裹）
- **L1325-L1365**　函数 open_url
- **L1366-L1418**　函数 run_tracert_parse
- **L1419-L1457**　函数 compute_metric：================= v6-probe: 高精度 IPv6 网络性能诊断 ================== / 计算统计指标：Min / Ma…
- **L1458-L1499**　函数 probe_icmpv6：/ 测量 ICMPv6 Echo RTT (10 次) / 【V48 迭代1.4】process 加 timeout 包装，防止进程 hang 死
- **L1500-L1543**　函数 probe_tcp_handshake：/ 测量 TCP Handshake RTT (连接到 80/443) / 【V48 迭代1.2】80/443 完全并行：2 端口 × 5 次 = 10 个连接…
- **L1544-L1568**　函数 probe_dns_latency：/ 测量 DNS AAAA 解析耗时 (如果是域名) / 修正：计时移入闭包内部，排除 spawn_blocking 调度开销
- **L1569-L1617**　函数 probe_path：/ 测量路径延迟 (tracert -6) / 【V48 迭代3.2】分段并行：30 跳拆 1-10/11-20/21-30 三段并发执行 / 【V48 迭代1…
- **L1618-L1657**　函数 extract_host_from_target：V54: 从目标地址中提取 host — 支持 URL、IPv6带端口、纯域名等格式
- **L1658-L1687**　函数 is_valid_probe_target：V54: 校验探测目标 — 支持 IPv6/IPv4/域名/URL（含 http://、https://、端口、路径）
- **L1688-L1849**　函数 run_v6_probe
- **L1850-L1867**　结构体 HistoryRecord
- **L1868-L1885**　结构体 AppConfig
- **L1886-L1893**　函数 get_data_dir
- **L1894-L1897**　函数 get_config_path
- **L1898-L1901**　函数 get_history_path
- **L1902**　================= V62: ChaCha20-Poly1305 AEAD 加解密 ==================
- **L1903-L1904**　顶层语句
- **L1905-L1906**　顶层语句
- **L1907-L1908**　顶层语句
- **L1909**　顶层语句
- **L1910-L1911**　顶层语句
- **L1912-L1929**　函数 load_full_config_from_disk：读取整个 config.json 文件到 AppConfig（不存在则返回默认值）
- **L1930**　把 AppConfig 原子写入 config.json（records 字段因 skip_serializing 不会持久化）
- **L1931-L1932**　顶层语句 V64
- **L1933-L1953**　函数 save_full_config_to_disk
- **L1954**　================= V64: 机器绑定派生密钥（替代明文存储的 secret_key） ==================
- **L1955-L1956**　顶层语句
- **L1957-L1958**　顶层语句
- **L1959-L1960**　顶层语句
- **L1961-L1962**　顶层语句 V64
- **L1963-L1964**　顶层语句
- **L1965**　顶层语句
- **L1966-L1967**　顶层语句
- **L1968**　应用固定 salt —— 硬编码在二进制中，与 MachineGuid 一起参与密钥派生
- **L1969-L1970**　顶层语句
- **L1971-L1972**　常量/变量 APP_KEY_SALT 定义
- **L1973**　读取 Windows MachineGuid（注册表 HKLM\SOFTWARE\Microsoft\Cryptography\MachineGuid）
- **L1974-L1975**　顶层语句 MachineGuid
- **L1976-L2010**　函数 read_machine_guid
- **L2011**　V65: 使用 OnceCell 缓存派生密钥，进程生命周期内只计算一次
- **L2012-L2013**　顶层语句
- **L2014-L2015**　顶层语句
- **L2016-L2017**　常量/变量 MACHINE_KEY 定义
- **L2018**　函数 derive_machine_key
- **L2019-L2030**　顶层语句 MACHINE_KEY.get_or_init
- **L2031-L2032**　顶层语句
- **L2033**　ChaCha20-Poly1305 加密：plain → nonce(12) || ciphertext(含 16 字节 tag)
- **L2034-L2035**　顶层语句 V64
- **L2036-L2054**　函数 encrypt_data
- **L2055**　ChaCha20-Poly1305 解密：nonce(12) || ciphertext → plain
- **L2056-L2057**　顶层语句 V64
- **L2058**　顶层语句
- **L2059-L2073**　函数 decrypt_data
- **L2074-L2089**　函数 truncate_ipv6：================= V62: 历史数据脱敏 ================== IPv6 地址截断：超过 8 字符的部分用 "..." 替代
- **L2090-L2098**　函数 sanitize_target_url：移除 URL 中的查询参数（保留 scheme + 域名 + 路径）
- **L2099-L2109**　函数 sanitize_probe_result：移除 probe_result 中的大体积字段：path_latencies 与 raw 延迟样本
- **L2110-L2123**　函数 sanitize_history_record：单条历史记录脱敏（写入前调用）
- **L2124**　================= V62: history.dat 加解密读写 ==================
- **L2125-L2126**　顶层语句
- **L2127**　顶层语句
- **L2128-L2129**　顶层语句
- **L2130-L2162**　函数 load_history
- **L2163-L2192**　函数 save_history
- **L2193-L2206**　函数 load_first_run_accepted：读取 first_run_accepted（V62: config.json 含 first_run_accepted + secret_key）
- **L2207-L2213**　函数 save_first_run_accepted：保存 first_run_accepted —— 必须保留磁盘上已有的 secret_key，否则历史数据无法解密
- **L2214-L2253**　函数 load_config
- **L2254-L2260**　函数 save_config
- **L2261-L2273**　函数 accept_disclaimer
- **L2274-L2296**　函数 add_history_record
- **L2297**　V58: 内部公共逻辑：保存网络性能诊断记录到历史
- **L2298-L2299**　顶层语句 V62
- **L2300**　顶层语句 V65
- **L2301**　函数 record_probe_result_to_history
- **L2302-L2303**　顶层语句 target
- **L2304-L2305**　顶层语句 score
- **L2306-L2345**　顶层语句
- **L2346-L2348**　函数 save_probe_history：V55: 保存网络性能诊断记录到历史
- **L2349-L2350**　顶层语句 target
- **L2351-L2352**　顶层语句 score
- **L2353-L2356**　顶层语句
- **L2357-L2378**　函数 clear_history
- **L2379-L2400**　函数 delete_record：V54: 删除单条历史记录 —— V62 改写 history.dat
- **L2401-L2405**　函数 get_data_directory
- **L2406-L2425**　函数 set_debug_mode：V67: Debug 模式控制命令
- **L2426-L2430**　函数 get_debug_mode
- **L2431-L2437**　结构体 CleanResult：V67: 清除缓存目录中的杂余数据文件
- **L2438-L2470**　函数 clean_cache_dir
- **L2471-L2518**　函数 check_webview2_installed：== V52: WebView2 + VC++ 运行库启动前检测 === / 检测 WebView2 Runtime 是否已安装
- **L2519-L2542**　函数 check_vcredist_installed：/ 检测 VC++ 运行库是否已安装
- **L2543-L2624**　函数 show_runtime_error_dialog：/ 显示 Windows 原生错误对话框并打开下载链接
- **L2625-L2684**　函数 check_runtime_dependencies：/ 并行检测 WebView2 + VC++ 运行库，缺失则弹窗并退出
- **L2685-L2737**　函数 run
- **L2738-L2903**　模块声明 tests

## `src/assets/anime.min.js`

_人工整理，共 1 个代码块，文件 8 行_

- **L1-L7**　第三方压缩动画库 anime.js（vendored / minified），未格式化，整体作为单块

## `src/assets/tsparticles.bundle.min.js`

_人工整理，共 1 个代码块，文件 2 行_

- **L1**　第三方压缩粒子引擎 tsParticles bundle（vendored / minified，单行长文件），未格式化

---

## V115 变更摘要（2026-07-13）

### 背景
基于 `SOURCE_INDEX.md` 系统扫描，自主发现并修复全部关键代码块中的 bug，同步更新版本号至 V115。

### app.js 修复（8 项）
| # | Bug | 行号 | 修复 |
|---|-----|------|------|
| 1 | **无条件 success 覆盖** — V113 遗留代码使所有检测结果强制成功 | L568-571 | 移除无条件覆盖，仅过滤后无 fail 步骤才置 true |
| 2 | **`intraStepTimer` 泄漏** — `stopIntraStepProgress()` 定义在 try 块内，finally 无法访问 | L548-555, L741 | 提前到函数顶层声明，finally 块调用清理 |
| 3 | **`format_ipv6_address` 后端返回 null 时显示"null"** | L811-814 | 增加 null 值检查，回退为 `[addr]:port` |
| 4 | **`bindGlobalKeyboardShortcuts` 重复绑定** — 返回用户路径重复注册 keydown | L1721 | 添加 `_keydownBound` 防重复 |
| 5 | **`renderProbeCard` metric 字段 null 时误分类** — `null > 200` 隐式转 false | L1201-1207 | 用 `?? 0` 防御 null 值 |
| 6 | **catch 块硬编码 9 步循环** — 步骤数不匹配，querySelectorAll 循环内重复调用 | L716-723 | 遍历实际 DOM 步骤项 |
| 7 | **`cleanCacheDir` 无 result 校验** — 后端 null 时静默报告成功 | L2315-2321 | 增加非空对象校验 |
| 8 | **`loadAppConfig` catch 清空 records** — 配置加载失败丢弃所有历史 | L2178-2185 | 保留已有 records |

### app-i18n.js 修复（3 项）
| # | Bug | 修复 |
|---|-----|------|
| 1 | 缺失 `history.record` key — app.js 调用但无翻译 | 补充中英文翻译 |
| 2 | `history.empty` 中英文各一处重复定义 | 保留首次定义 |
| 3 | 版本号 v113 → v115 | `APP_VERSION = 'v115'` |

### index.html 修复（1 项）
| # | Bug | 修复 |
|---|-----|------|
| 1 | `#history-data-path` 有 `data-i18n`，`applyTranslations()` 覆盖运行时路径 | 移除 data-i18n |

### Rust lib.rs 修复（2 项）
| # | Bug | 修复 |
|---|-----|------|
| 1 | HTTP 延迟值带尾部 `)` — `"1234ms)"` 污染 step latency | `.trim_end_matches(')')` |
| 2 | `delete_record` 越界时静默忽略 | 返回 `Err` 让前端感知失败 |

### 资源清理
- 删除 `src/assets/anime.min.js`（已废弃，HTML 注释标注移除但未执行）

### 版本号同步
- `Cargo.toml`: 115.0.0
- `tauri.conf.json`: 115.0.0
- `app-i18n.js`: `APP_VERSION = 'v115'`

