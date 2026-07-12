/* ========================================================================== app-i18n.js - 国际化处理模块 (移植自 ，适配 单体结构) -------------------------------------------------------------------------- 设计原则：纯增量，不改动 任何现有逻辑 / 导航 / DOM 结构。 - 静态文案：index.html 中加 data-i18n 属性的元素，由 applyTranslations 填充 - 动态文案：app.js 中对用户可见的关键字符串改为 t('key') 调用 - 语言偏好：localStorage('ipv6_lang') 持久化 - 版本号：{version} 占位符在 applyTranslations 时由 APP_VERSION 填充 文本层级系统 —— 通过语义 class（em-key / em-link / em-ok / em-danger / em-warn / em-strong / em-italic / em-underline）建立统一 的文字层级，遵循 60-30-10 与"避免五颜六色"。颜色一律走 CSS 变量， 禁止硬编码 hex。 ========================================================================== */

/* 全局版本号（前端单一来源）。后端 lib.rs APP_VERSION 与之保持一致。 显示规则：取主版本号拼 'v'（如 91.0.0 -> v91），不带次/修订号。 静态兜底 'v100' 仅在 Tauri 不可用时使用；运行期由 refreshAppVersionFromTauri() 从 getVersion() 拉取真实版本覆盖，确保后续版本号只需改 Cargo.toml/tauri.conf.json。 */
let APP_VERSION = 'v115';

/* * * 运行期从 Tauri 拉取真实版本号，取主版本号拼 'v'（91.0.0 -> v91）， * 覆盖静态兜底 APP_VERSION，并刷新界面文案使其与后端版本一致。 * 任何异常均静默回退到静态兜底。需在 Tauri 全局 API 就绪后调用。 */
function refreshAppVersionFromTauri() {
    try {
        const tauriApp = window.__TAURI__ && window.__TAURI__.app;
        if (!tauriApp || typeof tauriApp.getVersion !== 'function') return;
        const p = tauriApp.getVersion();
        if (p && typeof p.then === 'function') {
            p.then(function (ver) {
                const major = String(ver || '').split('.')[0];
                if (!major) return;
                const derived = 'v' + major;
                if (derived !== APP_VERSION) {
                    APP_VERSION = derived;
                    applyTranslations();
                }
            }).catch(function () {});
        }
    } catch (e) {}
}
/* 启动即异步拉取真实版本（getVersion 为 Promise），成功后刷新UI */
refreshAppVersionFromTauri();

/* 当前语言：'zh' | 'en'。let 全局，app.js 可直接读写。 */
let currentLanguage = 'zh';

