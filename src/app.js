/* 调试日志系统 */
const debugLogEnabled = true;
const debugLogContent = document.getElementById('debug-log-content');
const debugLogContainer = document.getElementById('debug-log-container');

function debugLog(msg, level) {
    if (!debugLogEnabled) return;
    const timestamp = new Date().toLocaleTimeString();
    const prefix = '[' + timestamp + ']';
    let logMsg = prefix + ' ' + escapeHtml(msg);

    if (level === 'ERROR') {
        logMsg = logMsg.replace(/(.+)/, '<span style="color: #ff5555;">$1</span>');
    } else if (level === 'WARN') {
        logMsg = logMsg.replace(/(.+)/, '<span style="color: #ffaa00;">$1</span>');
    } else {
        logMsg = logMsg.replace(/(.+)/, '<span style="color: #55ff55;">$1</span>');
    }

    if (debugLogContent) {
        debugLogContent.innerHTML += logMsg + '<br/>';
        debugLogContent.scrollTop = debugLogContent.scrollHeight;
    }
    console.log(msg);
}

function toggleDebugLog() {
    if (debugLogContainer) {
        debugLogContainer.style.display = debugLogContainer.style.display === 'none' ? 'block' : 'none';
    }
}

//全局变量封装到命名空间 window.__APP__，避免污染全局作用域
//注意：使用 Object.assign 保留 fx-particles.js 预设置的 .FX 等属性
//将所有可变状态（锁、配置、动画状态）移入命名空间，进一步减少全局污染
window.__APP__ = Object.assign(window.__APP__ || {}, {
    /* 应用状态 */
    particlesEngine: null,
    currentPage: 0,
    detectedAddresses: [],
    particleTheme: 'green',

    /* 动画状态 */
    pendingTransition: null,
    pendingHideTimer: null,
    progressAnimState: {
        current: 0,
        target: 0,
        startTime: 0,
        startVal: 0,
        targetVal: 0,
        rafId: null,
        duration: 320
    },

    /* 锁状态：避免并发触发同一操作 */
    isDetecting: false,
    isGeneratingAddress: false,
    isQuickRepairRunning: false,
    isDeepRepairRunning: false,
    isTracertRunning: false,

    /* 应用配置（历史记录、首次启动状态等） */
    appConfig: {
        first_run_accepted: false,
        records: []
    },

    /* 当前正在查看的历史详情索引，-1 表示未打开 */
    currentDetailRecordIndex: -1,

    /* 命名常量 */
    FADE_OUT_DURATION: 300,
    FADE_IN_DURATION: 500,
    PROGRESS_TWEEN_DURATION: 320,
    DETECT_START_DELAY: 50,
    INTRA_STEP_INTERVAL: 70,
    INTRA_STEP_SUB_DURATION: 250,
    REPAIR_STEP_INTERVAL: 280,
    PROTOCOL_STACK_DELAY: 600,
    CLIPBOARD_TIMEOUT: 3000,
    REPAIR_QUICK_TIMEOUT: 60000,
    REPAIR_DEEP_TIMEOUT: 120000
});

/* 向后兼容——其余代码仍以裸变量引用这些常量， 若只放到 window.__APP__ 会引发 ReferenceError 导致 init() 无法执行， 所有按钮绑定失败（P0 阻断性故障） */
const FADE_OUT_DURATION = window.__APP__.FADE_OUT_DURATION;
const FADE_IN_DURATION = window.__APP__.FADE_IN_DURATION;
const PROGRESS_TWEEN_DURATION = window.__APP__.PROGRESS_TWEEN_DURATION;
const DETECT_START_DELAY = window.__APP__.DETECT_START_DELAY;
const INTRA_STEP_INTERVAL = window.__APP__.INTRA_STEP_INTERVAL;
const INTRA_STEP_SUB_DURATION = window.__APP__.INTRA_STEP_SUB_DURATION;
const REPAIR_STEP_INTERVAL = window.__APP__.REPAIR_STEP_INTERVAL;
const PROTOCOL_STACK_DELAY = window.__APP__.PROTOCOL_STACK_DELAY;
const CLIPBOARD_TIMEOUT = window.__APP__.CLIPBOARD_TIMEOUT;
const REPAIR_QUICK_TIMEOUT = window.__APP__.REPAIR_QUICK_TIMEOUT;
const REPAIR_DEEP_TIMEOUT = window.__APP__.REPAIR_DEEP_TIMEOUT;

//Safe Tauri API accessor
const Tauri = {
    get invoke() {
        try {
            return window.__TAURI__.core.invoke;
        } catch (e) {
            return null;
        }
    },
    get window() {
        try {
            return window.__TAURI__.window.getCurrentWindow();
        } catch (e) {
            return null;
        }
    },
    get available() {
        try {
            return !!(window.__TAURI__ && window.__TAURI__.core && window.__TAURI__.core.invoke);
        } catch (e) {
            return false;
        }
    }
};

function safeInvoke(cmd, args) {
    if (!Tauri.available) {
        return Promise.reject(new Error('Tauri API not available'));
    }
    /* 移除无效的 try/catch：invoke 总是返回 Promise， 同步异常不太可能，依赖调用方的 .catch() 处理拒绝 */
    return Tauri.invoke(cmd, args || {});
}

/* 获取 CSS 变量实际值 浏览器不会把 'var(--xxx)' 作为合法颜色值解析传给 style.borderColor， 必须通过 getComputedStyle 拿到实际颜色字符串才能用。 */
function cssVar(name) {
    try {
        return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    } catch (e) {
        return '';
    }
}

/* 深度修复：pendingHideTimer 原本是隐式全局变量（未用 var 声明）， 在严格模式或某些 WebView2 环境下会抛 ReferenceError 导致 switchPage 中断， 进而让按钮的 switchPage 调用静默失败，表现为"点按钮无响应"。 */

function switchPage(targetPage, skipAnimation) {
    debugLog('[switchPage] targetPage=' + targetPage + ' skipAnimation=' + skipAnimation, 'INFO');
    const pages = document.querySelectorAll('.page');
    const target = pages[targetPage];
    if (!target) {
        debugLog('[switchPage] ERROR: target page not found! ' + targetPage, 'ERROR');
        return;
    }
    if (targetPage === window.__APP__.currentPage) {
        /* 同一页面：不重复切换，但仍要执行 requestAnimationFrame 内的副作用 */
        requestAnimationFrame(function() {
            runPageSwitchSideEffects(targetPage);
        });
        return;
    }

    const current = pages[window.__APP__.currentPage];

    /* 取消任何待处理的转换，避免快速切换造成动画错乱。 原 pageTransitioning 锁会阻止 650ms 内所有切换，导致用户感觉"无响应"。 现在改为：每次切换都立即停止旧动画，启动新动画（用户可随时切换）。 同时清理 pendingHideTimer，避免旧定时器关闭错误页面 */
    if (window.__APP__.pendingTransition) {
        clearTimeout(window.__APP__.pendingTransition);
        window.__APP__.pendingTransition = null;
    }
    if (window.__APP__.pendingHideTimer) {
        clearTimeout(window.__APP__.pendingHideTimer);
        window.__APP__.pendingHideTimer = null;
    }

    /* 立即停止当前页面的过渡 */
    current.classList.remove('active', 'fade-in', 'fade-out');
    if (current.style.display !== 'none') {
        current.classList.add('fade-out');
    }

    /* 隐藏所有非目标页面（current 留给 setTimeout 淡出后再隐藏） */
    for (let i = 0; i < pages.length; i++) {
        if (pages[i] === current || pages[i] === target) continue;
        pages[i].classList.remove('active', 'fade-in', 'fade-out');
        pages[i].style.display = 'none';
    }

    /* 显示目标页面 */
    /* 清理可能残留的 fade-out，避免与新的 fade-in 冲突导致动画错乱 */
    target.classList.remove('fade-out');
    target.style.display = 'flex';
    target.classList.add('active');

    /* 延时隐藏 current，让 fade-out 动画播放完毕（） 延时与 CSS fade-out 0.3s 对齐 定时器 ID 保存到 pendingHideTimer，便于取消 */
    if (current !== target) {
        window.__APP__.pendingHideTimer = setTimeout(function() {
            current.classList.remove('active', 'fade-out');
            current.style.display = 'none';
            window.__APP__.pendingHideTimer = null;
        }, window.__APP__.FADE_OUT_DURATION);
    }

    if (!skipAnimation) {
        target.classList.add('fade-in');
        /* 延时与 CSS fade-in 0.5s 对齐 */
        window.__APP__.pendingTransition = setTimeout(function() {
            target.classList.remove('fade-out', 'fade-in');
            window.__APP__.pendingTransition = null;
        }, window.__APP__.FADE_IN_DURATION);
    } else {
        target.classList.remove('fade-out', 'fade-in');
    }

    /* 离开诊断页面（页面5）时清除所有内容，回到初始状态 */
    if (window.__APP__.currentPage === 5 && targetPage !== 5) {
        resetLatencyPageUI();
    }

    window.__APP__.currentPage = targetPage;

    /* 切换页面后重新绑定该页面的按钮 */
    rebindPageButtons(targetPage);
    debugLog('[switchPage] rebindPageButtons done', 'INFO');

    /* 页面切换后重启打字机效果（#09） */
    triggerTypewriterOnTarget(target);

    requestAnimationFrame(function() {
        runPageSwitchSideEffects(targetPage);
    });
}

/* 页面切换时重启打字机效果（#09）—— 找到目标页面中的 .ef-09 元素，重启宽度动画 */
function triggerTypewriterOnTarget(page) {
    const elements = page.querySelectorAll('.ef-09');
    for (let i = 0; i < elements.length; i++) {
        let el = elements[i];
        /* 获取文本真实长度 */
        const text = el.textContent || '';
        const len = Math.max(text.length, 4);

        /* 重启动画：先移除动画，强制回流，再重新添加 */
        el.style.animation = 'none';
        el.style.width = '0';
        void el.offsetWidth; /* 强制回流 */

        /* 动态设置动画时长和步数，适配不同长度文本 */
        const duration = 1.5 + len * 0.08;  //每个字符 80ms
        el.style.animation = 'ef09a ' + duration + 's steps(' + len + ') forwards, ef09b .65s step-end infinite';
    }
}

/* 页面切换副作用：放在 switchPage 之外以便多次调用 */
function runPageSwitchSideEffects(targetPage) {
    if (targetPage === 2) {
        try { updateGenerateButtonState(); } catch (e) { console.warn('[app]', e); }
    }

    /* 进入检测页时重置操作按钮 */
    if (targetPage === 1) {
        const detectActions = document.getElementById('detect-actions');
        const failActions = document.getElementById('detect-fail-actions');
        let statusText = document.getElementById('detect-status-text');
        const guideBox = document.getElementById('detect-guide-box');
        if (detectActions) detectActions.style.display = 'none';
        if (failActions) failActions.style.display = 'none';
        if (statusText) statusText.style.display = 'none';
        /* 重置引导框状态 */
        if (guideBox) guideBox.style.display = 'none';
        const detectTitle = document.querySelector('.detect-title');
        if (detectTitle) detectTitle.textContent = t('detect.title.detecting');
        setContinueButtonState(true);
    }

    /* 进入网络性能诊断页（页面5）时强制重置 UI，确保首次进入只显示应显示的元素 */
    if (targetPage === 5) {
        resetLatencyPageUI();
    }

    let newTheme = 'green';
    if (targetPage === 4) newTheme = 'red';
    else if (targetPage === 5) newTheme = 'blue';

    if (newTheme !== window.__APP__.particleTheme) {
        updateParticleTheme(newTheme);
    }

    const floatingBtns = document.getElementById('floating-btns');
    if (floatingBtns) {
        floatingBtns.style.display = targetPage === 0 ? 'block' : 'none';
    }
}