const I18N = {
    zh: {
        /* - 标题栏 --- */
        'app.title': '我的世界 IPv6 联机工具',
        'app.subtitle': '我的世界 IPv6 联机工具 {version}',
        'btn.language': 'EN',   /* 显示“将切换到的语言”：中文界面下显示 EN */
        'btn.theme': '🌙',      /* 当前为亮色，点击切换到暗色（显示月亮） */

        /* - 主页 --- */
        'home.main.title': '我的世界 IPv6 联机工具',
        'home.btn.detect': '开始检测',
        'home.status': '点击 <span class="em-key">"开始检测"</span> 检查您的 <strong>IPv6</strong> 连接',
        'home.btn.protest': '🔗 对测试结果不满意？访问专业测试网站',
        'home.developer.name': 'HIMKUG',
        'home.developer.badge': '开发者',
        'home.developer.badge.bilibili': 'B站 UP 主',
        'home.developer.arrow': '主页 →',

        /* - 检测页 --- */
        'detect.title.detecting': '正在检测...',
        'detect.btn.retry': '🔄 重新检测',
        'detect.btn.pro_test': '🔗 专业测试网站',
        'detect.btn.tutorial': '▶ 观看 B 站视频教程',
        'detect.btn.back': '← 返回',
        'detect.btn.continue': '继续 ▶',
        'detect.btn.continue_risk': '无视风险后继续',
        'detect.btn.quick_repair': '⚡ 快速修复',
        'detect.btn.deep_repair': '🔧 深度修复',
        'btn.detect': '开始检测',
        'btn.detecting': '检测中...',
        'btn.start_diagnosis': '开始诊断',
        'btn.diagnosing': '诊断中...',
        'btn.diagnosis_complete': '诊断完成',
        'btn.diagnosis_failed': '诊断失败',
        'detect.guide.text': '<span class="em-danger">修复未生效？</span>前往<span class="em-link">专业测试网站</span>深入排查',
        'detect.status.all_success_priority': '<span class="em-ok">所有检测项成功</span>{priority}，点击继续以获取连接地址',
        'detect.status.partial': '检测项<span class="em-warn">部分不成功</span>，可能出现问题。已显示修复按钮，建议先尝试修复。',
        'detect.status.failed': '<span class="em-danger">检测失败</span>，请尝试修复或检查网络设置',

        /* - 步骤标签 --- */
        'step.0': '枚举网卡',
        'step.1': '过滤链路本地地址',
        'step.2': '提取公网 IPv6 地址',
        'step.3': 'IPv4 域名连接测试',
        'step.4': 'IPv6 域名连接测试',
        'step.5': '双栈域名连接测试',
        'step.6': '双栈大数据包传输',
        'step.7': 'IPv6 大数据包传输',
        'step.8': 'NAT66 检测',
        'step.waiting': '等待中',
        'step.running': '进行中...',
        'step.success': '✓ 成功',
        'step.fail': '✗ 失败',
        'step.warn': '⚠ 警告',

        /* - 配置页 --- */
        'config.title': '配置连接地址',
        'config.label.address': 'IPv6 地址',
        'config.label.port': '端口号',
        'config.port.hint': '(1-65535)',
        'config.port.placeholder': '在此输入端口号',
        'config.btn.generate': '生成连接地址',
        'config.addr.detecting': '检测中...',
        'config.addr.none': '无可用 IPv6 地址',
        'config.port.invalid': '请输入<em class="em-danger">有效端口号</em>',
        'config.port.hint_fill': '填写端口号后继续',
        'config.hint.title': '📖 <strong>如何获取联机端口号？</strong>',
        'config.hint.step1': '进入单人存档，按 <kbd>ESC</kbd> → 点击<span class="em-key">「对局域网开放」</span>',
        'config.hint.step2': '设置游戏模式和作弊选项后，点击<span class="em-key">「启动局域网世界」</span>',
        'config.hint.step3': '左下角聊天框会提示：<code>本地游戏已在端口 xxxxx 上开启</code>',
        'config.hint.step4': '将 <span class="em-key">xxxxx</span> 填入上方端口号即可',
        'config.hint.note19_3': '<span class="em-key">1.19.3 及以上版本</span>：可在"对局域网开放"界面手动指定端口，建议填 <span class="em-link">25565</span>。',
        'config.hint.note19_3_low': '<span class="em-warn">1.19.3 以下版本</span>：端口随机生成（1024–65535），如需固定请安装"自定义局域网联机"Mod。',
        'config.footer': '填入<strong>端口号</strong>以生成<span class="em-link">联机地址</span>',

        /* - 结果页 --- */
        'result.title': '连接地址',
        'result.label': '您的联机地址',
        'result.btn.copy': '📋 复制地址',
        'result.btn.latency': '🎯 网络性能诊断',
        'result.hint': '对方在<strong>"直接连接"</strong>中输入此地址即可加入<br><span class="result-hint-accent">💡 测测速，看看和朋友联机有多快</span>',
        'result.footer': '将此地址分享给<strong>朋友</strong>即可<span class="em-ok">联机</span>',
        'addr.temp': ' (临时)',
        'copy.ok': '✓ 已复制！',
        'copy.fail': '✗ 复制失败',
        'copy.label': '📋 复制到剪贴板',

        /* - 故障页 --- */
        'fault.title': 'IPv6 异常处理',
        'fault.btn.quick_repair': '⚡ 快速修复',
        'fault.btn.deep_repair': '🔧 深度修复',
        'fault.log.title': '修复日志',
        'fault.verify.hint': '<span class="em-ok">修复完成</span>',
        'fault.btn.retry': '🔄 重新检测',
        'fault.btn.pro_test': '🔗 专业测试网站',
        'fault.footer': '检测到<span class="em-danger">连接异常</span>，请尝试<strong>修复方案</strong>。修复完成后请<strong>重新检测</strong>以验证是否生效',

        /* - 延迟诊断页 --- */
        'latency.title': 'IPv6 网络性能诊断',
        'latency.label.target': '目标 IPv6 地址 / 域名',
        'latency.target.placeholder': '请输入对方的 IPv6 地址',
        'latency.input.hint': '⚠ 请先输入<span class="em-key">对方的 IPv6 地址</span>才能开始诊断',
        'latency.btn.start': '开始诊断',
        'latency.btn.hint_empty': '填入地址后即可诊断',
        'latency.title.short': '网络性能诊断',
        'latency.footer': '<strong>v6-probe</strong> 高精度多维度延迟测量',
        'latency.target.too_long': '目标过长（>253 字符）',
        'latency.diagnosing': '诊断中...',
        'latency.done': '诊断完成',
        'latency.fail_prefix': '✗ 诊断失败：',
        'latency.path_title': '路径延迟（Path Latency）',
        'latency.path_desc': '追踪数据包经过每台路由器的往返时间，跳数越多说明经过的路由器越多，延迟也会叠加。通常 &lt;15 跳为正常，&gt;30 跳可能表示存在路由问题。',
        'latency.empty_msg': '填入目标 IPv6 地址后开始诊断',
        'latency.done_msg': '诊断完成！',
        'latency.quality.good': '优秀',
        'latency.quality.warn': '一般',
        'latency.quality.bad': '较差',
        'latency.quality.fast': '快速',
        'latency.quality.slow': '缓慢',
        'latency.metric.min': '最小延迟（Min）',
        'latency.metric.max': '最大延迟（Max）',
        'latency.metric.mean': '平均延迟（Mean）',
        'latency.metric.p95': '95分位延迟（P95）',
        'latency.metric.jitter': '抖动（Jitter）',
        'latency.metric.loss': '丢包率',
        'latency.metric.samples': '成功 {samples} / {total} 次',
        'latency.dns_title': 'DNS AAAA 解析',
        'latency.dns_subtitle': '域名解析耗时（DNS Lookup Time）',
        'latency.tcp_title': 'TCP 握手延迟',
        'latency.tcp_subtitle': 'TCP 建连往返时间',
        'latency.icmp_title': 'ICMPv6 延迟',
        'latency.icmp_subtitle': 'ICMP Echo 往返时间',

        /* - 历史详情 --- */
        'history.detail.success': '检测成功',
        'history.detail.failure': '检测失败',
        'history.detail.network_diag': '网络性能诊断',
        'history.detail.detection': '检测',

        /* - 历史页 --- */
        'history.title': '历史检测记录',
        'history.empty': '暂无历史记录',
        'history.btn.clear': '清除所有痕迹',
        'history.data.path': '数据存储路径：加载中...',
        'history.detail.title': '检测详情',
        'history.detail.delete': '清除记录',
        'history.detail.close': '关闭页面',
        'history.detail.unknown_time': '未知时间',

        /* - 免责声明页 --- */
        'disclaimer.title': '免责声明',
        'disclaimer.footer': '请仔细阅读以上条款',
        'disclaimer.h1': '一、软件性质',
        'disclaimer.h2': '二、功能与风险',
        'disclaimer.h3': '三、使用限制',
        'disclaimer.h4': '四、责任限制',
        'disclaimer.h5': '五、开源协议与 AI 披露',
        'disclaimer.p1': '本工具是一款面向 <span class="em-link">《我的世界》（Minecraft）</span> 玩家的 <span class="em-key">IPv6 联机辅助软件</span>，由个人开发者以业余项目形式开发，<span class="em-ok">免费开放使用</span>，无任何广告、内购或变现机制，源代码基于 <strong>Apache 2.0</strong> 协议开源。',
        'disclaimer.p2': '本工具以 <span class="em-danger">"现状"（AS IS）</span> 提供，开发者不对软件的可用性、稳定性或兼容性作任何明示或暗示的保证。',
        'disclaimer.p3': '本工具提供以下功能：',
        'disclaimer.p4': '在正常环境下，上述功能可按设计意图正常工作。但在 <span class="em-danger">系统环境异常</span>（如 PATH 被劫持、系统组件损坏、权限配置异常、杀毒软件拦截等）的情况下，修复类操作 <span class="em-danger">可能造成可逆的系统配置变更</span>（如网络配置回滚、需重启计算机等），此类风险由用户自行承担。',
        'disclaimer.p5': '用户承诺 <span class="em-danger">不得</span> 将本工具用于任何违法违规用途，包括但不限于：',
        'disclaimer.p6': '如用户违反上述规定，<span class="em-danger">一切后果由用户本人承担</span>，开发者不承担任何责任。',
        'disclaimer.p7': '本工具为 <span class="em-ok">免费、非盈利</span> 的个人项目，开发者仅在存在故意或重大过失时承担法律责任。对于因使用本工具造成的任何直接、间接、偶然或衍生性损害（包括数据丢失、业务中断等），开发者不承担责任。',
        'disclaimer.p8': '<em>"可逆破坏"</em>指可通过重启计算机、系统还原或重新执行修复操作恢复的损害；不可逆的数据丢失或硬件损坏不在本工具可预见风险范围内。',
        'disclaimer.p9': '本工具基于 <span class="em-link">Apache License 2.0</span> 开源，完整协议见：<code>https://www.apache.org/licenses/LICENSE-2.0</code>。',
        'disclaimer.p10': '<span class="em-warn">AI 生成内容披露：</span>本工具部分代码由人工智能辅助生成，已经人工审核，但不对 AI 生成内容的绝对正确性、完整性或安全性作保证。如发现异常，请 <span class="em-danger">立即停止使用</span> 并反馈至开发者。',
        'disclaimer.p11': '<em>开发者保留对本免责声明的最终解释权与修订权。</em>',
        'disclaimer.li1': '<span class="em-ok">检测类</span>：IPv6 地址枚举、公网可用性测试、NAT66 检测等只读操作；',
        'disclaimer.li2': '<span class="em-warn">修复类</span>：在用户主动调用下，执行网络栈重置、协议栈修复等系统级写入操作。',
        'disclaimer.li3': '未经授权访问、攻击他人计算机或网络系统；',
        'disclaimer.li4': '破坏信息系统、窃取数据、传播恶意代码；',
        'disclaimer.li5': '实施网络诈骗、侵犯公民个人信息等违法犯罪行为。',

        /* - Debug mode confirm modal --- */
        'app.debug.confirm_title': '开启 Debug 模式',
        'app.debug.confirm_desc': '是否开启 Debug 模式？开启后将在缓存目录中记录调试日志，有助于排查问题。',
        'app.debug.confirm_btn': '开启',
        'app.debug.cancel_btn': '取消',
        'app.debug.open_failed': '开启 Debug 模式失败：',
        'history.confirm_title': '确认清除',
        'history.confirm_desc': '确定要删除 {type}：{addr} 吗？此操作不可撤销。',
        'history.confirm_delete_failed': '删除失败：',
        'history.delete_failed': '删除失败',
        'history.confirm_default_addr': '此条',
        'history.save_failed': '历史记录保存失败，但检测结果正确',
        'history.clear_all_title': '确定要清除所有历史记录吗？这将删除所有检测记录。',
        'history.cleared': '历史记录已清除',
        'history.clear_failed': '清除失败：',
        'cache.clean.title': '清理缓存',
        'cache.clean.desc': '将清除缓存目录中的杂余数据文件（保留历史记录和配置）。是否继续？',
        'cache.clean.confirm': '清理',
        'cache.clean.cancel': '取消',
        'cache.clean.success': '已清除 {count} 个杂余文件',
        'cache.clean.success_partial': '已清除 {count} 个杂余文件，保留 {kept} 个必要文件',
        'cache.clean.failed': '清理失败：',
        'home.status.not_admin': '⚠ 未以管理员身份运行',
        'home.status.tauri_unavailable': '⚠ Tauri API 不可用',
        'home.status.init_failed': '⚠ 初始化出错',
        'init.detecting': '正在初始化检测...',
        'init.enumerating': '正在枚举网卡...',
        'init.detect_error': '检测出错: ',
        'init.step_failed': '检测出错',
        'gen.busy': '地址生成正在进行中，请勿重复点击',
        'repair.busy': '修复正在进行中，请勿重复点击',
        'tracert.busy': '诊断正在进行中，请勿重复点击',
        'repair.timeout': '修复超时（60秒）',
        'repair.timeout_deep': '修复超时（120秒）',
        'repair.unresponsive': '✗ 修复无响应，请检查是否以管理员身份运行本软件',
        'repair.failed': '✗ 修复执行出错：',
        'repair.check_admin': '\n请检查是否以管理员身份运行本软件',
        'modal.title.fix': '修复',
        'modal.title.quick_repair': '⚡ 快速修复',
        'modal.subtitle.quick_repair': '正在修复网络配置，请稍候...',
        'modal.title.deep_repair': '🔧 深度修复',
        'modal.subtitle.deep_repair': '正在重置网络协议栈（重置后需重启计算机），请稍候...',
        'addr.placeholder': '请输入对方的 IPv6 地址',
        'path.first_hop': '首跳延迟（First Hop）',
        'path.last_hop': '末跳延迟（Last Hop）',
        'score.meta_avg_latency': '平均延迟 {value}ms',
        'score.meta_packet_loss': '丢包率 {value}%',
        'score.meta_no_data': '暂无数据',
        'path.hops_count': '{hops} 跳',
        'summary.path_hops': '路径跳数',
        'summary.hops_unit': ' 跳',
        'summary.detection_result': '检测结果',
        'summary.no_address_short': '(无)',
        'history.no_steps': '无详细步骤信息',
        'confirm.default_title': '确认',
        'confirm.default_ok': '确定',
        'confirm.default_cancel': '取消',

        /* - 首次启动弹窗 --- */
        'first.title': '欢迎使用 IPv6 联机工具',
        'first.desc': '在开始使用前，请仔细阅读并同意以下免责声明：',
        'first.preview1': '<span class="em-strong">本工具以"现状"（AS IS）免费提供</span>，由个人开发者业余开发，<span class="em-ok">无任何盈利目的</span>。',
        'first.preview2': '本工具包含 IPv6 检测与网络修复功能。在<span class="em-danger">系统环境异常</span>的情况下，修复类操作<span class="em-danger">可能造成可逆的系统配置变更</span>，风险由用户自行承担。',
        'first.preview3': '<em>部分代码由 AI 辅助生成。</em>详情请查看完整免责声明。',
        'first.disagree': '拒绝',
        'first.agree': '同意',

        /* - 确认对话框 --- */
        'confirm.title': '确认操作',
        'confirm.message': '确定要执行此操作吗？',
        'confirm.cancel': '取消',
        'confirm.ok': '确认',

        /* - 浮窗按钮 --- */
        'floating.history': '📋 历史记录',
        'floating.latency': '⏱ 网络性能诊断',
        'floating.disclaimer': '📜 免责声明',

        /* - 修复模态 --- */
        'repair.modal.title': '快速修复',
        'repair.modal.subtitle': '正在修复网络配置...',
        'repair.modal.back': '← 返回',
        'repair.modal.retry': '🔄 重试',

        /* - History cards () --- */
        'history.empty': '暂无历史记录',
        'history.no_address': '(无地址)',
        'history.status.good': '✓ 优秀',
        'history.status.fair': '✓ 良好',
        'history.status.poor': '✗ 较差',
        'history.status.success': '✓ 成功',
        'history.status.fail': '✗ 失败',
        'history.type.probe': '诊断',
        'history.type.label': '记录',
        /* V115: 补充 app.js 调用的缺失 key */
        'history.record': '记录',
        /* 补充缺失的 history.quality.* 翻译键 */
        'history.quality.good': '优秀',
        'history.quality.warn': '一般',
        'history.quality.bad': '较差',
        'history.quality.fast': '快速',
        'history.quality.slow': '缓慢',
        'history.quality.excellent': '优秀',
        'history.quality.normal': '一般',
        'history.quality.poor': '较差',
        'history.quality.quick': '快速',

        /* - Probe cards () --- */
        'probe.empty': '无数据',
        'probe.quality.good': '优秀',
        'probe.quality.warn': '一般',
        'probe.quality.bad': '较差',
        'probe.quality.fast': '快速',
        'probe.quality.slow': '缓慢',
        'probe.metric.min': '最小延迟（Min）',
        'probe.metric.max': '最大延迟（Max）',
        'probe.metric.mean': '平均延迟（Mean）',
        'probe.metric.p95': '95分位延迟（P95）',
        'probe.metric.jitter': '抖动（Jitter）',
        'probe.metric.loss': '丢包率',
        'probe.samples': '成功 {samples} / {total} 次',
        'probe.dns_title': 'DNS AAAA 解析',
        'probe.dns_subtitle': '域名解析耗时（DNS Lookup Time）',
        'probe.tcp_title': 'TCP 握手延迟',
        'probe.tcp_subtitle': 'TCP 建连往返时间',
        'probe.icmp_title': 'ICMPv6 延迟',
        'probe.icmp_subtitle': 'ICMP Echo 往返时间',
        'probe.path_title': '路径延迟（Path Latency）',
        'probe.path_desc': '追踪数据包经过每台路由器的往返时间，跳数越多说明经过的路由器越多，延迟也会叠加。通常 &lt;15 跳为正常，&gt;30 跳可能表示存在路由问题。',
        'probe.hops': '{hops} 跳',
        'probe.first_hop': '首跳延迟（First Hop）',
        'probe.last_hop': '末跳延迟（Last Hop）',
        'probe.resolution': '解析耗时',
        'probe.all_fail': '所有探测均失败，请检查目标地址和防火墙设置',

        /* - Detection status labels () --- */
        'detect.status.done': '检测完成',
        'detect.status.done_msg': '检测完成！',
        'detect.detecting': '正在检测...',

        /* - Summary labels () --- */
        'summary.score': '综合评分',
        'summary.avg_latency': '平均延迟',
        'summary.packet_loss': '丢包率',
        'summary.dns': 'DNS 解析',
        'summary.result': '检测结果',
        'summary.ipv6_address': 'IPv6 地址',
        'summary.no_address': '(无地址)',
        'summary.priority_title': '访问优先级',
        'summary.priority_ipv6': 'IPv6 优先',
        'summary.priority_ipv4': 'IPv4 优先',
        'summary.summary': '摘要',
        'latency.unknown_error': '未知错误',
        'latency.no_data': '无诊断数据',
        'probe.hops_label': '{hops} 跳',
        'probe.first_hop_label': '首跳延迟',
        'probe.last_hop_label': '末跳延迟',
        'probe.success_label': '成功',
        'probe.fail_label': '失败',
        'time.unknown': '未知时间',
        /* - 可访问性：按钮 aria-label（随语言切换，避免静态 aria-label 与可见文字脱节） --- */
        'aria.language': '切换语言',
        'aria.theme': '切换深色或浅色主题',
        'aria.minimize': '最小化窗口',
        'aria.close': '关闭窗口',
        'aria.close_panel': '关闭弹窗',
        'aria.start_detect': '开始 IPv6 连接检测',
        'aria.pro_test': '访问专业测试网站',
        'aria.retry_detect': '重新检测',
        'aria.visit_pro': '访问专业测试网站',
        'aria.watch_tutorial': '观看 B 站视频教程',
        'aria.back': '返回',
        'aria.back_home': '返回主页',
        'aria.continue': '继续',
        'aria.continue_risk': '无视风险继续',
        'aria.quick_repair': '快速修复网络',
        'aria.deep_repair': '深度修复网络',
        'aria.generate_addr': '生成联机地址',
        'aria.copy_result': '复制联机地址',
        'aria.diagnose_latency': '网络性能诊断',
        'aria.clear_all': '清除所有历史记录',
        'aria.disagree': '拒绝并退出',
        'aria.agree': '同意声明',
        'aria.cancel': '取消',
        'aria.confirm': '确认',
        'aria.open_history': '查看历史记录',
        'aria.open_disclaimer': '查看免责声明',
        'aria.retry': '重试',
        'aria.delete_record': '清除该记录',
        'aria.debug_toggle': '切换调试日志显示',
    },

    en: {
        /* - Title bar --- */
        'app.title': 'Minecraft IPv6 Connection Tool',
        'app.subtitle': 'Minecraft IPv6 Connection Tool {version}',
        'btn.language': '中',
        'btn.theme': '☀️',

        /* - Home --- */
        'home.main.title': 'Minecraft IPv6 Connection Tool',
        'home.btn.detect': 'Start Detection',
        'home.status': 'Click <span class="em-key">"Start Detection"</span> to check your <strong>IPv6</strong> connection',
        'home.btn.protest': '🔗 Unsatisfied with results? Visit the pro test site',
        'home.developer.name': 'HIMKUG',
        'home.developer.badge': 'Developer',
        'home.developer.badge.bilibili': 'Bilibili UP',
        'home.developer.arrow': 'Home →',

        /* - Detect --- */
        'detect.title.detecting': 'Detecting...',
        'detect.btn.retry': '🔄 Re-detect',
        'detect.btn.pro_test': '🔗 Pro Test Site',
        'detect.btn.tutorial': '▶ Watch Bilibili Tutorial',
        'detect.btn.back': '← Back',
        'detect.btn.continue': 'Continue ▶',
        'detect.btn.continue_risk': 'Continue Anyway',
        'detect.btn.quick_repair': '⚡ Quick Repair',
        'detect.btn.deep_repair': '🔧 Deep Repair',
        'detect.guide.text': '<span class="em-danger">Fix not working?</span> Visit <span class="em-link">pro test site</span> for deep diagnosis',
        'detect.status.all_success_priority': '<span class="em-ok">All checks passed</span>{priority}. Continue to get your connection address',
        'detect.status.partial': 'Some checks <span class="em-warn">failed</span>. Repair buttons are shown — try repairing first.',
        'detect.status.failed': '<span class="em-danger">Detection failed</span>. Try repairing or check your network settings',
        'detect.status.done': 'Detection complete',
        'detect.status.done_msg': 'Detection complete!',
        'detect.detecting': 'Detecting...',
        'probe.resolution': 'Resolution time',
        'probe.all_fail': 'All probes failed. Check the target address and firewall settings',

        /* - Steps --- */
        'step.0': 'Enumerate adapters',
        'step.1': 'Filter link-local addresses',
        'step.2': 'Extract public IPv6 address',
        'step.3': 'IPv4 domain connectivity',
        'step.4': 'IPv6 domain connectivity',
        'step.5': 'Dual-stack domain test',
        'step.6': 'Dual-stack large packet transfer',
        'step.7': 'IPv6 large packet transfer',
        'step.8': 'NAT66 detection',
        'step.waiting': 'Waiting',
        'step.running': 'Running...',
        'step.success': '✓ Success',
        'step.fail': '✗ Failed',
        'step.warn': '⚠ Warning',

        /* - Config --- */
        'config.title': 'Configure Address',
        'config.label.address': 'IPv6 Address',
        'config.label.port': 'Port',
        'config.port.hint': '(1-65535)',
        'config.port.placeholder': 'Enter port number',
        'config.btn.generate': 'Generate Address',
        'config.addr.detecting': 'Detecting...',
        'config.addr.none': 'No available IPv6 address',
        'config.port.invalid': 'Please enter a <em class="em-danger">valid port</em>',
        'config.port.hint_fill': 'Fill in the port to continue',
        'config.hint.title': '📖 <strong>How to get the port?</strong>',
        'config.hint.step1': 'Open a single-player world, press <kbd>ESC</kbd> → click <span class="em-key">"Open to LAN"</span>',
        'config.hint.step2': 'Set game mode & cheats, then click <span class="em-key">"Start LAN World"</span>',
        'config.hint.step3': 'The chat box shows: <code>Local game hosted on port xxxxx</code>',
        'config.hint.step4': 'Enter <span class="em-key">xxxxx</span> into the port field above',
        'config.hint.note19_3': '<span class="em-key">1.19.3+</span>: you can set the port manually in "Open to LAN". Recommended: <span class="em-link">25565</span>.',
        'config.hint.note19_3_low': '<span class="em-warn">Below 1.19.3</span>: port is random (1024–65535). Install the "LAN World Fix" mod to fix it.',
        'config.footer': 'Enter <strong>port</strong> to generate the <span class="em-link">connection address</span>',

        /* - Result --- */
        'result.title': 'Connection Address',
        'result.label': 'Your Connection Address',
        'result.btn.copy': '📋 Copy Address',
        'result.btn.latency': '🎯 Network Diagnosis',
        'result.hint': 'Friends join by entering this address in <strong>"Direct Connection"</strong><br><span class="result-hint-accent">💡 Run a speed test to see how fast you connect</span>',
        'result.footer': 'Share this address with <strong>friends</strong> to <span class="em-ok">play together</span>',
        'addr.temp': ' (temp)',
        'copy.ok': '✓ Copied!',
        'copy.fail': '✗ Copy failed',
        'copy.label': '📋 Copy to clipboard',

        /* - Fault --- */
        'fault.title': 'IPv6 Troubleshooting',
        'fault.btn.quick_repair': '⚡ Quick Repair',
        'fault.btn.deep_repair': '🔧 Deep Repair',
        'fault.log.title': 'Repair Log',
        'fault.verify.hint': '<span class="em-ok">Repair complete</span>',
        'fault.btn.retry': '🔄 Re-detect',
        'fault.btn.pro_test': '🔗 Pro Test Site',
        'fault.footer': 'Connection <span class="em-danger">issue detected</span>. Try a <strong>repair option</strong>. After repairing, <strong>re-detect</strong> to verify.',

        /* - Latency --- */
        'latency.title': 'IPv6 Network Diagnosis',
        'latency.label.target': 'Target IPv6 Address / Domain',
        'latency.target.placeholder': 'Enter the target IPv6 address',
        'latency.input.hint': '⚠ Enter the <span class="em-key">target IPv6 address</span> first to start diagnosis',
        'latency.btn.start': 'Start Diagnosis',
        'latency.btn.hint_empty': 'Enter address to diagnose',
        'latency.title.short': 'Network Diagnosis',
        'latency.footer': '<strong>v6-probe</strong> high-precision multi-dimensional latency measurement',
        'latency.target.too_long': 'Target too long (>253 chars)',
        'latency.diagnosing': 'Diagnosing...',
        'latency.done': 'Diagnosis complete',
        'latency.fail_prefix': '✗ Diagnosis failed: ',
        'latency.path_title': 'Path Latency',
        'latency.path_desc': 'Traces the round-trip time through each router hop. More hops means more routers the packet passes through, increasing latency. &lt;15 hops is normal, &gt;30 hops may indicate routing issues.',
        'latency.empty_msg': 'Enter target IPv6 address to diagnose',
        'latency.done_msg': 'Diagnosis complete!',
        'latency.quality.good': 'Excellent',
        'latency.quality.warn': 'Fair',
        'latency.quality.bad': 'Poor',
        'latency.quality.fast': 'Fast',
        'latency.quality.slow': 'Slow',
        'latency.metric.min': 'Min Latency',
        'latency.metric.max': 'Max Latency',
        'latency.metric.mean': 'Mean Latency',
        'latency.metric.p95': 'P95 Latency',
        'latency.metric.jitter': 'Jitter',
        'latency.metric.loss': 'Packet Loss',
        'latency.metric.samples': '{samples} / {total} successful',
        'latency.dns_title': 'DNS AAAA Lookup',
        'latency.dns_subtitle': 'Domain Name Resolution Time',
        'latency.tcp_title': 'TCP Handshake Latency',
        'latency.tcp_subtitle': 'TCP Connection Round-Trip Time',
        'latency.icmp_title': 'ICMPv6 Latency',
        'latency.icmp_subtitle': 'ICMP Echo Round-Trip Time',

        /* - History --- */
        'history.title': 'History Records',
        'history.empty': 'No history yet',
        'history.btn.clear': 'Clear All',
        'history.data.path': 'Data path: loading...',
        'history.detail.title': 'Details',
        'history.detail.delete': 'Delete',
        'history.detail.close': 'Close',
        'history.detail.unknown_time': 'Unknown time',
        'history.detail.success': 'Detection Successful',
        'history.detail.failure': 'Detection Failed',
        'history.detail.network_diag': 'Network Diagnosis',
        'history.detail.detection': 'Detection',

        /* - Disclaimer --- */
        'disclaimer.title': 'Disclaimer',
        'disclaimer.footer': 'Please read the terms above carefully',
        'disclaimer.h1': '1. Nature of Software',
        'disclaimer.h2': '2. Features & Risks',
        'disclaimer.h3': '3. Usage Restrictions',
        'disclaimer.h4': '4. Liability Limitation',
        'disclaimer.h5': '5. Open Source & AI Disclosure',
        'disclaimer.p1': 'This tool is an <span class="em-link">Minecraft</span> player\'s <span class="em-key">IPv6 multiplayer assist utility</span>, developed by an individual as a hobby project, <span class="em-ok">free to use</span>, with no ads, in-app purchases, or monetization. The source code is open-sourced under the <strong>Apache 2.0</strong> license.',
        'disclaimer.p2': 'This tool is provided <span class="em-danger">"as is"</span>. The developer makes no express or implied warranty regarding the software\'s usability, stability, or compatibility.',
        'disclaimer.p3': 'This tool provides the following functions:',
        'disclaimer.p4': 'Under normal conditions, the above functions work as designed. However, in cases of <span class="em-danger">abnormal system environment</span> (e.g., hijacked PATH, corrupted system components, abnormal permission configuration, antivirus interception, etc.), repair operations <span class="em-danger">may cause reversible system configuration changes</span> (such as network configuration rollback or requiring a computer restart). Such risks are borne by the user.',
        'disclaimer.p5': 'The user agrees <span class="em-danger">not to</span> use this tool for any illegal or non-compliant purposes, including but not limited to:',
        'disclaimer.p6': 'If the user violates the above provisions, <span class="em-danger">all consequences shall be borne by the user</span>, and the developer assumes no liability.',
        'disclaimer.p7': 'This tool is a <span class="em-ok">free, non-profit</span> personal project. The developer is liable only in cases of willful misconduct or gross negligence. The developer is not liable for any direct, indirect, incidental, or consequential damages (including data loss, business interruption, etc.) arising from the use of this tool.',
        'disclaimer.p8': '<em>"Reversible damage"</em> refers to harm that can be recovered by restarting the computer, performing a system restore, or re-running repair operations. Irreversible data loss or hardware damage is outside the foreseeable risk scope of this tool.',
        'disclaimer.p9': 'This tool is open-sourced under the <span class="em-link">Apache License 2.0</span>. The full license is available at: <code>https://www.apache.org/licenses/LICENSE-2.0</code>.',
        'disclaimer.p10': '<span class="em-warn">AI-generated content disclosure:</span> Part of this tool\'s code was generated with AI assistance and has been manually reviewed. However, no guarantee is made regarding the absolute correctness, completeness, or security of AI-generated content. If any anomaly is found, please <span class="em-danger">stop using it immediately</span> and report it to the developer.',
        'disclaimer.p11': '<em>The developer reserves the final right of interpretation and revision of this disclaimer.</em>',
        'disclaimer.li1': '<span class="em-ok">Detection</span>: read-only operations such as IPv6 address enumeration, public connectivity testing, and NAT66 detection;',
        'disclaimer.li2': '<span class="em-warn">Repair</span>: system-level write operations such as network stack reset and protocol stack repair, executed only when actively invoked by the user.',
        'disclaimer.li3': 'Unauthorized access to, or attacks on, others\' computers or network systems;',
        'disclaimer.li4': 'Damaging information systems, stealing data, or spreading malicious code;',
        'disclaimer.li5': 'Committing online fraud, infringing on citizens\' personal information, or other illegal and criminal acts.',

        /* - Debug mode confirm modal --- */
        'app.debug.confirm_title': 'Enable Debug Mode',
        'app.debug.confirm_desc': 'Enable debug mode? It will write debug logs to the cache directory to help with troubleshooting.',
        'app.debug.confirm_btn': 'Enable',
        'app.debug.cancel_btn': 'Cancel',
        'app.debug.open_failed': 'Failed to enable debug mode: ',
        'history.confirm_title': 'Confirm Delete',
        'history.confirm_desc': 'Are you sure you want to delete {type}: {addr}? This cannot be undone.',
        'history.confirm_delete_failed': 'Delete failed: ',
        'history.delete_failed': 'Delete failed',
        'history.confirm_default_addr': 'this entry',
        'history.save_failed': 'Failed to save history, but the detection result is correct',
        'history.clear_all_title': 'Are you sure you want to clear all history records? This will delete all detection records.',
        'history.cleared': 'History cleared',
        'history.clear_failed': 'Clear failed: ',
        'cache.clean.title': 'Clean Cache',
        'cache.clean.desc': 'This will remove junk files from the cache directory (history and config are kept). Continue?',
        'cache.clean.confirm': 'Clean',
        'cache.clean.cancel': 'Cancel',
        'cache.clean.success': 'Removed {count} junk file(s)',
        'cache.clean.success_partial': 'Removed {count} junk file(s), kept {kept} necessary file(s)',
        'cache.clean.failed': 'Clean failed: ',
        'home.status.not_admin': '⚠ Not running as administrator',
        'home.status.tauri_unavailable': '⚠ Tauri API unavailable',
        'home.status.init_failed': '⚠ Initialization failed',
        'init.detecting': 'Initializing detection...',
        'init.enumerating': 'Enumerating adapters...',
        'init.detect_error': 'Detection error: ',
        'init.step_failed': 'Detection failed',
        'gen.busy': 'Address generation in progress, please do not click again',
        'repair.busy': 'Repair in progress, please do not click again',
        'tracert.busy': 'Diagnosis in progress, please do not click again',
        'repair.timeout': 'Repair timeout (60s)',
        'repair.timeout_deep': 'Repair timeout (120s)',
        'repair.unresponsive': '✗ Repair unresponsive, please run as administrator',
        'repair.failed': '✗ Repair failed: ',
        'repair.check_admin': '\nPlease run as administrator',
        'modal.title.fix': 'Repair',
        'modal.title.quick_repair': '⚡ Quick Repair',
        'modal.subtitle.quick_repair': 'Repairing network configuration, please wait...',
        'modal.title.deep_repair': '🔧 Deep Repair',
        'modal.subtitle.deep_repair': 'Resetting network protocol stack (reboot required), please wait...',
        'addr.placeholder': 'Enter the target IPv6 address',
        'path.first_hop': 'First Hop Latency',
        'path.last_hop': 'Last Hop Latency',
        'score.meta_avg_latency': 'Avg Latency {value}ms',
        'score.meta_packet_loss': 'Packet Loss {value}%',
        'score.meta_no_data': 'No data',
        'path.hops_count': '{hops} hops',
        'summary.path_hops': 'Path Hops',
        'summary.hops_unit': ' hops',
        'summary.detection_result': 'Detection Result',
        'summary.no_address_short': '(none)',
        'history.no_steps': 'No detailed step information',
        'confirm.default_title': 'Confirm',
        'confirm.default_ok': 'OK',
        'confirm.default_cancel': 'Cancel',

        /* - First run --- */
        'first.title': 'Welcome to IPv6 Tool',
        'first.desc': 'Before using, please read and agree to the disclaimer below:',
        'first.preview1': '<span class="em-strong">This tool is provided free "AS IS"</span> by an individual developer as a hobby project, <span class="em-ok">with no profit motive</span>.',
        'first.preview2': 'This tool includes IPv6 detection and network repair. Under <span class="em-danger">abnormal system conditions</span>, repair operations <span class="em-danger">may cause reversible system config changes</span>; the risk is borne by the user.',
        'first.preview3': '<em>Part of the code is AI-assisted.</em> See the full disclaimer for details.',
        'first.disagree': 'Decline',
        'first.agree': 'Agree',

        /* - Confirm --- */
        'confirm.title': 'Confirm',
        'confirm.message': 'Are you sure you want to perform this action?',
        'confirm.cancel': 'Cancel',
        'confirm.ok': 'OK',

        /* - Floating --- */
        'floating.history': '📋 History',
        'floating.latency': '⏱ Diagnosis',
        'floating.disclaimer': '📜 Disclaimer',

        /* - Repair modal --- */
        'repair.modal.title': 'Quick Repair',
        'repair.modal.subtitle': 'Repairing network config...',
        'repair.modal.back': '← Back',
        'repair.modal.retry': '🔄 Retry',

        /* - History cards () --- */
        'history.empty': 'No history yet',
        'history.no_address': 'No address',
        'history.status.good': 'Excellent',
        'history.status.fair': 'Fair',
        'history.status.poor': 'Poor',
        'history.status.success': 'Success',
        'history.status.fail': 'Failed',
        'history.type.probe': 'Diagnosis',
        'history.type.label': 'Record',
        /* V115: 补充 app.js 调用的缺失 key */
        'history.record': 'Record',
        'history.quality.good': 'Excellent',
        'history.quality.warn': 'Fair',
        'history.quality.bad': 'Poor',
        'history.quality.fast': 'Fast',
        'history.quality.slow': 'Slow',
        'history.quality.excellent': 'Excellent',
        'history.quality.normal': 'Fair',
        'history.quality.poor': 'Poor',
        'history.quality.quick': 'Fast',

        /* - Probe cards () --- */
        'probe.empty': 'No data',
        'probe.quality.good': 'Excellent',
        'probe.quality.warn': 'Fair',
        'probe.quality.bad': 'Poor',
        'probe.metric.min': 'Min Latency',
        'probe.metric.max': 'Max Latency',
        'probe.metric.mean': 'Mean Latency',
        'probe.metric.p95': 'P95 Latency',
        'probe.metric.jitter': 'Jitter',
        'probe.metric.loss': 'Packet Loss',
        'probe.samples': '{samples} / {total} successful',
        'probe.dns_title': 'DNS AAAA Lookup',
        'probe.dns_subtitle': 'Domain Name Resolution Time',
        'probe.tcp_title': 'TCP Handshake Latency',
        'probe.tcp_subtitle': 'TCP Connection Round-Trip Time',
        'probe.icmp_title': 'ICMPv6 Latency',
        'probe.icmp_subtitle': 'ICMP Echo Round-Trip Time',
        'probe.path_title': 'Path Latency',
        'probe.path_desc': 'Traces the round-trip time through each router hop. More hops means more routers the packet passes through, increasing latency. &lt;15 hops is normal, &gt;30 hops may indicate routing issues.',
        'probe.hops': '{hops} hops',
        'probe.first_hop': 'First Hop',
        'probe.last_hop': 'Last Hop',

        /* - Button labels () --- */
        'btn.detect': 'Start Detection',
        'btn.detecting': 'Detecting...',
        'btn.start_diagnosis': 'Start Diagnosis',
        'btn.diagnosing': 'Diagnosing...',
        'btn.diagnosis_complete': 'Diagnosis complete',
        'btn.diagnosis_failed': 'Diagnosis failed',

        /* - Summary labels () --- */
        'summary.score': 'Overall Score',
        'summary.avg_latency': 'Average Latency',
        'summary.packet_loss': 'Packet Loss',
        'summary.dns': 'DNS Resolution',
        'summary.result': 'Detection Result',
        'summary.ipv6_address': 'IPv6 Address',
        'summary.no_address': '(No address)',
        'summary.priority_title': 'Access Priority',
        'summary.priority_ipv6': 'IPv6 Priority',
        'summary.priority_ipv4': 'IPv4 Priority',
        'summary.summary': 'Summary',
        'latency.unknown_error': 'Unknown error',
        'latency.no_data': 'No diagnosis data',
        'probe.hops_label': '{hops} hops',
        'probe.first_hop_label': 'First Hop Latency',
        'probe.last_hop_label': 'Last Hop Latency',
        'probe.success_label': 'Success',
        'probe.fail_label': 'Failed',
        'time.unknown': 'Unknown time',
        /* - Accessibility: button aria-labels (switch with language) --- */
        'aria.language': 'Switch language',
        'aria.theme': 'Toggle dark or light theme',
        'aria.minimize': 'Minimize window',
        'aria.close': 'Close window',
        'aria.close_panel': 'Close dialog',
        'aria.start_detect': 'Start IPv6 connection detection',
        'aria.pro_test': 'Visit pro test site',
        'aria.retry_detect': 'Re-detect',
        'aria.visit_pro': 'Visit pro test site',
        'aria.watch_tutorial': 'Watch Bilibili tutorial',
        'aria.back': 'Go back',
        'aria.back_home': 'Back to home',
        'aria.continue': 'Continue',
        'aria.continue_risk': 'Continue anyway',
        'aria.quick_repair': 'Quick network repair',
        'aria.deep_repair': 'Deep network repair',
        'aria.generate_addr': 'Generate connection address',
        'aria.copy_result': 'Copy connection address',
        'aria.diagnose_latency': 'Network performance diagnosis',
        'aria.clear_all': 'Clear all history',
        'aria.disagree': 'Decline and exit',
        'aria.agree': 'Agree to terms',
        'aria.cancel': 'Cancel',
        'aria.confirm': 'Confirm',
        'aria.open_history': 'View history',
        'aria.open_disclaimer': 'View disclaimer',
        'aria.retry': 'Retry',
        'aria.delete_record': 'Delete this record',
        'aria.debug_toggle': 'Toggle debug log',
    }
};