/* 网络性能诊断页 UI 重置（进入/离开页面5时调用） 防御性：不依赖 HTML 内联 display 属性，强制隐藏结果区/分数条/摘要， 并清空输入框、复位起始按钮与评分环，确保首次进入只显示应显示的元素 */
function resetLatencyPageUI() {
    const probeResults = document.getElementById('probe-results');
    const latencyTargetInput = document.getElementById('latency-target');
    const probeSummary = document.getElementById('probe-summary');
    const probeScoreBox = document.getElementById('probe-score-box');
    const probeScoreNum = document.getElementById('probe-score-num');
    const probeScoreLabel = document.getElementById('probe-score-label');
    const probeScoreMeta = document.getElementById('probe-score-meta');
    const scoreRingFill = document.getElementById('score-ring-fill');
    const btnStartTracert = document.getElementById('btn-start-tracert');
    const latencyInputHint = document.getElementById('latency-input-hint');
    if (probeResults) probeResults.innerHTML = '';
    if (latencyTargetInput) latencyTargetInput.value = '';
    if (probeSummary) { probeSummary.style.display = 'none'; probeSummary.textContent = ''; probeSummary.style.color = ''; }
    if (probeScoreBox) probeScoreBox.style.display = 'none';
    if (probeScoreNum) probeScoreNum.textContent = '--';
    if (probeScoreLabel) { probeScoreLabel.textContent = '--'; probeScoreLabel.style.color = ''; }
    if (probeScoreMeta) probeScoreMeta.textContent = '';
    if (scoreRingFill) { scoreRingFill.style.stroke = ''; scoreRingFill.style.strokeDashoffset = ''; }
    if (btnStartTracert) btnStartTracert.disabled = true;
    if (latencyInputHint) latencyInputHint.classList.remove('hidden');
}

function updateParticleTheme(theme) {
    if (window.__APP__.particleTheme === theme || !window.__APP__.particlesEngine) return;
    window.__APP__.particleTheme = theme;
    const colors = { green: { h1: 90, h2: 140 }, blue: { h1: 210, h2: 240 }, red: { h1: 0, h2: 20 } };
    const c = colors[theme] || colors.green;
    try {
        window.__APP__.particlesEngine.options.particles.color.value = 'hsl(' + c.h1 + ', 70%, 60%)';
        window.__APP__.particlesEngine.options.particles.color.animation = { h: { from: c.h1, to: c.h2, enable: true, speed: 20, sync: false } };
        window.__APP__.particlesEngine.refresh();
    } catch (e) { console.warn('[app]', e); }
}

function initParticles() {
    if (!window.tsParticles) return;
    window.tsParticles.load('particles-background', {
        fpsLimit: 60,
        particles: {
            number: { value: 64, density: { enable: true, area: 800 } },
            color: { value: 'hsl(90, 70%, 60%)', animation: { h: { from: 90, to: 140, enable: true, speed: 20, sync: false } } },
            shape: { type: 'circle' },
            opacity: { value: 0.15, random: true, anim: { enable: true, speed: 1, opacity_min: 0.05, sync: false } },
            size: { value: { min: 1, max: 4 }, random: true, anim: { enable: true, speed: 2, size_min: 0.5, sync: false } },
            links: { enable: true, distance: 150, color: 'hsl(90, 50%, 70%)', opacity: 0.08, width: 1 },
            move: { enable: true, speed: 0.5, direction: 'none', random: true, straight: false, outModes: 'bounce', attract: { enable: true, rotateX: 600, rotateY: 1200 } }
        },
        interactivity: { detectsOn: 'window', events: { onHover: { enable: false }, resize: true }, modes: { grab: { distance: 200, links: { opacity: 0.15 } } } },
        background: { color: 'transparent' }
    }).then(function(engine) {
        window.__APP__.particlesEngine = engine;
        debugLog('[initParticles] tsParticles initialized with onHover: false', 'INFO');
        //强制 canvas 不拦截点击（即使 tsParticles 动态修改）
        setTimeout(function() {
            const canvas = engine.canvas.element;
            if (canvas) {
                canvas.style.pointerEvents = 'none';
                debugLog('[initParticles] Force canvas pointer-events: none', 'INFO');
            }
        }, 100);
    }).catch(function() { debugLog('[initParticles] ERROR: tsParticles failed to load', 'ERROR'); });
}

function magnetEffect() {
    /* 一次性守卫，避免 init 多次调用时重复绑定 mousemove/mouseleave 监听器 */
    if (window._magnetBound) return;
    window._magnetBound = true;
    /* 仅处理鼠标跟随光晕，不再设置 inline transform — 让 CSS :hover/:active 正常生效 原代码每次 mousemove 都 querySelector('.btn-glow')，性能浪费。 预存到闭包中，避免重复 DOM 查询。 */
    const buttons = document.querySelectorAll('.magnet-btn');
    for (let i = 0; i < buttons.length; i++) {
        (function(btn) {
            /* 预存 glow 引用，避免每次 mousemove 都查 DOM */
            const glow = btn.querySelector('.btn-glow');
            if (!glow) return;
            btn.addEventListener('mousemove', function(e) {
                const rect = btn.getBoundingClientRect();
                glow.style.left = (e.clientX - rect.left) + 'px';
                glow.style.top = (e.clientY - rect.top) + 'px';
            });
            btn.addEventListener('mouseleave', function() {
                glow.style.left = '50%';
                glow.style.top = '50%';
            });
        })(buttons[i]);
    }
}

function burstParticles(x, y) {
    if (!window.__APP__.particlesEngine) return;
    try {
        const container = window.__APP__.particlesEngine.container;
        if (!container) return;
        for (let i = 0; i < 20; i++) {
            (function(delay) {
                setTimeout(function() {
                    try {
                        /* 直接使用像素坐标，不转百分比（tsParticles 2.x addParticle 接受像素坐标） */
                        container.addParticle({
                            x: x,
                            y: y,
                            opacity: 0.6,
                            size: 6,
                            color: window.__APP__.particleTheme === 'green' ? 'var(--color-accent)' : window.__APP__.particleTheme === 'blue' ? 'var(--color-blue)' : 'var(--color-red)'
                        });
                    } catch (e) { console.warn('[app]', e); }
                }, delay);
            })(i * 30);
        }
    } catch (e) { console.warn('[app]', e); }
}

function updateStep(index, status, message) {
    const items = document.querySelectorAll('.step-item');
    const item = items[index];
    if (!item) return;
    item.className = 'step-item';
    if (status === 'running') item.classList.add('active');
    else if (status === 'success') item.classList.add('done');
    else if (status === 'fail') item.classList.add('fail');
    else if (status === 'warn') item.classList.add('warn');
    const statusEl = item.querySelector('.step-status');
    if (statusEl) {
        let statusText = { running: t('step.running'), success: t('step.success'), fail: t('step.fail'), warn: t('step.warn') };
        statusEl.textContent = message || (statusText[status] || status);
    }
}

function resetSteps() {
    const items = document.querySelectorAll('.step-item');
    for (let i = 0; i < items.length; i++) {
        items[i].className = 'step-item';
        const statusEl = items[i].querySelector('.step-status');
        if (statusEl) statusEl.textContent = t('step.waiting');
    }
}

/* === 平滑进度曲线动画 === 原版用离散步进 (0% → 11% → 22% → ...)，跳跃感强。 现在用 RAF 平滑过渡：每次 setTarget 后用 rAF 在 ~300ms 内补间到目标值。 支持连续调用（自动从当前值过渡到最新目标，无需离散跳变） state 已移入 window.__APP__.progressAnimState */
function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }

function progressStep(now) {
    const state = window.__APP__.progressAnimState;
    if (state.startTime === 0) state.startTime = now;
    const elapsed = now - state.startTime;
    const t = Math.min(1, elapsed / state.duration);
    const eased = easeOutCubic(t);
    const v = state.startVal + (state.targetVal - state.startVal) * eased;
    state.current = v;
    /* 更新 8-bit loading 百分比 */
    const bitPercentEl = document.getElementById('detect-loading-percent');
    if (bitPercentEl) bitPercentEl.textContent = Math.round(v) + '%';
    if (t < 1) {
        state.rafId = requestAnimationFrame(progressStep);
    } else {
        /* 显式 cancelAnimationFrame 后置 null（虽然当前 callback 已执行，但保证清理彻底） */
        if (state.rafId) {
            cancelAnimationFrame(state.rafId);
            state.rafId = null;
        }
        state.startTime = 0;
    }
}

function updateProgress(percent) {
    /* 启动平滑过渡到目标百分比，相同目标值也支持 */
    const state = window.__APP__.progressAnimState;
    let target = Math.max(0, Math.min(100, percent));
    if (Math.abs(target - state.target) < 0.5 && state.rafId === null) {
        /* 已经是目标值，无需动画 */
        state.current = target;
        /* 更新 8-bit loading 百分比 */
        const bitPercentEl = document.getElementById('detect-loading-percent');
        if (bitPercentEl) bitPercentEl.textContent = Math.round(target) + '%';
        return;
    }
    /* RAF 已在跑时只更新 targetVal，不重置 startVal/startTime， 避免频繁重置导致动画从 0% 重新开始 */
    if (state.rafId !== null) {
        state.targetVal = target;
        state.target = target;
    } else {
        state.startVal = state.current;
        state.targetVal = target;
        state.target = target;
        state.startTime = 0;
        state.rafId = requestAnimationFrame(progressStep);
    }
}

/* 设置 8-bit loading 提示文字 */
function setLoadingMsg(msg) {
    const loadingMsg = document.getElementById('detect-loading-msg');
    if (loadingMsg) loadingMsg.textContent = msg || '';
}

function addMessage(msg) {
    /* addMessage 已废弃，仅保留为空实现以兼容旧调用方 */
}

/* isDetecting 已移入 window.__APP__.isDetecting */

/* 抽取"是否显示专业测试网站引导"判断逻辑（5 分钟内修复过算已修复） */
function shouldShowProTestGuide() {
    try {
        const cache = localStorage.getItem('ipv6_repair_cache');
        if (!cache) return false;
        const parsed = JSON.parse(cache);
        if (parsed && parsed.ts && (Date.now() - parsed.ts) < 5 * 60 * 1000) {
            return true;
        }
    } catch (e) { console.warn('[app]', e); }
    return false;
}

async function startDetection() {
    debugLog('[startDetection] FUNCTION CALLED!', 'INFO');
    if (window.__APP__.isDetecting) {
        debugLog('[startDetection] WARNING: ' + t('init.detecting'), 'WARN');
        return;
    }

    window.__APP__.isDetecting = true;
    debugLog('[startDetection] isDetecting set to true', 'INFO');

    /* 显示 8-bit loading + 百分比（移除多余提示文字） */
    const loadingWrap = document.getElementById('detect-loading-wrap');
    if (loadingWrap) loadingWrap.style.display = 'flex';

    try {
        resetSteps();
        updateProgress(0);

        addMessage(t('init.detecting'));

        switchPage(1);

        await new Promise(function(r) { requestAnimationFrame(function() { setTimeout(r, DETECT_START_DELAY); }); });

        addMessage(t('init.enumerating'));

        const result = await safeInvoke('detect_ipv6');

        await saveCurrentRecordToHistory(result);
        
        const totalSteps = result.steps.length || 9;
        const processedIndices = {};
        let lastIndex = -1;
        /* 平滑百分比：每步内从"当前%"连续推进到"下一步%"， 而不是离散跳变。让用户看到百分比在动，即使没到下一项 */
        let lastPercentTime = 0;
        let intraStepTimer = null;

        function startIntraStepProgress() {
            /* 在每一步内 80ms 间隔推进到 90% of 区间，提供"持续在跑"的视觉 */
            /* stepStartTime 移入闭包，确保 setInterval 回调能正确访问当前步骤起始时间 */
            const stepStartTime = Date.now();
            if (intraStepTimer) clearInterval(intraStepTimer);
            intraStepTimer = setInterval(function() {
                const t = Date.now();
                if (t - lastPercentTime < 70) return;
                lastPercentTime = t;
                const state = window.__APP__.progressAnimState;  /* 避免与循环变量 var s 冲突 */
                /* 在 [stepTarget*0.4, stepTarget*0.92] 之间浮动 */
                let base = (lastIndex + 1) / totalSteps * 100;
                if (lastIndex < 0) base = 0;
                const upper = (lastIndex + 1) / totalSteps * 100;
                const lower = lastIndex >= 0 ? (lastIndex + 0.4) / totalSteps * 100 : 0;
                /* 用 elapsed time 计算在 lower→upper 之间的位置 */
                const next = lastIndex + 1;
                if (next >= totalSteps) {
                    updateProgress(95);
                    return;
                }
                const stepSpan = upper - lower;
                /* 修复进度条在同一步内循环抖动的 bug。 原代码用 %250 导致 elapsedSinceStep 永远在 0-250ms 之间循环， 进度条会在 lower→lower+0.95*stepSpan 之间来回抖动。 现在改为线性增长并限制最大到 0.95，让进度条持续前进到该步 95% 位置。 */
                const elapsedSinceStep = t - stepStartTime;
                const subProgress = Math.min(elapsedSinceStep / 250, 1.0);
                let target = lower + stepSpan * (0.4 + 0.55 * subProgress);
                if (state.current < target - 0.5) {
                    updateProgress(target);
                }
            }, INTRA_STEP_INTERVAL);
        }
        function stopIntraStepProgress() {
            if (intraStepTimer) {
                clearInterval(intraStepTimer);
                intraStepTimer = null;
            }
        }

        for (let i = 0; i < result.steps.length; i++) {
            const step = result.steps[i];

            if (!processedIndices[step.index]) {
                processedIndices[step.index] = true;
                addMessage(step.message);
            }
            const newLastIndex = Math.max(lastIndex, step.index);
            if (newLastIndex > lastIndex) {
                /* 跨入新一步：先把百分比推到该步区间 */
                const stepStartPercent = (newLastIndex + 0.4) / totalSteps * 100;
                updateProgress(stepStartPercent);
                startIntraStepProgress();
            }
            lastIndex = newLastIndex;

            updateStep(step.index, step.status, step.message);
            /* running 状态停留 200ms 让用户看清在跑哪一步 */
            const waitMs = step.status === 'running' ? 200 : 80;
            await new Promise(function(r) { setTimeout(r, waitMs); });
        }
        stopIntraStepProgress();
        updateProgress(100);
        addMessage(t('detect.status.done_msg'));

        //隐藏 loading
        /* 隐藏 8-bit loading 包装 */
        if (loadingWrap) loadingWrap.style.display = 'none';
        const detectTitle = document.querySelector('.detect-title');
        /* 检测成功时在标题后括号标注 IPv4/IPv6 访问优先级 */
        const titleHTML = t('detect.status.done');
        if (result.success && result.ip_priority) {
            const priorityColor = result.ip_priority.includes('IPv6') ? 'var(--color-green-600)' : 'var(--color-red-600)';
            titleHTML += '<br><span style="font-size: 0.85em; color: ' + priorityColor + '; font-weight: 700;">(' + escapeHtml(result.ip_priority) + ')</span>';
        }
        if (detectTitle) detectTitle.innerHTML = titleHTML;

        window.__APP__.detectedAddresses = result.addresses;
        let statusText = document.getElementById('detect-status-text');
        if (window.__APP__.progressAnimState.rafId) {
            cancelAnimationFrame(window.__APP__.progressAnimState.rafId);
            window.__APP__.progressAnimState.rafId = null;
        }
        if (result.success) {
            const displayEl = document.getElementById('config-address-display');
            if (displayEl && result.addresses.length > 0) {
                const addr = result.addresses[0];
                displayEl.textContent = addr.address + (addr.is_temporary ? t('addr.temp') : '');
            }
            if (statusText) {
                /* 状态文字也带上优先级提示 */
                const priorityHint = result.ip_priority ? '（' + result.ip_priority + '）' : '';
                /* 修复：该 i18n 字符串包含 HTML 标签，必须用 innerHTML 渲染 */
                statusText.innerHTML = t('detect.status.all_success_priority', { priority: priorityHint });
                statusText.className = 'detect-status-text success';
                statusText.style.display = 'block';
            }
            const detectActions = document.getElementById('detect-actions');
            if (detectActions) detectActions.style.display = 'flex';
            const failActions = document.getElementById('detect-fail-actions');
            if (failActions) failActions.style.display = 'none';
            /* 成功 → 清除修复缓存；继续按钮绿色 */
            try { localStorage.removeItem('ipv6_repair_cache'); } catch (e) { console.warn('[app]', e); }
            setContinueButtonState(true);
        } else {
            if (statusText) {
                /* 修复：该 i18n 字符串包含 HTML 标签，必须用 innerHTML 渲染 */
                statusText.innerHTML = t('detect.status.partial');
                statusText.className = 'detect-status-text warn';
                statusText.style.display = 'block';
            }
            const detectActions = document.getElementById('detect-actions');
            if (detectActions) detectActions.style.display = 'none';
            const failActions = document.getElementById('detect-fail-actions');
            if (failActions) failActions.style.display = 'flex';
            /* 失败 → 继续按钮变红 + 文字改为"无视风险后继续" */
            setContinueButtonState(false);
            /* 仅在第二次检测（已修复过）后才显示"专业测试网站"区域 */
            const guideBox = document.getElementById('detect-guide-box');
            if (guideBox) {
                guideBox.style.display = shouldShowProTestGuide() ? 'block' : 'none';
            }
        }
    } catch (err) {
        let errMsg = (err && err.message) ? err.message : (typeof err === 'string' ? err : t('latency.unknown_error'));
        if (window.__APP__.progressAnimState.rafId) {
            cancelAnimationFrame(window.__APP__.progressAnimState.rafId);
            window.__APP__.progressAnimState.rafId = null;
        }
        stopIntraStepProgress();
        updateProgress(0);
        /* 隐藏 8-bit loading 包装（异常路径） */
        if (loadingWrap) loadingWrap.style.display = 'none';
        window.__APP__.detectedAddresses = [];
        addMessage(t('init.detect_error') + errMsg);
        /* catch 块意味着 detect_ipv6 整体失败（异常抛出）， 此时是全部步骤都失败，状态文字应改为"全部失败"而非"部分不成功"， 避免给用户错误的心理预期（部分失败仍可能能联机，全部失败则基本不能）。 但按钮仍走 fail-actions（修复+返回），保持 UI 一致。 */
        for (let i = 0; i < 9; i++) {
            const stepItems = document.querySelectorAll('.step-item');
            const stepItem = stepItems[i];
            /* 不覆盖已完成或警告的步骤 */
            if (stepItem && !stepItem.classList.contains('done') && !stepItem.classList.contains('warn')) {
                updateStep(i, 'fail', t('init.step_failed'));
            }
        }
        let statusText = document.getElementById('detect-status-text');
        if (statusText) {
            /* 修复：该 i18n 字符串包含 HTML 标签，必须用 innerHTML 渲染 */
            statusText.innerHTML = t('detect.status.failed');
            statusText.className = 'detect-status-text warn';
            statusText.style.display = 'block';
        }
        const detectActions = document.getElementById('detect-actions');
        if (detectActions) detectActions.style.display = 'none';
        const failActions = document.getElementById('detect-fail-actions');
        if (failActions) failActions.style.display = 'flex';
        /* catch 也算失败 → 红按钮 + 二次检测才显示专业网站 */
        setContinueButtonState(false);
        const guideBox = document.getElementById('detect-guide-box');
        if (guideBox) {
            guideBox.style.display = shouldShowProTestGuide() ? 'block' : 'none';
        }
    } finally {
        try { window.__APP__.isDetecting = false; } catch (e) { console.warn('[app]', e); }
    }
}

/* === 继续按钮状态切换 === */
function setContinueButtonState(isSuccess) {
    const btns = ['btn-detect-continue', 'btn-detect-continue2'];
    for (let i = 0; i < btns.length; i++) {
        const btn = document.getElementById(btns[i]);
        if (!btn) continue;
        const text = btn.querySelector('.liquidGlass-text');
        if (isSuccess) {
            /* 绿色 */
            btn.classList.remove('liquidGlass-red');
            btn.classList.add('liquidGlass-green');
            if (text) text.textContent = t('detect.btn.continue');
        } else {
            /* 红色 + 文字改"无视风险后继续" */
            btn.classList.remove('liquidGlass-green');
            btn.classList.add('liquidGlass-red');
            if (text) text.textContent = t('detect.btn.continue_risk');
        }
    }
}

/* isGeneratingAddress 已移入 window.__APP__.isGeneratingAddress */

async function generateAddress() {
    if (window.__APP__.isGeneratingAddress) {
        console.warn(t('gen.busy'));
        return;
    }
    /* 按钮禁用时不响应 Enter/keydown 触发 */
    const btnGenEarly = document.getElementById('btn-generate-addr');
    if (btnGenEarly && btnGenEarly.disabled) {
        return;
    }
    /* 提前置位，避免快速双击时两次都通过校验 */
    window.__APP__.isGeneratingAddress = true;

    try {
        const portInput = document.getElementById('config-port');
        const btnGen = document.getElementById('btn-generate-addr');
        const textNode = btnGen ? btnGen.querySelector('.liquidGlass-text') : null;

        /* 端口为空时直接拒绝（按钮已被禁用，此处兜底） */
        const raw = cleanPortInput(portInput.value);
        if (raw !== portInput.value) portInput.value = raw;
        const port = parseInt(raw, 10);
        if (!port || port < 1 || port > 65535) {
            if (textNode) {
                textNode.textContent = t('config.port.invalid');
                setTimeout(function() { textNode.textContent = t('config.btn.generate'); }, 1500);
            }
            /* 修复：早期 return 前必须重置标志，否则用户无法再次触发该函数 */
            window.__APP__.isGeneratingAddress = false;
            return;
        }

        if (window.__APP__.detectedAddresses.length === 0) {
            const displayEl = document.getElementById('result-address-display');
            if (displayEl) displayEl.textContent = t('config.addr.none');
            switchPage(3);
            /* 修复：早期 return 前必须重置标志，否则用户无法再次触发该函数 */
            window.__APP__.isGeneratingAddress = false;
            return;
        }

        const addr = window.__APP__.detectedAddresses[0].address;
        try {
            const formatted = await safeInvoke('format_ipv6_address', { addr: addr, port: port });
            const displayEl = document.getElementById('result-address-display');
            if (displayEl) displayEl.textContent = formatted;
            switchPage(3);
        } catch (err) {
            const formatted = '[' + addr + ']:' + port;
            const displayEl = document.getElementById('result-address-display');
            if (displayEl) displayEl.textContent = formatted;
            switchPage(3);
        } finally {
            window.__APP__.isGeneratingAddress = false;
        }
    } catch (e) {
        window.__APP__.isGeneratingAddress = false;
    }
}

/* === 端口号 → 生成连接地址按钮状态 === */
/* 抽取端口清洗函数，与 generateAddress 保持一致 */
function cleanPortInput(raw) {
    return String(raw || '').replace(/[^\d]/g, '').slice(0, 5);
}

function updateGenerateButtonState() {
    const portInput = document.getElementById('config-port');
    const btnGen = document.getElementById('btn-generate-addr');
    if (!portInput || !btnGen) return;
    const textNode = btnGen.querySelector('.liquidGlass-text');
    const raw = cleanPortInput(portInput.value);
    const port = parseInt(raw, 10);
    if (!port || port < 1 || port > 65535) {
        btnGen.classList.add('disabled');
        btnGen.setAttribute('disabled', 'disabled');
        if (textNode) textNode.textContent = t('config.port.hint_fill');
    } else {
        btnGen.classList.remove('disabled');
        btnGen.removeAttribute('disabled');
        if (textNode) textNode.textContent = t('config.btn.generate');
    }
}

/* copyResult — 委托给 clipboard.js 模块 */
function copyResult() {
    /* fx-particles.js 的捕获阶段 handler 已处理复制+爆发+RAF文本更新， 此处仅作为 FX 未加载时的降级路径 */
    if (window.__APP__ && window.__APP__.FX && window.__APP__.FX.copyToClipboard) return;

    /* 委托给 clipboard.js */
    const btn = document.getElementById('btn-copy-result');
    const textNode = btn ? btn.querySelector('.liquidGlass-text') : null;
    const origText = textNode ? textNode.textContent : t('copy.label');

    if (window.Clipboard && window.Clipboard.copyResult) {
        const textEl = document.getElementById('result-address-display');
        const text = textEl ? textEl.textContent : '';
        window.Clipboard.copyResult(text, origText, t('copy.ok'), t('copy.fail'), btn);
        burstParticles(window.innerWidth / 2, window.innerHeight / 2);
    }
}

function appendLog(container, message, type) {
    if (!type) type = 'info';
    let el = document.createElement('div');
    el.className = 'log-' + type;
    el.textContent = message;
    container.appendChild(el);
    container.scrollTop = container.scrollHeight;
}