/* * * Translate a key with optional parameter substitution. * @param {string} key * @param {object} [params] e.g. {priority: 'IPv6 优先'} * @returns {string} */
/* 自包含 HTML 转义，供 t() 占位符值使用（避免依赖 app.js 的全局 escapeHtml， 同时对所有经 i18n 模板注入的外部数据做防御性转义，杜绝 XSS 注入） */
function escapeI18nValue(s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function t(key, params) {
    let text = (I18N[currentLanguage] && I18N[currentLanguage][key]) || I18N.zh[key] || key;
    if (params) {
        Object.keys(params).forEach(function(k) {
            /* P5 修复：占位符值一律视为外部数据并转义，模板自身的 HTML 不受影响 */
            text = text.replace('{' + k + '}', escapeI18nValue(params[k]));
        });
    }
    return text;
}

/* * Set language and persist preference. @param {string} lang 'zh' | 'en' */
function setLanguage(lang) {
    if (lang !== 'zh' && lang !== 'en') return;
    currentLanguage = lang;
    try { localStorage.setItem('ipv6_lang', lang); } catch (e) {}
    applyTranslations();
}

/* * Get saved language, default 'zh'. */
function getLanguage() {
    try {
        const saved = localStorage.getItem('ipv6_lang');
        if (saved === 'zh' || saved === 'en') return saved;
    } catch (e) {}
    return 'zh';
}

/* * * Apply translations to all [data-i18n] / [data-i18n-placeholder] elements, * update language/theme buttons, then dispatch 'languagechange' for app.js * to refresh dynamically-rendered text. */
function applyTranslations() {
    /* Static HTML text nodes */
    const elements = document.querySelectorAll('[data-i18n]');
    for (var i = 0; i < elements.length; i++) {
        const key = elements[i].getAttribute('data-i18n');
        let text = t(key).replace(/\{version\}/g, APP_VERSION);
        if (text !== key) {
            if (text.indexOf('<') >= 0) elements[i].innerHTML = text;
            else elements[i].textContent = text;
        }
    }
    /* Placeholder text */
    const placeholders = document.querySelectorAll('[data-i18n-placeholder]');
    for (var j = 0; j < placeholders.length; j++) {
        const pKey = placeholders[j].getAttribute('data-i18n-placeholder');
        const pText = t(pKey).replace(/\{version\}/g, APP_VERSION);
        if (pText !== pKey) placeholders[j].setAttribute('placeholder', pText);
    }
    /* P2: 动态 aria-label，随语言切换（避免静态 aria-label 与可见文字脱节） */
    const ariaEls = document.querySelectorAll('[data-i18n-aria]');
    for (var a = 0; a < ariaEls.length; a++) {
        const aKey = ariaEls[a].getAttribute('data-i18n-aria');
        const aText = t(aKey).replace(/\{version\}/g, APP_VERSION);
        if (aText !== aKey) ariaEls[a].setAttribute('aria-label', aText);
    }
    /* html lang attribute */
    document.documentElement.lang = (currentLanguage === 'zh') ? 'zh-CN' : 'en';
    /* Language button shows the language it will switch TO */
    let langBtn = document.getElementById('btn-language');
    if (langBtn) {
        const langSpan = langBtn.querySelector('.liquidGlass-text');
        if (langSpan) langSpan.textContent = (currentLanguage === 'zh') ? 'EN' : '中';
    }
    /* Theme button shows the icon for the action (current light -> moon) */
    let themeBtn = document.getElementById('btn-theme');
    if (themeBtn) {
        const themeSpan = themeBtn.querySelector('.liquidGlass-text');
        if (themeSpan) {
            const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
            themeSpan.textContent = isDark ? '☀️' : '🌙';
        }
    }
    /* Let app.js refresh any dynamic text it rendered */
    window.dispatchEvent(new CustomEvent('languagechange', { detail: { lang: currentLanguage } }));
}