/* === 修复模态弹窗辅助函数 === */
function openRepairModal(title, subtitle) {
    const overlay = document.getElementById('repair-modal-overlay');
    if (!overlay) return;
    const titleEl = document.getElementById('repair-modal-title');
    const subtitleEl = document.getElementById('repair-modal-subtitle');
    const stepsEl = document.getElementById('repair-modal-steps');
    const footerEl = document.getElementById('repair-modal-footer');
    if (titleEl) titleEl.textContent = title || t('modal.title.fix');
    if (subtitleEl) subtitleEl.textContent = subtitle || '';
    if (stepsEl) stepsEl.innerHTML = '';
    if (footerEl) footerEl.style.display = 'none';
    overlay.style.display = 'flex';
    overlay.classList.add('active');
    overlay.style.opacity = '0';
    /* 简单的淡入 */
    requestAnimationFrame(function() {
        overlay.style.transition = 'opacity 0.3s ease';
        overlay.style.opacity = '1';
    });
}

function closeRepairModal() {
    const overlay = document.getElementById('repair-modal-overlay');
    if (!overlay) return;
    overlay.classList.remove('active');
    overlay.style.opacity = '0';
    setTimeout(function() {
        overlay.style.display = 'none';
        overlay.style.transition = '';
    }, 280);
}

function updateRepairModalStep(index, status, message) {
    let el = document.querySelector('#repair-modal-steps [data-step-index="' + index + '"]');
    if (!el) return;
    el.setAttribute('data-status', status);
    const msgEl = el.querySelector('.repair-step-message');
    if (msgEl && message) msgEl.textContent = message;
}

function renderRepairModalSteps(steps) {
    const container = document.getElementById('repair-modal-steps');
    if (container) container.innerHTML = '';  /* 确保清空 */
    if (!container) return;
    for (let i = 0; i < steps.length; i++) {
        (function(step) {
            let el = document.createElement('div');
            el.className = 'repair-step-item';
            el.setAttribute('data-status', 'pending');
            el.setAttribute('data-step-index', step.index);
            el.innerHTML = '' +
                '<div class="repair-step-icon"><span class="repair-step-spinner"></span></div>' +
                '<div class="repair-step-body">' +
                    '<div class="repair-step-name">' + escapeHtml(step.name) + '</div>' +
                    '<div class="repair-step-message">' + escapeHtml(step.message) + '</div>' +
                '</div>';
            container.appendChild(el);
        })(steps[i]);
    }
}

function showRepairModalFooter(summary, success) {
    const footerEl = document.getElementById('repair-modal-footer');
    const summaryEl = document.getElementById('repair-modal-summary');
    if (!footerEl || !summaryEl) return;
    summaryEl.textContent = summary;
    summaryEl.className = 'repair-modal-summary ' + (success ? 'success' : 'warn');
    footerEl.style.display = 'block';
}

/* isQuickRepairRunning / isDeepRepairRunning 已移入 window.__APP__ */

async function runQuickRepair() {
    if (window.__APP__.isQuickRepairRunning) {
        console.warn(t('repair.busy'));
        return;
    }
    window.__APP__.isQuickRepairRunning = true;

    openRepairModal(t('modal.title.quick_repair'), t('modal.subtitle.quick_repair'));

    try {
        /* 60秒超时保护，避免后端 hang 住时用户无法关闭弹窗 */
        const timeoutPromise = new Promise(function(_, reject) {
            setTimeout(function() { reject(new Error(t('repair.timeout'))); }, REPAIR_QUICK_TIMEOUT);
        });
        const result = await Promise.race([safeInvoke('run_quick_repair'), timeoutPromise]);
        if (!result || !result.steps || result.steps.length === 0) {
            showRepairModalFooter(t('repair.unresponsive'), false);
            return;
        }

        /* 渲染所有步骤（pending 状态） */
        renderRepairModalSteps(result.steps);

        /* 逐步推进：先 running，等 280ms 后切到最终状态 */
        for (let s = 0; s < result.steps.length; s++) {
            const step = result.steps[s];
            updateRepairModalStep(step.index, 'running', step.message);
            await new Promise(function(r) { setTimeout(r, REPAIR_STEP_INTERVAL); });
            updateRepairModalStep(step.index, step.status, step.message);
        }

        /* 显示总结 + 重试/返回按钮 */
        showRepairModalFooter(result.summary, result.success);
        if (result.success) {
            try { localStorage.setItem('ipv6_repair_cache', JSON.stringify({ mode: 'quick', ts: Date.now() })); } catch (e) { console.warn('[app]', e); }
        }
        burstParticles(window.innerWidth / 2, window.innerHeight / 2);
    } catch (err) {
        let errMsg = (err && err.message) ? err.message : String(err);
        showRepairModalFooter(t('repair.failed') + errMsg + t('repair.check_admin'), false);
    } finally {
        window.__APP__.isQuickRepairRunning = false;
    }
}

async function runDeepRepair() {
    if (window.__APP__.isDeepRepairRunning) {
        console.warn(t('repair.busy'));
        return;
    }
    window.__APP__.isDeepRepairRunning = true;

    openRepairModal(t('modal.title.deep_repair'), t('modal.subtitle.deep_repair'));

    try {
        /* 120秒超时保护（深度修复更慢） */
        const timeoutPromise = new Promise(function(_, reject) {
            setTimeout(function() { reject(new Error(t('repair.timeout_deep'))); }, REPAIR_DEEP_TIMEOUT);
        });
        const result = await Promise.race([safeInvoke('run_deep_repair'), timeoutPromise]);
        if (!result || !result.steps || result.steps.length === 0) {
            showRepairModalFooter(t('repair.unresponsive'), false);
            window.__APP__.isDeepRepairRunning = false;
            return;
        }

        renderRepairModalSteps(result.steps);

        /* 深度修复步骤慢一些（重置协议栈需要时间） */
        for (let s = 0; s < result.steps.length; s++) {
            const step = result.steps[s];
            updateRepairModalStep(step.index, 'running', step.message);
            const waitMs = step.name.indexOf('协议栈') >= 0 || step.name.indexOf('Winsock') >= 0 ? 600 : 280;
            await new Promise(function(r) { setTimeout(r, waitMs); });
            updateRepairModalStep(step.index, step.status, step.message);
        }

        showRepairModalFooter(result.summary, result.success);
        if (result.success) {
            try { localStorage.setItem('ipv6_repair_cache', JSON.stringify({ mode: 'deep', ts: Date.now() })); } catch (e) { console.warn('[app]', e); }
        }
        burstParticles(window.innerWidth / 2, window.innerHeight / 2);
    } catch (err) {
        let errMsg = (err && err.message) ? err.message : String(err);
        showRepairModalFooter(t('repair.failed') + errMsg + t('repair.check_admin'), false);
    } finally {
        window.__APP__.isDeepRepairRunning = false;
    }
}

/* isTracertRunning 已移入 window.__APP__.isTracertRunning */

async function startTracert() {
    if (window.__APP__.isTracertRunning) {
        console.warn(t('tracert.busy'));
        return;
    }
    window.__APP__.isTracertRunning = true;

    const btn = document.getElementById('btn-start-tracert');
    const textNode = btn ? btn.querySelector('.liquidGlass-text') : null;
    const origText = textNode ? textNode.textContent : t('latency.btn.start');
    const summaryEl = document.getElementById('probe-summary');
    const resultsEl = document.getElementById('probe-results');
    let targetInput;
    try {
        const scoreBox = document.getElementById('probe-score-box');
        targetInput = document.getElementById('latency-target');
        let target = targetInput.value.trim();
        if (!target) {
            targetInput.style.borderColor = cssVar('--color-red') || 'var(--color-red)';
            setTimeout(function() { targetInput.style.borderColor = ''; }, 2000);
            window.__APP__.isTracertRunning = false;
            return;
        }
        if (target.length > 253) {
            if (textNode) textNode.textContent = t('latency.target.too_long');
            window.__APP__.isTracertRunning = false;
            return;
        }
        const portInput = document.getElementById('config-port');
        if (portInput) portInput.value = '';

        if (btn) { btn.disabled = true; btn.style.opacity = '0.6'; btn.style.pointerEvents = 'none'; }
        if (textNode) textNode.textContent = t('latency.diagnosing');
        if (summaryEl) summaryEl.style.display = 'none';
        if (scoreBox) scoreBox.style.display = 'none';
        if (resultsEl) resultsEl.innerHTML = '';

        const result = await safeInvoke('run_v6_probe', { target: target });

        if (summaryEl) {
            summaryEl.textContent = result.summary || t('latency.done');
            summaryEl.style.display = 'block';
            /* result.error 非空 → 红色失败提示 */
            if (result.error && result.error.length > 0) {
                summaryEl.textContent = t('latency.fail_prefix') + result.error;
                summaryEl.style.color = cssVar('--color-red') || 'var(--color-red)';
            } else {
                summaryEl.style.color = '';
            }
        }

        /* 渲染综合评分 */
        if (scoreBox && result.score != null && result.score > 0) {
            scoreBox.style.display = 'flex';
            const scoreNum = document.getElementById('probe-score-num');
            const scoreLabel = document.getElementById('probe-score-label');
            const scoreMeta = document.getElementById('probe-score-meta');
            const ringFill = document.getElementById('score-ring-fill');
            if (scoreNum) scoreNum.textContent = result.score;
            if (scoreLabel) {
                scoreLabel.textContent = result.score_label || '--';
                /* 颜色根据评分等级 */
                let color = 'var(--color-green-500)';
                if (result.score < 40) color = 'var(--color-red-500)';
                else if (result.score < 60) color = 'var(--color-orange-500)';
                else if (result.score < 75) color = 'var(--color-yellow-500)';
                else if (result.score < 90) color = 'var(--color-blue-500)';
                scoreLabel.style.color = color;
                if (ringFill) ringFill.style.stroke = color;
            }
            if (scoreMeta) {
                const metaParts = [];
                if (result.icmp_rtt && result.icmp_rtt.samples > 0) {
                    metaParts.push(t('score.meta_avg_latency', { value: safeFixed(result.icmp_rtt.mean, 1) }));
                    metaParts.push(t('score.meta_packet_loss', { value: safeFixed(result.icmp_rtt.loss_rate, 1) }));
                }
                scoreMeta.textContent = metaParts.join(' · ') || t('score.meta_no_data');
            }
            if (ringFill) {
                /* 环形进度：264 = 2 * PI * 42 */
                let offset = 264 - (264 * result.score / 100);
                ringFill.style.strokeDashoffset = offset;
            }
        }

        /* 综合评分已替代 summary 小框，隐藏原 summary 避免重复 */
        if (summaryEl) {
            summaryEl.style.display = 'none';
        }

        /* 诊断历史已由后端 run_v6_probe 自动保存（lib.rs record_probe_result_to_history）， 此处不再重复写入，避免同一诊断产生两条相同历史记录。 */

        /* 渲染垂直卡片 */
        let html = '';
        if (result.icmp_rtt && result.icmp_rtt.samples > 0) {
            html += renderProbeCard(
                t('probe.icmp_title'),
                t('probe.icmp_subtitle'),
                result.icmp_rtt
            );
        }
        if (result.tcp_handshake && result.tcp_handshake.samples > 0) {
            html += renderProbeCard(
                t('probe.tcp_title'),
                t('probe.tcp_subtitle'),
                result.tcp_handshake
            );
        }
        if (result.dns_latency != null) {
            html += renderDnsCard(result.dns_latency);
        }
        if (result.hop_count > 0) {
            html += renderPathCard(
                result.hop_count,
                result.first_hop,
                result.last_hop,
                result.path_latencies
            );
        }
        if (!html) {
            html = '<div class="probe-empty">' + t('probe.all_fail') + '</div>';
        }
        if (resultsEl) resultsEl.innerHTML = html;

    } catch (err) {
        /* Tauri reject 的错误是字符串，err.message 取不到值。 先判断字符串类型，再回退到 message，最后兜底"未知错误"。 */
        let errMsg = err;
        if (err && err.message) {
            errMsg = err.message;
        } else if (typeof err === 'string') {
            errMsg = err;
        } else {
            errMsg = t('latency.unknown_error') || 'Unknown error';
        }
        if (summaryEl) {
            summaryEl.textContent = t('latency.fail_prefix') + errMsg;
            summaryEl.style.display = 'block';
            /* 用 cssVar() 获取实际颜色 */
            summaryEl.style.color = cssVar('--color-red') || 'var(--color-red)';
        }
    } finally {
        if (btn) { btn.disabled = !(targetInput && targetInput.value.trim()); btn.style.opacity = ''; btn.style.pointerEvents = ''; }
        if (textNode) textNode.textContent = origText;
        window.__APP__.isTracertRunning = false;
    }
}

/* 渲染延迟指标卡片 (ICMP / TCP 共用) */
/* safeFixed 防御 null 字段 */
function safeFixed(val, digits) {
    if (val == null || isNaN(val)) return '0';
    return Number(val).toFixed(digits);
}

function renderProbeCard(title, subtitle, metric) {
    if (!metric || metric.min == null || metric.max == null) {
        return '<div class="probe-card-empty">' + t('probe.empty') + '</div>';
    }
    let quality = 'good';
    if (metric.mean > 200 || metric.loss_rate > 20) quality = 'bad';
    else if (metric.mean > 100 || metric.loss_rate > 5 || metric.jitter > 30) quality = 'warn';

    return '' +
    '<div class="probe-card glass-card probe-' + quality + '">' +
        '<div class="probe-card-header">' +
            '<div>' +
                '<div class="probe-card-title">' + title + '</div>' +
                '<div class="probe-card-subtitle">' + subtitle + '</div>' +
            '</div>' +
            '<div class="probe-quality probe-quality-' + quality + '">' +
                (quality === 'good' ? t('probe.quality.good') : quality === 'warn' ? t('probe.quality.warn') : t('probe.quality.bad')) +
            '</div>' +
        '</div>' +
        '<div class="probe-metrics-grid">' +
            renderMetricCell(t('probe.metric.min'), safeFixed(metric.min, 1) + ' ms') +
            renderMetricCell(t('probe.metric.max'), safeFixed(metric.max, 1) + ' ms') +
            renderMetricCell(t('probe.metric.mean'), safeFixed(metric.mean, 1) + ' ms') +
            renderMetricCell(t('probe.metric.p95'), safeFixed(metric.p95, 1) + ' ms') +
            renderMetricCell(t('probe.metric.jitter'), safeFixed(metric.jitter, 1) + ' ms') +
            renderMetricCell(t('probe.metric.loss'), safeFixed(metric.loss_rate, 1) + '%') +
        '</div>' +
        '<div class="probe-samples">' +
            t('probe.samples', { samples: metric.samples != null ? metric.samples : 0, total: metric.total != null ? metric.total : 0 }) +
        '</div>' +
    '</div>';
}

function renderMetricCell(label, value) {
    return '<div class="probe-metric-cell">' +
        '<div class="probe-metric-label">' + label + '</div>' +
        '<div class="probe-metric-value">' + value + '</div>' +
    '</div>';
}

function renderDnsCard(dnsMs) {
    let quality = dnsMs < 50 ? 'good' : dnsMs < 200 ? 'warn' : 'bad';
    return '' +
    '<div class="probe-card glass-card probe-' + quality + '">' +
        '<div class="probe-card-header">' +
            '<div>' +
                '<div class="probe-card-title">' + t('probe.dns_title') + '</div>' +
                '<div class="probe-card-subtitle">' + t('probe.dns_subtitle') + '</div>' +
            '</div>' +
            '<div class="probe-quality probe-quality-' + quality + '">' +
                (quality === 'good' ? t('probe.quality.fast') : quality === 'warn' ? t('probe.quality.warn') : t('probe.quality.slow')) +
            '</div>' +
        '</div>' +
        '<div class="probe-metrics-grid">' +
            renderMetricCell(t('probe.resolution'), safeFixed(dnsMs, 2) + ' ms') +
        '</div>' +
    '</div>';
}

function renderPathCard(hopCount, firstHop, lastHop, pathLatencies) {
    if (!Array.isArray(pathLatencies)) {
        return '<div class="probe-card-empty">' + t('probe.empty') + '</div>';
    }
    const pathStr = pathLatencies.map(function(l) { return safeFixed(l, 1); }).join(' → ');
    return '' +
    '<div class="probe-card glass-card probe-info">' +
        '<div class="probe-card-header">' +
            '<div>' +
                '<div class="probe-card-title">' + t('latency.path_title') + '</div>' +
                '<div class="probe-card-subtitle">' + t('latency.path_desc') + '</div>' +
            '</div>' +
            '<div class="probe-quality probe-quality-info">' + t('probe.hops', { hops: hopCount != null ? hopCount : 0 }) + '</div>' +
        '</div>' +
        '<div class="probe-metrics-grid">' +
            (firstHop != null ? renderMetricCell(t('path.first_hop'), safeFixed(firstHop, 1) + ' ms') : '') +
            (lastHop != null ? renderMetricCell(t('path.last_hop'), safeFixed(lastHop, 1) + ' ms') : '') +
        '</div>' +
        (pathStr ? '<div class="probe-path-line">' + pathStr + ' ms</div>' : '') +
    '</div>';
}

/* === 语言 / 主题 偏好（增量功能，不影响导航与现有逻辑） === */
function getTheme() {
    try {
        const s = localStorage.getItem('ipv6_theme');
        if (s === 'dark' || s === 'light') return s;
    } catch (e) { console.warn('[app]', e); }
    return 'light';
}

function applyTheme() {
    const theme = getTheme();
    document.documentElement.setAttribute('data-theme', theme);
    const themeBtn = document.getElementById('btn-theme');
    if (themeBtn) { var ts = themeBtn.querySelector('.liquidGlass-text'); if (ts) ts.textContent = (theme === 'dark') ? '☀️' : '🌙'; }
}

function toggleTheme() {
    const cur = document.documentElement.getAttribute('data-theme');
    const next = (cur === 'dark') ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    try { localStorage.setItem('ipv6_theme', next); } catch (e) { console.warn('[app]', e); }
    const themeBtn = document.getElementById('btn-theme');
    if (themeBtn) { var ts = themeBtn.querySelector('.liquidGlass-text'); if (ts) ts.textContent = (next === 'dark') ? '☀️' : '🌙'; }
}

function initI18nAndTheme() {
    /* currentLanguage / setLanguage / getLanguage / applyTranslations 来自 app-i18n.js */
    currentLanguage = getLanguage();
    applyTheme();
    applyTranslations();
    /* 语言切换后，刷新由 JS 动态渲染的文本（如步骤状态） */
    window.addEventListener('languagechange', function() {
        try { resetSteps(); } catch (e) { console.warn('[app]', e); }
    });
}

function initTitleBar() {
    const closeBtn = document.getElementById('btn-close');
    const minBtn = document.getElementById('btn-minimize');

    window._closeApp = function() {
        safeInvoke('close_window')
            .then(function() { console.log('[titlebar] close via invoke ok'); })
            .catch(function(err) {
                console.warn('[titlebar] close via invoke failed:', err);
                if (window.__TAURI__ && window.__TAURI__.window) {
                    try { window.__TAURI__.window.getCurrentWindow().close(); } catch (e) { console.warn('[app]', e); }
                } else {
                    window.close();
                }
            });
    };

    window._minimizeApp = function() {
        safeInvoke('minimize_window')
            .then(function() { console.log('[titlebar] minimize via invoke ok'); })
            .catch(function(err) {
                console.warn('[titlebar] minimize via invoke failed:', err);
                if (window.__TAURI__ && window.__TAURI__.window) {
                    try { window.__TAURI__.window.getCurrentWindow().minimize(); } catch (e) { console.warn('[app]', e); }
                }
            });
    };

    if (closeBtn) closeBtn.addEventListener('click', window._closeApp);
    if (minBtn) minBtn.addEventListener('click', window._minimizeApp);

    /* 语言 / 主题切换按钮（增量功能，不影响现有导航） */
    const langBtn = document.getElementById('btn-language');
    if (langBtn) langBtn.addEventListener('click', function() {
        setLanguage(currentLanguage === 'zh' ? 'en' : 'zh');
    });
    const themeBtn = document.getElementById('btn-theme');
    if (themeBtn) themeBtn.addEventListener('click', toggleTheme);

    console.log('[titlebar] initialized. Tauri available:', Tauri.available);
}

/* 全局按钮绑定助手：避免重复绑定（） 将 bindBtn 从 init() 内部移到外部，使页面切换后也能重新绑定新页面的按钮 */
function bindBtn(id, handler) {
    const btn = document.getElementById(id);
    debugLog('[bindBtn] ' + id + ' found: ' + !!btn + ' already bound: ' + (btn && btn.dataset.bound), 'INFO');
    if (!btn) {
        debugLog('[bindBtn] ERROR: button not found! ' + id, 'ERROR');
        return;
    }
    if (btn.dataset.bound) {
        debugLog('[bindBtn] WARNING: button already bound! ' + id, 'WARN');
        return;
    }
    btn.dataset.bound = '1';
    btn.addEventListener('click', handler);
    debugLog('[bindBtn] ' + id + ' bound successfully', 'INFO');
    //测试：绑定后立即测试点击
    debugLog('[bindBtn] Testing click on ' + id, 'INFO');
    debugLog('[bindBtn] btn element: ' + btn.toString(), 'INFO');
    debugLog('[bindBtn] btn.tagName: ' + btn.tagName, 'INFO');
    debugLog('[bindBtn] btn.className: ' + btn.className, 'INFO');
    debugLog('[bindBtn] btn.style.pointerEvents: ' + btn.style.pointerEvents, 'INFO');
    debugLog('[bindBtn] btn.style.opacity: ' + btn.style.opacity, 'INFO');
}

/* 绑定返回按钮 */
function bindBackButtons() {
    const backButtons = document.querySelectorAll('.page-header-back[data-page]');
    debugLog('[bindBackButtons] ' + backButtons.length + ' back buttons found', 'INFO');
    for (let i = 0; i < backButtons.length; i++) {
        (function(btn) {
            if (btn.dataset.backBound === '1') {
                debugLog('[bindBackButtons] ' + btn.id + ' already bound', 'WARN');
                return;
            }
            btn.dataset.backBound = '1';
            btn.addEventListener('click', function(e) {
                debugLog('[btn-back] CLICKED! ' + btn.id + ' data-page: ' + btn.dataset.page, 'INFO');
                e.preventDefault();
                const page = parseInt(btn.dataset.page);
                if (!isNaN(page)) switchPage(page);
            });
            debugLog('[bindBackButtons] ' + btn.id + ' bound successfully', 'INFO');
        })(backButtons[i]);
    }
}

/* 切换页面后重新绑定该页面的按钮 */
function rebindPageButtons(pageIndex) {
    /* 根据页面索引重新绑定该页面特有的按钮 */
    switch(pageIndex) {
        case 1: /* 检测页 */
            bindBtn('btn-detect-continue', function() { switchPage(2); });
            bindBtn('btn-detect-continue2', function() { switchPage(4); });
            bindBtn('btn-detect-back', function() { switchPage(0); });
            bindBtn('btn-detect-back2', function() { switchPage(0); });
            bindBtn('btn-detect-quick-repair', runQuickRepair);
            bindBtn('btn-detect-deep-repair', runDeepRepair);
            break;

        case 2: /* 生成地址页 */
            /* 这个页面按钮在 init() 中已绑定 */
            break;

        case 3: /* 故障页 */
            bindBtn('btn-fault-retry', function() { startDetection(); });
            bindBtn('btn-fault-pro', function() {
                const url = 'https://17nas.com/ipv6-test.php';
                if (currentLanguage === 'en') url += '?lang=en-US';
                safeInvoke('open_url', { url: url })
                    .catch(function() {
                        window.open(url, '_blank');
                    });
            });
            break;

        case 4: /* 结果页 */
            /* 这个页面按钮在 init() 中已绑定 */
            break;

        case 5: /* 延迟诊断页 */
            /* 这个页面按钮在 init() 中已绑定 */
            break;
    }
}

/* 绑定主页按钮 */
function bindHomeButtons() {
    bindBtn('btn-start-detect', startDetection);
    bindBtn('btn-generate-addr', generateAddress);

    /* 端口号输入实时过滤：只允许数字，最多 5 位（合并：同时处理 Enter 触发） */
    const portInput = document.getElementById('config-port');
    if (portInput && !portInput.dataset.bound) {
        portInput.dataset.bound = '1';
        portInput.addEventListener('input', function() {
            const cleaned = cleanPortInput(portInput.value);
            if (cleaned !== portInput.value) portInput.value = cleaned;
            /* 实时联动生成按钮状态 */
            updateGenerateButtonState();
        });
        portInput.addEventListener('keydown', function(e) {
            if (e.key === 'Enter') {
                generateAddress();
            } else if (e.key && !/^\d$/.test(e.key) &&
                e.key !== 'Backspace' && e.key !== 'Delete' &&
                e.key !== 'Tab' && e.key !== 'ArrowLeft' && e.key !== 'ArrowRight' &&
                e.key !== 'Home' && e.key !== 'End') {
                /* 允许 Ctrl/Cmd 组合键（复制/粘贴/全选），避免阻塞用户正常编辑 */
                if (e.ctrlKey || e.metaKey) return;
                e.preventDefault();
            }
        });
        /* 初始校验（默认值 25565 应通过） */
        updateGenerateButtonState();
    }

    /* 复制按钮的复制与爆发动画统一由 fx-particles.js bindCopyButton 处理， 此处不再重复绑定，避免一次点击触发两次复制与多次粒子爆发。 */

    bindBtn('btn-result-latency', function() { switchPage(5); });
    bindBtn('btn-quick-repair', runQuickRepair);
    bindBtn('btn-deep-repair', runDeepRepair);
    bindBtn('btn-start-tracert', startTracert);

    /* 延迟输入框联动 — 空输入时禁用按钮并显示提示 */
    const latencyTarget = document.getElementById('latency-target');
    if (latencyTarget && !latencyTarget.dataset.bound) {
        latencyTarget.dataset.bound = '1';
        latencyTarget.addEventListener('input', function() {
            const btn = document.getElementById('btn-start-tracert');
            const hint = document.getElementById('latency-input-hint');
            const hasValue = this.value.trim().length > 0;
            if (btn) {
                /* 按钮始终可用，空地址时显示提示文字 */
                const textNode = btn.querySelector('.liquidGlass-text');
                if (textNode) {
                    textNode.textContent = hasValue ? t('latency.btn.start') : t('latency.btn.hint_empty');
                }
            }
            if (hint) {
                if (hasValue) hint.classList.add('hidden');
                else hint.classList.remove('hidden');
            }
            /* 输入清空时隐藏诊断结果，重置为初始状态 */
            if (!hasValue) {
                const scoreBox = document.getElementById('probe-score-box');
                const summaryEl = document.getElementById('probe-summary');
                const resultsEl = document.getElementById('probe-results');
                if (scoreBox) scoreBox.style.display = 'none';
                if (summaryEl) { summaryEl.style.display = 'none'; summaryEl.textContent = ''; }
                if (resultsEl) resultsEl.innerHTML = '';
            }
        });
        latencyTarget.addEventListener('keydown', function(e) {
            if (e.key === 'Enter') startTracert();
        });
    }

    /* 专业测试网站入口 */
    bindBtn('btn-pro-test', function() {
        const url = 'https://17nas.com/ipv6-test.php';
        if (currentLanguage === 'en') url += '?lang=en-US';
        safeInvoke('open_url', { url: url })
            .catch(function() {
                window.open(url, '_blank');
            });
    });

    /* B站UP主卡片入口 */
    bindBtn('developer-card', function() {
        safeInvoke('open_url', { url: 'https://space.bilibili.com/401121508' })
            .catch(function() {
                window.open('https://space.bilibili.com/401121508', '_blank');
            });
    });

    /* 浮窗按钮：历史 & 延迟 & 声明 */
    bindBtn('btn-open-history', showHistoryPage);
    bindBtn('floating-latency', function() { switchPage(5); });
    bindBtn('btn-open-disclaimer', showDisclaimerPage);

    /* 历史记录页：清除所有痕迹 */
    bindBtn('btn-clear-all', clearAllData);

    /* 首次启动：同意/拒绝 */
    bindBtn('btn-first-agree', firstRunAgree);
    bindBtn('btn-first-disagree', firstRunDisagree);

    /* Debug 模式触发：5秒内点击免责声明框10次 */
    bindDisclaimerClicks();

    /* 检测页操作按钮 */
    bindBtn('btn-detect-continue', function() { switchPage(2); });
    bindBtn('btn-detect-continue2', function() { switchPage(4); });
    bindBtn('btn-detect-back', function() { switchPage(0); });
    bindBtn('btn-detect-back2', function() { switchPage(0); });
    bindBtn('btn-detect-quick-repair', runQuickRepair);
    bindBtn('btn-detect-deep-repair', runDeepRepair);

    /* 修复完成后 - 重新检测按钮 */
    bindBtn('btn-retry-detect', function() {
        /* 直接调用 startDetection，复用完整检测流程 */
        startDetection();
    });

    /* 修复失败 - 访问专业测试网站引导 */
    bindBtn('btn-visit-pro', function() {
        safeInvoke('open_url', { url: 'https://17nas.com/ipv6-test.php' })
            .catch(function() {
                window.open('https://17nas.com/ipv6-test.php', '_blank');
            });
    });

    /* 修复失败引导 - 观看 B 站视频教程 */
    bindBtn('btn-watch-tutorial', function() {
        const tutorialUrl = 'https://www.bilibili.com/video/BV1TPegeDEKc';
        safeInvoke('open_url', { url: tutorialUrl })
            .catch(function() {
                window.open(tutorialUrl, '_blank');
            });
    });

    /* 故障页内"重新检测"按钮 */
    bindBtn('btn-fault-retry', function() {
        startDetection();
    });

    /* 故障页内"访问专业测试网站"按钮 */
    bindBtn('btn-fault-pro', function() {
        const url = 'https://17nas.com/ipv6-test.php';
        if (currentLanguage === 'en') url += '?lang=en-US';
        safeInvoke('open_url', { url: url })
            .catch(function() {
                window.open(url, '_blank');
            });
    });

    /* 修复模态弹窗 - "重试" 按钮（关闭弹窗后重新检测） */
    bindBtn('btn-repair-retry', function() {
        closeRepairModal();
        /* 短暂延迟让淡出动画完成 */
        setTimeout(function() {
            startDetection();
        }, 280);
    });

    /* 修复模态弹窗 - "返回" 按钮（关闭弹窗返回主页） */
    bindBtn('btn-repair-back', function() {
        closeRepairModal();
        setTimeout(function() {
            switchPage(0);
        }, 280);
    });

    /* 历史记录详情弹窗 - "关闭页面" 按钮 */
    bindBtn('btn-history-detail-close', function() {
        closeHistoryDetail();
    });

        /* 历史记录详情弹窗 - "清除记录" 按钮（删除单条记录） */
        bindBtn('btn-history-detail-delete', function() {
            if (window.__APP__.currentDetailRecordIndex < 0) return;
            const idx = window.__APP__.currentDetailRecordIndex;
            const record = window.__APP__.appConfig.records[idx];
            const targetLabel = (record && record.record_type === 'probe') ? t('history.type.probe') + ' ' + t('history.record') : t('history.record');
            const addrLabel = (record && record.ipv6_address) ? record.ipv6_address : t('history.confirm_default_addr');
            /* 二次确认（3层窗口）— 取消则回到第2层 */
            showConfirm(t('history.confirm_title'), t('history.confirm_desc', { type: targetLabel, addr: addrLabel }),
                function onConfirm() {
                    safeInvoke('delete_record', { index: idx })
                        .then(function(updatedConfig) {
                            if (updatedConfig) window.__APP__.appConfig = updatedConfig;
                            closeHistoryDetail();
                            renderHistory();
                        })
                        .catch(function(e) {
                            let msg = (typeof e === 'string') ? e : (e && e.message ? e.message : t('history.delete_failed'));
                            showSimpleMessage(t('history.confirm_delete_failed') + escapeHtml(msg));
                        });
                },
                function onCancel() {
                    /* 取消则回到第2层（详情弹窗仍显示） */
                }
            );
        });

    /* 全局键盘快捷键 */
    bindGlobalKeyboardShortcuts();
}

/* 绑定 Debug 模式触发（免责声明框点击） */
function bindDisclaimerClicks() {
    let disclaimerClickCount = 0;
    let disclaimerClickFirstTime = 0;
    const disclaimerBoxes = document.querySelectorAll('.first-run-disclaimer-preview, .disclaimer-content');
    for (let d = 0; d < disclaimerBoxes.length; d++) {
        (function(box) {
            if (box.dataset.disclaimerBound === '1') return;
            box.dataset.disclaimerBound = '1';
            box.addEventListener('click', function() {
                const now = Date.now();
                if (disclaimerClickFirstTime === 0 || (now - disclaimerClickFirstTime) > 5000) {
                    /* 距离第一次点击超过5秒（或首次点击），重置计数器 */
                    disclaimerClickFirstTime = now;
                    disclaimerClickCount = 1;
                    return;
                }
                disclaimerClickCount++;
                if (disclaimerClickCount >= 10) {
                    /* 5秒内点击达到10次，弹出确认对话框并重置计数器 */
                    disclaimerClickCount = 0;
                    disclaimerClickFirstTime = 0;
                    showConfirm(t('app.debug.confirm_title'), t('app.debug.confirm_desc'), function onConfirm() {
                        safeInvoke('set_debug_mode', { enabled: true }).catch(function(e) {
                            showSimpleMessage(t('app.debug.open_failed') + escapeHtml((e && e.message) ? e.message : String(e)));
                        });
                    }, function onCancel() {
                        /* 用户点击"取消"，不做任何操作 */
                    }, t('app.debug.confirm_btn'), t('app.debug.cancel_btn'));
                }
            });
        })(disclaimerBoxes[d]);
    }
}

/* 绑定全局键盘快捷键 */
function bindGlobalKeyboardShortcuts() {
    document.addEventListener('keydown', function(e) {
        /* 如果正在输入文本（input/textarea），ESC 仍可关闭弹窗 */
        const isInputFocused = document.activeElement &&
            (document.activeElement.tagName === 'INPUT' ||
             document.activeElement.tagName === 'TEXTAREA' ||
             document.activeElement.isContentEditable);

        /* ESC: 优先关闭弹窗（最高优先级） */
        if (e.key === 'Escape') {
            /* 检查是否有弹窗打开 */
            const historyOverlay = document.getElementById('history-detail-overlay');
            if (historyOverlay && historyOverlay.classList.contains('active')) {
                closeHistoryDetail();
                e.preventDefault();
                return;
            }
            const confirmOverlay = document.getElementById('confirm-modal');
            if (confirmOverlay && confirmOverlay.classList.contains('active')) {
                /* 触发取消按钮 */
                const cancelBtn = document.getElementById('confirm-cancel');
                if (cancelBtn) cancelBtn.click();
                e.preventDefault();
                return;
            }
            const repairOverlay = document.getElementById('repair-modal-overlay');
            if (repairOverlay && repairOverlay.classList.contains('active')) {
                /* 修复模态不响应 ESC（避免误关闭正在进行的修复） */
                return;
            }
            /* 如果在子页面，按 ESC 返回主页 */
            if (window.__APP__.currentPage !== 0 && !isInputFocused) {
                const backBtn = document.querySelector('.page.active .page-header-back');
                if (backBtn) backBtn.click();
                e.preventDefault();
            } else if (isInputFocused) {
                /* 输入框中 ESC: 失焦 */
                document.activeElement.blur();
                e.preventDefault();
            }
            return;
        }

        /* Enter: 在输入框中触发对应按钮 */
        if (e.key === 'Enter' && isInputFocused) {
            const id = document.activeElement.id;
            if (id === 'latency-target') {
                const btn = document.getElementById('btn-start-tracert');
                if (btn && !btn.disabled) btn.click();
                e.preventDefault();
            } else if (id === 'config-port' || id === 'config-target') {
                const genBtn = document.getElementById('btn-generate-addr');
                if (genBtn && !genBtn.disabled) genBtn.click();
                e.preventDefault();
            }
            return;
        }

        /* 数字键 1-6: 页面快速跳转（仅在主页） */
        if (window.__APP__.currentPage === 0 && !isInputFocused) {
            if (e.key >= '1' && e.key <= '6') {
                const pageMap = { '1': 0, '2': 1, '3': 2, '4': 3, '5': 4, '6': 5 };
                let target = pageMap[e.key];
                if (target !== undefined) {
                    switchPage(target);
                    e.preventDefault();
                }
            }
        }
    });
}

function init() {
    debugLog('[init] STARTING...', 'INFO');
    try {
        initI18nAndTheme();   /* 恢复语言/主题偏好并应用翻译（增量功能） */
        initParticles();
        magnetEffect();
        initTitleBar();
        debugLog('[init] initTitleBar done', 'INFO');

        /* 只绑定 .page-header-back 类，避免与 startDetection 等函数重复触发 原代码绑定所有 [data-page] 元素，会导致 btn-start-detect 触发 2 次（switchPage + startDetection） 改为精确选择器：只有返回按钮需要走 switchPage 逻辑 */
        bindBackButtons();

        /* 绑定主页按钮 */
        bindHomeButtons();

        const statusEl = document.getElementById('home-status');
        if (statusEl) {
            if (Tauri.available) {
                safeInvoke('is_admin').then(function(admin) {
                    if (admin === false) {
                        statusEl.textContent = t('home.status.not_admin');
                    } else if (admin === null || admin === undefined) {
                        /* 静默不打扰用户 */
                    }
                }).catch(function() { /* 调用失败静默 */ });
            } else {
                statusEl.textContent = t('home.status.tauri_unavailable');
            }
        }
    } catch (err) {
        debugLog('[init] FAILED: ' + err, 'ERROR');
        const statusEl = document.getElementById('home-status');
        if (statusEl) statusEl.textContent = t('home.status.init_failed');
    }
    debugLog('[init] COMPLETED', 'INFO');
}

document.addEventListener('DOMContentLoaded', function() {
    console.log('[DOMContentLoaded] fired');
    checkFirstRun();
});

/* ================== 历史记录 & 免责声明 ================== */

/* appConfig 已移入 window.__APP__.appConfig */

function formatTimestamp(ts) {
    /* 处理无效时间戳，避免显示 "NaN-NaN-NaN ..." */
    if (!ts || isNaN(ts) || ts < 0) return t('time.unknown');
    let d = new Date(ts);
    if (isNaN(d.getTime())) return t('time.unknown');
    const pad = function(n) { return n < 10 ? '0' + n : '' + n; };
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' +
           pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
}

function escapeHtml(str) {
    if (str == null) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function renderHistory() {
    const list = document.getElementById('history-list');
    if (!list) return;

    const footer = document.getElementById('history-footer');

    if (!window.__APP__.appConfig.records || window.__APP__.appConfig.records.length === 0) {
        list.innerHTML = '<div class="history-empty">' + t('history.empty') + '</div>';
        if (footer) footer.style.display = 'none';
        return;
    }

    if (footer) footer.style.display = 'block';

    let html = '';
    for (let i = 0; i < window.__APP__.appConfig.records.length; i++) {
        const r = window.__APP__.appConfig.records[i];
        let statusClass, statusText;
        if (r.record_type === 'probe') {
            /* 诊断记录：根据评分区分颜色 */
            const scoreMatch = (r.summary || '').match(/评分\s*(\d+)\s*\/\s*100/);
            const score = scoreMatch ? parseInt(scoreMatch[1], 10) : -1;
            if (score >= 90) { statusClass = 'success'; statusText = t('history.status.good'); }
            else if (score >= 75) { statusClass = 'success'; statusText = t('history.status.fair'); }
            else if (score >= 60) { statusClass = 'warn'; statusText = '⚠ ' + t('probe.quality.warn'); }
            else { statusClass = 'fail'; statusText = t('history.status.poor'); }
        } else {
            /* 非诊断记录保持原逻辑（成功绿色，失败红色） */
            statusClass = r.success ? 'success' : 'fail';
            statusText = r.success ? t('history.status.success') : t('history.status.fail');
        }
        /* 诊断记录特殊标记 */
        const typeBadge = r.record_type === 'probe' ? '<span class="history-card-type">' + t('history.type.probe') + '</span>' : '';
        /* 给 history-card 加 data-record-index，便于点击后定位记录 */
        html += '<div class="history-card" data-record-index="' + i + '">' +
                    '<div class="history-card-header">' +
                        '<span>' + escapeHtml(formatTimestamp(r.timestamp)) + '</span>' +
                        '<span class="history-card-status ' + statusClass + '">' + statusText + typeBadge + '</span>' +
                    '</div>' +
                    '<div class="history-card-address">' + escapeHtml(r.ipv6_address || t('summary.no_address')) + '</div>' +
                    '<div class="history-card-summary">' + escapeHtml(r.summary || '') + '</div>' +
                '</div>';
    }
    list.innerHTML = html;

    /* 为每张卡片绑定点击事件，打开详情弹窗 */
    const cards = list.querySelectorAll('.history-card');
    for (let j = 0; j < cards.length; j++) {
        (function(card, idx) {
            card.style.cursor = 'pointer';
            card.addEventListener('click', function() {
                const record = window.__APP__.appConfig.records[idx];
                if (record) openHistoryDetail(record, idx);
            });
        })(cards[j], j);
    }
}

/* currentDetailRecordIndex 已移入 window.__APP__.currentDetailRecordIndex */

function openHistoryDetail(record, index) {
    window.__APP__.currentDetailRecordIndex = index;
    const overlay = document.getElementById('history-detail-overlay');
    if (!overlay) return;
    const titleEl = document.getElementById('history-detail-title');
    const subtitleEl = document.getElementById('history-detail-subtitle');
    const summaryEl = document.getElementById('history-detail-summary');
    const stepsEl = document.getElementById('history-detail-steps');

    /* 标题区分检测记录和诊断记录 */
    const isProbe = record.record_type === 'probe';
    if (titleEl) {
        titleEl.textContent = isProbe ? t('latency.title.short') : (record.success ? t('history.detail.success') : t('history.detail.failure'));
    }
    if (subtitleEl) {
        let d = new Date(record.timestamp || record.ts);
        subtitleEl.textContent = (isNaN(d.getTime()) ? t('history.detail.unknown_time') : formatTimestamp(record.timestamp || record.ts));
    }

    /* 摘要区 — 总结性内容 */
    if (summaryEl) {
        let summaryHtml = '';
        /* 评分（诊断记录） */
        if (isProbe && record.probe_result && record.probe_result.score) {
            const pr = record.probe_result;
            let scoreColor = 'var(--color-green-500)';
            if (pr.score < 40) scoreColor = 'var(--color-red-500)';
            else if (pr.score < 60) scoreColor = 'var(--color-orange-500)';
            else if (pr.score < 75) scoreColor = 'var(--color-yellow-500)';
            else if (pr.score < 90) scoreColor = 'var(--color-blue-500)';
            summaryHtml += '<div class=\"summary-row\">' +
                '<span class=\"summary-label\">' + t('summary.score') + '</span>' +
                '<span class=\"summary-value\" style=\"color:' + scoreColor + ';\">' + pr.score + '/100 (' + escapeHtml(pr.score_label || '--') + ')</span>' +
                '</div>';
            /* Average latency and packet loss */
            if (pr.icmp_rtt && pr.icmp_rtt.samples > 0) {
                summaryHtml += '<div class=\"summary-row\">' +
                    '<span class=\"summary-label\">' + t('summary.avg_latency') + '</span>' +
                    '<span class=\"summary-value\">' + safeFixed(pr.icmp_rtt.mean, 1) + ' ms</span>' +
                    '</div>';
                summaryHtml += '<div class=\"summary-row\">' +
                    '<span class=\"summary-label\">' + t('summary.packet_loss') + '</span>' +
                    '<span class=\"summary-value\">' + safeFixed(pr.icmp_rtt.loss_rate, 1) + '%</span>' +
                    '</div>';
            }
            /* TCP */
            if (pr.tcp_handshake && pr.tcp_handshake.samples > 0) {
                summaryHtml += '<div class=\"summary-row\">' +
                    '<span class=\"summary-label\">' + t('probe.tcp_title') + '</span>' +
                    '<span class=\"summary-value\">' + safeFixed(pr.tcp_handshake.mean, 1) + ' ms</span>' +
                    '</div>';
            }
            /* DNS */
            if (pr.dns_latency != null) {
                summaryHtml += '<div class=\"summary-row\">' +
                    '<span class=\"summary-label\">' + t('summary.dns') + '</span>' +
                    '<span class=\"summary-value\">' + safeFixed(pr.dns_latency, 2) + ' ms</span>' +
                    '</div>';
            }
            /* Path hops */
            if (pr.hop_count > 0) {
                summaryHtml += '<div class="summary-row">' +
                    '<span class="summary-label">' + t('summary.path_hops') + '</span>' +
                    '<span class="summary-value">' + pr.hop_count + t('summary.hops_unit') + '</span>' +
                    '</div>';
            }
        } else {
            /* 检测记录 */
            summaryHtml += '<div class="summary-row">' +
                '<span class="summary-label">' + t('summary.detection_result') + '</span>' +
                '<span class="summary-value" style="color:' + (record.success ? 'var(--color-green-500)' : 'var(--color-red-500)') + ';">' +
                (record.success ? '✓ ' + t('probe.success_label') : '✗ ' + t('probe.fail_label')) + '</span>' +
                '</div>';
            summaryHtml += '<div class="summary-row">' +
                '<span class="summary-label">' + t('summary.ipv6_address') + '</span>' +
                '<span class="summary-value" style="font-family:Consolas,monospace;font-size:12px;">' + escapeHtml(record.ipv6_address || t('summary.no_address_short')) + '</span>' +
                '</div>';
            /* Priority info (extracted from steps) */
            if (record.steps && record.steps.length > 0) {
                const summaryText = record.summary || '';
                let priority = '';
                if (summaryText.indexOf(t('summary.priority_ipv6')) >= 0) priority = t('summary.priority_ipv6');
                else if (summaryText.indexOf(t('summary.priority_ipv4')) >= 0) priority = t('summary.priority_ipv4');
                if (priority) {
                    summaryHtml += '<div class="summary-row">' +
                        '<span class="summary-label">' + t('summary.priority_title') + '</span>' +
                        '<span class="summary-value">' + priority + '</span>' +
                        '</div>';
                }
            }
            /* Summary text */
            if (record.summary) {
                summaryHtml += '<div class="summary-row" style="flex-direction:column;align-items:flex-start;">' +
                    '<span class="summary-label">' + t('summary.summary') + '</span>' +
                    '<span class="summary-value" style="margin-top:4px;font-size:12px;line-height:1.5;">' + escapeHtml(record.summary) + '</span>' +
                    '</div>';
            }
        }
        summaryEl.innerHTML = summaryHtml;
    }

    /* Render steps (detection) or detail cards (probe) */
    if (stepsEl) {
        stepsEl.innerHTML = '';
        if (isProbe && record.probe_result) {
            const pr = record.probe_result;
            let html = '';
            if (pr.icmp_rtt && pr.icmp_rtt.samples > 0) {
                html += renderProbeCard(t('probe.icmp_title'), t('probe.icmp_subtitle'), pr.icmp_rtt);
            }
            if (pr.tcp_handshake && pr.tcp_handshake.samples > 0) {
                html += renderProbeCard(t('probe.tcp_title'), t('probe.tcp_subtitle'), pr.tcp_handshake);
            }
            if (pr.dns_latency != null) {
                html += renderDnsCard(pr.dns_latency);
            }
            if (pr.hop_count > 0) {
                html += renderPathCard(pr.hop_count, pr.first_hop, pr.last_hop, pr.path_latencies);
            }
            if (!html) html = '<p style="text-align:center;color:rgba(255,255,255,0.5);padding:20px;">' + t('latency.no_data') + '</p>';
            stepsEl.innerHTML = html;
        } else {
            /* 检测记录：渲染步骤列表 */
            /* 过滤掉 status === 'running' 的过程步骤，只保留最终结果 （success/fail/warn），避免历史记录中出现"正在干什么"的无用信息 */
            const allSteps = record.steps || [];
            let steps = allSteps.filter(function(s) {
                return s && s.status && s.status !== 'running';
            });
            if (steps.length === 0) {
                stepsEl.innerHTML = '<p style="text-align:center;color:rgba(255,255,255,0.5);padding:20px;">' + t('history.no_steps') + '</p>';
            } else {
                steps.forEach(function(step) {
                    let el = document.createElement('div');
                    el.className = 'history-detail-step ' + (step.status || 'success');
                    const icon = step.status === 'fail' ? '✕' : (step.status === 'warn' ? '!' : '✓');
                    const metaParts = [];
                    if (step.target_url) metaParts.push('<span class="step-target">' + escapeHtml(step.target_url) + '</span>');
                    if (step.latency) metaParts.push('<span class="step-latency">' + escapeHtml(step.latency) + '</span>');
                    el.innerHTML = '<div class="step-icon">' + icon + '</div>' +
                        '<div class="step-content">' +
                        '<div class="step-msg">' + escapeHtml(step.message || '') + '</div>' +
                        (metaParts.length ? '<div class="step-meta">' + metaParts.join(' · ') + '</div>' : '') +
                        '</div>';
                    stepsEl.appendChild(el);
                });
            }
        }
    }

    overlay.style.display = 'flex';
    overlay.classList.add('active');
}

function closeHistoryDetail() {
    const overlay = document.getElementById('history-detail-overlay');
    if (!overlay) {
        window.__APP__.currentDetailRecordIndex = -1;
        return;
    }
    overlay.classList.remove('active');
    overlay.classList.add('closing');
    setTimeout(function() {
        overlay.style.display = 'none';
        overlay.classList.remove('closing');
    }, PROGRESS_TWEEN_DURATION);
    window.__APP__.currentDetailRecordIndex = -1;
}

/* 确认弹窗关闭动画（与 closeHistoryDetail 风格一致） */
function closeConfirmModal() {
    const overlay = document.getElementById('confirm-modal');
    if (!overlay) return;
    overlay.classList.remove('active');
    overlay.classList.add('closing');
    setTimeout(function() {
        overlay.style.display = 'none';
        overlay.classList.remove('closing');
    }, PROGRESS_TWEEN_DURATION);
}

async function saveCurrentRecordToHistory(result) {
    try {
        const addr = (result && result.addresses && result.addresses.length > 0)
            ? result.addresses[0].address
            : t('summary.no_address_short');
        const record = {
            id: 'rec_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
            timestamp: Date.now(),
            ipv6_address: addr,
            success: !!(result && result.success),
            summary: result && result.success
                ? t('detect.status.done_msg')
                : (t('latency.fail_prefix') + (result && result.error ? result.error : '')),
            /* 过滤掉 status === 'running' 的过程步骤，只保存最终结果 */
            steps: (result && result.steps)
                ? result.steps.filter(function(s) { return s && s.status && s.status !== 'running'; })
                : []
        };
        window.__APP__.appConfig = await safeInvoke('add_history_record', { record: record });
    } catch (e) {
        console.error('保存历史记录失败:', e);
        if (typeof showSimpleMessage === 'function') {
            showSimpleMessage(t('history.save_failed'));
        }
    }
}

async function loadAppConfig() {
    try {
        window.__APP__.appConfig = await safeInvoke('load_config');
    } catch (e) {
        console.error('加载配置失败:', e);
        const prevAccepted = window.__APP__.appConfig.first_run_accepted;
        window.__APP__.appConfig = { first_run_accepted: prevAccepted, records: [] };
    }
}

async function showHistoryPage() {
    try {
        await loadAppConfig();
        const dataDir = await safeInvoke('get_data_directory');
        const pathEl = document.getElementById('history-data-path');
        if (pathEl) pathEl.textContent = t('history.data.path').replace('加载中...', '') + dataDir;
    } catch (e) {
        console.error(e);
    }
    renderHistory();
    switchPage(6);
}

/* showConfirm 重写为回调式，支持自定义标题/消息/按钮文字 + 关闭动画 */
function showConfirm(titleOrMessage, messageOrCallback, onConfirmOrUndefined, onCancelOrUndefined, confirmText, cancelText) {
    /* 向后兼容：若只有 1 个参数，按旧 Promise 模式处理（message 直接传入） */
    if (arguments.length === 1 || typeof messageOrCallback === 'undefined' ||
        (typeof messageOrCallback !== 'function' && typeof messageOrCallback !== 'string')) {
        const legacyMessage = titleOrMessage;
        return new Promise(function(resolve) {
            _showConfirmInternal(t('confirm.default_title'), legacyMessage, function() { resolve(true); }, function() { resolve(false); }, t('confirm.default_ok'), t('confirm.default_cancel'));
        });
    }
    /* 新签名 — title, message, onConfirm, onCancel, confirmText, cancelText */
    _showConfirmInternal(titleOrMessage, messageOrCallback, onConfirmOrUndefined, onCancelOrUndefined, confirmText, cancelText);
}

/* 实际渲染与绑定（私有） */
function _showConfirmInternal(title, message, onConfirm, onCancel, confirmText, cancelText) {
    const overlay = document.getElementById('confirm-modal');
    if (!overlay) {
        if (onConfirm) onConfirm();
        return;
    }
    const titleEl = overlay.querySelector('.confirm-title');
    const msgEl = document.getElementById('confirm-message');
    const okBtn = document.getElementById('confirm-ok');
    const cancelBtn = document.getElementById('confirm-cancel');
    if (titleEl) titleEl.textContent = title || t('confirm.default_title');
    if (msgEl) {
        msgEl.textContent = message || '';
        /* 危险操作（清除/删除）消息添加 .danger 类，文字变红色 */
        if (message && (message.indexOf(t('history.clear_all_title').substring(0, 2)) >= 0 || message.indexOf(t('history.delete_failed')) >= 0)) {
            msgEl.classList.add('danger');
        } else {
            msgEl.classList.remove('danger');
        }
    }
    if (okBtn) {
        const okText = okBtn.querySelector('.liquidGlass-text');
        if (okText) okText.textContent = confirmText || t('confirm.default_ok');
    }
    if (cancelBtn) {
        const cancelTextNode = cancelBtn.querySelector('.liquidGlass-text');
        if (cancelTextNode) cancelTextNode.textContent = cancelText || t('confirm.default_cancel');
    }

    /* 清除旧监听器，避免重复触发（用 cloneNode 替换并重新绑定） */
    if (okBtn) {
        const newOkBtn = okBtn.cloneNode(true);
        newOkBtn.removeAttribute('data-bound');
        okBtn.parentNode.replaceChild(newOkBtn, okBtn);
        newOkBtn.addEventListener('click', function() {
            closeConfirmModal();
            if (onConfirm) onConfirm();
        });
    }
    if (cancelBtn) {
        const newCancelBtn = cancelBtn.cloneNode(true);
        newCancelBtn.removeAttribute('data-bound');
        cancelBtn.parentNode.replaceChild(newCancelBtn, cancelBtn);
        newCancelBtn.addEventListener('click', function() {
            closeConfirmModal();
            if (onCancel) onCancel();
        });
    }

    /* 如果弹窗正在关闭动画中，先清理 closing 类，避免 active/closing 同时存在导致动画异常 */
    overlay.classList.remove('closing');
    overlay.style.display = 'flex';
    /* 触发 active 让动画播放 */
    requestAnimationFrame(function() {
        overlay.classList.add('active');
    });
}

/* 简单消息提示：用与 Liquid Glass 一致的 toast 替代原生 alert（#15）， 非阻塞、自动消失，且用 textContent 渲染避免 XSS */
function showSimpleMessage(msg) {
    const text = (msg == null) ? '' : String(msg);
    const layer = document.getElementById('v69-toast-layer');
    if (!layer) {
        layer = document.createElement('div');
        layer.id = 'v69-toast-layer';
        document.body.appendChild(layer);
    }
    const toast = document.createElement('div');
    toast.className = 'v69-toast';
    toast.setAttribute('role', 'alert');
    toast.textContent = text;
    layer.appendChild(toast);
    requestAnimationFrame(function () { toast.classList.add('show'); });
    setTimeout(function () {
        toast.classList.remove('show');
        setTimeout(function () { if (toast.parentNode) toast.parentNode.removeChild(toast); }, 300);
    }, 3200);
}

async function clearAllData() {
    const confirmed = await showConfirm(t('history.clear_all_title'));
    if (!confirmed) return;

    try {
        window.__APP__.appConfig = await safeInvoke('clear_history');
        renderHistory();
        try {
            const pathEl = document.getElementById('history-data-path');
            if (pathEl) pathEl.textContent = t('history.cleared');
        } catch (e) { console.warn('[app]', e); }
    } catch (e) {
        showSimpleMessage(t('history.clear_failed') + escapeHtml((e && e.message) ? e.message : String(e)));
    }
}

async function cleanCacheDir() {
    const confirmed = await showConfirm(t('cache.clean.title'), t('cache.clean.desc'), null, null, t('cache.clean.confirm'), t('cache.clean.cancel'));
    if (!confirmed) return;
    try {
        const result = await safeInvoke('clean_cache_dir');
        let msg;
        if (result.kept && result.kept.length > 0) {
            msg = t('cache.clean.success_partial', { count: result.cleaned ? result.cleaned.length : 0, kept: result.kept.length });
        } else {
            msg = t('cache.clean.success', { count: result.cleaned ? result.cleaned.length : 0 });
        }
        showSimpleMessage(msg);
    } catch (e) {
        showSimpleMessage(t('cache.clean.failed') + escapeHtml((e && e.message) ? e.message : String(e)));
    }
}

async function firstRunAgree() {
    try {
        window.__APP__.appConfig = await safeInvoke('accept_disclaimer');
    } catch (e) {
        console.error('保存同意状态失败:', e);
        window.__APP__.appConfig.first_run_accepted = true;
    }
    const firstPage = document.getElementById('page-first-run');
    if (firstPage) {
        firstPage.classList.remove('active');
        setTimeout(function() { firstPage.style.display = 'none'; }, 300);
    }
    const homePage = document.getElementById('page-home');
    if (homePage) {
        homePage.style.display = 'flex';
        homePage.classList.add('active');
    }
    const floatingBtns = document.getElementById('floating-btns');
    if (floatingBtns) floatingBtns.style.display = 'block';
    window.__APP__.currentPage = 0;
}

function firstRunDisagree() {
    /* 拒绝时立即关闭（：处理可能的 rejection） */
    try {
        if (window._closeApp) { window._closeApp(); } else { window.close(); }
    } catch (e) {
        console.error('[firstRunDisagree] close failed:', e);
        try { window.close(); } catch (e2) { /* ignore */ }
    }
}

function showDisclaimerPage() {
    switchPage(7);
}

/* 抽取 first-run 弹窗显示逻辑，catch 路径也必须显示 */
function showFirstRunModal() {
    window.__APP__.appConfig = window.__APP__.appConfig || { first_run_accepted: false, records: [] };
    if (window.__APP__.appConfig.first_run_accepted) {
        const homePage = document.getElementById('page-home');
        if (homePage) {
            homePage.style.display = 'flex';
            homePage.classList.add('active');
        }
        const floatingBtns = document.getElementById('floating-btns');
        if (floatingBtns) floatingBtns.style.display = 'block';
        window.__APP__.currentPage = 0;
    } else {
        const firstPage = document.getElementById('page-first-run');
        if (firstPage) {
            firstPage.style.display = 'flex';
            firstPage.classList.add('active');
        }
        const floatingBtns2 = document.getElementById('floating-btns');
        if (floatingBtns2) floatingBtns2.style.display = 'none';
    }
}

async function checkFirstRun() {
    debugLog('[checkFirstRun] STARTING...', 'INFO');
    /* 深度修复：原代码 await safeInvoke('load_config') 无超时保护。 若 Tauri 后端 hang 住（如 config.json 损坏、加密迁移死循环）， 则 init() 永远不会被调用，所有 bindBtn 不会执行， 表现为"所有按钮点不响应"。现在加 3s 超时兜底。 */
    let initStarted = false;
    function startInit() {
        if (initStarted) return;
        initStarted = true;
        debugLog('[checkFirstRun] calling init after ' + DETECT_START_DELAY + 'ms', 'INFO');
        setTimeout(init, DETECT_START_DELAY);
    }

    /* 用 Promise.race 给 load_config 加超时 */
    const loadPromise = safeInvoke('load_config');
    const timeoutPromise = new Promise(function(_, reject) {
        setTimeout(function() { reject(new Error('load_config timeout')); }, 10000);
    });

    try {
        window.__APP__.appConfig = await Promise.race([loadPromise, timeoutPromise]);
        showFirstRunModal();
    } catch (err) {
        console.error('[checkFirstRun] load_config failed or timeout:', err);
        showFirstRunModal();
    }
    startInit();
}



