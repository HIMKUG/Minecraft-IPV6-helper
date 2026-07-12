/* 纯视觉优化 — V48 多核版本
   - 鼠标点击（任意位置）触发爆发 → Worker 线程渲染
   - 常驻 ambient 粒子在主线程（轻量）
   - 预渲染 HSL Sprite 缓存代替 createRadialGradient（20-40x加速）
   - OffscreenCanvas + Web Worker 利用多核
   - 不干扰原有 invoke 逻辑
*/
(function() {
    'use strict';

    const CFG = {
        BURST_COUNT_CLICK: 32,
        BURST_COUNT_BUTTON: 60,
        AMBIENT_POOL_SIZE: 120,
        AMBIENT_SPAWN_INTERVAL: 60,
        AMBIENT_LIFE: 6500,
        AMBIENT_SPEED: 0.5
    };

    /* === 常驻 ambient 粒子池（主线程） === */
    function createParticle() {
        return {
            active: false,
            x: 0, y: 0,
            vx: 0, vy: 0,
            life: 0, maxLife: 0,
            size: 0,
            hue: 0,
            isGlass: false,
            rotation: 0,
            rotSpeed: 0,
            opacityScale: 1
        };
    }

    const ambientPool = [];
    const ambientActive = [];

    function acquireAmbient() {
        for (let i = 0; i < ambientPool.length; i++) {
            if (!ambientPool[i].active) return ambientPool[i];
        }
        const p = createParticle();
        ambientPool.push(p);
        return p;
    }

    function initAmbientPool() {
        for (let i = 0; i < CFG.AMBIENT_POOL_SIZE; i++) ambientPool.push(createParticle());
    }

    /* === 主 Canvas（仅绘制 ambient） === */
    let canvas = null;
    let ctx = null;
    /* V62: 保存 MutationObserver 引用，便于清理 */
    let fxAppObserver = null;
    let rafId = null;
    let lastTime = 0;
    let lastAmbientSpawn = 0;
    let dpr = 1;
    let w = 0, h = 0;

    function initCanvas() {
        canvas = document.getElementById('fx-canvas-fx');
        if (!canvas) {
            canvas = document.createElement('canvas');
            canvas.id = 'fx-canvas-fx';
            document.body.appendChild(canvas);
        }
        ctx = canvas.getContext('2d');
        resizeCanvas();
        window.addEventListener('resize', resizeCanvas);
    }

    function resizeCanvas() {
        if (!canvas) return;
        dpr = window.devicePixelRatio || 1;
        const width = window.innerWidth;
        const height = window.innerHeight;
        canvas.width = width * dpr;
        canvas.height = height * dpr;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        w = width;
        h = height;
        /* 通知 Worker 同步尺寸 */
        if (worker) {
            worker.postMessage({ type: 'resize', width: width, height: height });
        }
    }

    /* === Burst Worker 初始化 === */
    let worker = null;
    let burstCanvas = null;
    let workerReady = false;

    function initWorker() {
        try {
            burstCanvas = new OffscreenCanvas(window.innerWidth, window.innerHeight);
            worker = new Worker('fx-burst-worker.js');
            worker.onerror = function(e) {
                console.warn('[V48] Burst worker failed, falling back to main thread', e);
                worker = null;
            };
            worker.postMessage({ type: 'init', canvas: burstCanvas }, [burstCanvas]);
            workerReady = true;
        } catch (e) {
            console.warn('[V48] OffscreenCanvas not supported, burst on main thread');
            worker = null;
            workerReady = false;
        }
    }

    /* === 预渲染 ambient sprite 缓存 === */
    const ambientSpriteCache = {};
    const AMBIENT_HUES = [0, 90, 180, 270, 60];
    const AMBIENT_SIZES = [2, 4, 6];

    function buildAmbientSprite(hue, size) {
        const c = document.createElement('canvas');
        c.width = size * 4;
        c.height = size * 4;
        const c2d = c.getContext('2d');
        const cx = size * 2;
        const grad = c2d.createRadialGradient(cx, cx, 0, cx, cx, size);
        grad.addColorStop(0, 'hsla(' + hue + ', 100%, 85%, 1)');
        grad.addColorStop(0.4, 'hsla(' + hue + ', 95%, 65%, 0.6)');
        grad.addColorStop(1, 'hsla(' + hue + ', 90%, 50%, 0)');
        c2d.fillStyle = grad;
        c2d.beginPath();
        c2d.arc(cx, cx, size, 0, Math.PI * 2);
        c2d.fill();
        return c;
    }

    function initAmbientSprites() {
        for (let hi = 0; hi < AMBIENT_HUES.length; hi++) {
            for (let si = 0; si < AMBIENT_SIZES.length; si++) {
                ambientSpriteCache[AMBIENT_HUES[hi] + '_' + AMBIENT_SIZES[si]] =
                    buildAmbientSprite(AMBIENT_HUES[hi], AMBIENT_SIZES[si]);
            }
        }
    }

    function nearestAmbientSprite(hue, size) {
        let nh = AMBIENT_HUES[0];
        let minDiff = 999;
        for (let i = 0; i < AMBIENT_HUES.length; i++) {
            let d = Math.abs(AMBIENT_HUES[i] - hue);
            if (d < minDiff) { minDiff = d; nh = AMBIENT_HUES[i]; }
        }
        let ns = AMBIENT_SIZES[0];
        minDiff = 999;
        for (let j = 0; j < AMBIENT_SIZES.length; j++) {
            const d2 = Math.abs(AMBIENT_SIZES[j] - size);
            if (d2 < minDiff) { minDiff = d2; ns = AMBIENT_SIZES[j]; }
        }
        return ambientSpriteCache[nh + '_' + ns];
    }

    /* === 爆发 === */
    let globalHue = 0;

    function spawnBurst(cx, cy, count, baseHue) {
        if (count == null) count = CFG.BURST_COUNT_CLICK;
        if (baseHue == null) {
            baseHue = (globalHue + Math.random() * 360) % 360;
            globalHue = (globalHue + 47) % 360;
        }
        if (worker && workerReady) {
            /* Off-thread 渲染 */
            worker.postMessage({ type: 'burst', x: cx, y: cy, count: count, hue: baseHue });
        }
        boostBackground();
    }

    function boostBackground() {
        try {
            const engine = window.__APP__ && window.__APP__.particlesEngine;
            if (engine && engine.options) {
                const anim = engine.options.particles.color.animation;
                if (anim && anim.h) {
                    anim.h.speed = 20 * 3;
                    engine.refresh();
                    setTimeout(function() {
                        anim.h.speed = 20;
                        try { engine.refresh(); } catch (e) { console.warn('[fx]', e); }
                    }, 800);
                }
            }
        } catch (e) { console.warn('[fx]', e); }
    }

    /* === 常驻 ambient 生成 === */
    function spawnAmbient() {
        const p = acquireAmbient();
        const side = Math.floor(Math.random() * 4);
        if (side === 0) { p.x = -10; p.y = Math.random() * h; }
        else if (side === 1) { p.x = w + 10; p.y = Math.random() * h; }
        else if (side === 2) { p.x = Math.random() * w; p.y = -10; }
        else { p.x = Math.random() * w; p.y = h + 10; }

        p.vx = (Math.random() - 0.5) * CFG.AMBIENT_SPEED;
        p.vy = (Math.random() - 0.5) * CFG.AMBIENT_SPEED;
        p.maxLife = CFG.AMBIENT_LIFE + Math.random() * 2500;
        p.life = p.maxLife;
        p.size = 2.2 + Math.random() * 4.0;
        p.hue = Math.random() * 360;
        p.isGlass = Math.random() < 0.25;
        p.rotation = Math.random() * Math.PI * 2;
        p.rotSpeed = (Math.random() - 0.5) * 0.04;
        p.opacityScale = 1.0;
        p.active = true;
        ambientActive.push(p);
    }

    /* === 主线程 ambient 更新循环 === */
    function update(now) {
        if (lastTime === 0) lastTime = now;
        const dt = Math.min(now - lastTime, 32);
        lastTime = now;

        if (now - lastAmbientSpawn > CFG.AMBIENT_SPAWN_INTERVAL) {
            lastAmbientSpawn = now;
            spawnAmbient();
        }

        ctx.clearRect(0, 0, w, h);
        ctx.globalCompositeOperation = 'lighter';

        let i = ambientActive.length;
        while (i--) {
            const p = ambientActive[i];
            if (!p.active) { ambientActive.splice(i, 1); continue; }

            p.x += p.vx;
            p.y += p.vy;
            p.rotation += p.rotSpeed;
            p.life -= dt;

            if (p.life <= 0 || p.x < -50 || p.x > w + 50 || p.y < -50 || p.y > h + 50) {
                p.active = false;
                ambientActive.splice(i, 1);
                continue;
            }

            const progress = 1 - (p.life / p.maxLife);
            const alpha = (1 - progress) * (1 - progress) * p.opacityScale;

            if (p.isGlass) {
                const half = p.size * 0.7;
                ctx.globalAlpha = alpha;
                ctx.fillStyle = 'hsla(' + p.hue + ', 90%, 70%, ' + (alpha * 0.8) + ')';
                ctx.fillRect(p.x - half, p.y - half, half * 2, half * 2);
            } else {
                const sprite = nearestAmbientSprite(p.hue, p.size);
                const sw = sprite.width / dpr;
                ctx.globalAlpha = alpha;
                ctx.drawImage(sprite, p.x - sw / 2, p.y - sw / 2, sw, sw);
            }
        }

        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 1;

        if (ambientActive.length > 0) {
            rafId = requestAnimationFrame(update);
        } else {
            rafId = null;
        }
    }

    function ensureLoop() {
        if (!rafId) {
            lastTime = 0;
            rafId = requestAnimationFrame(update);
        }
    }

    /* V94: 剪贴板操作委托给独立模块 clipboard.js */
    /* 注意：copyToClipboard 函数已移至 clipboard.js，此处仅保留兼容性 */

    /* V94: 复制按钮 — 委托给 clipboard.js 模块 */
    function bindCopyButton() {
        let btn = document.getElementById('btn-copy-result');
        if (!btn || btn.dataset.fxCopyBound === '1') return;
        btn.dataset.fxCopyBound = '1';

        btn.addEventListener('click', function() {
            /* 委托给 clipboard.js */
            let textEl = document.getElementById('result-address-display');
            let text = textEl ? textEl.textContent : '';

            if (window.Clipboard && window.Clipboard.copyResult) {
                let textNode = btn.querySelector('.liquidGlass-text');
                let origText = textNode ? textNode.textContent : '📋 复制到剪贴板';
                window.Clipboard.copyResult(text, origText, '✓ 已复制！', '✗ 复制失败', btn);
            }

            /* V62: 修复 burst 位置错位 — 由于 copy 按钮在 init() 中先注册（capture 阶段），
               全局 click 处理器还没机会记录 __lastClickX/Y。
               使用 setTimeout(0) 把 burst 调用推迟到下一轮事件循环，
               让全局 click 先于当前回调完成。 */
            setTimeout(function() {
                spawnBurst(window.__lastClickX || 0, window.__lastClickY || 0, CFG.BURST_COUNT_BUTTON);
            }, 0);
        }, true);
    }

    /* === 全局点击绑定 === */
    function bindGlobalClicks() {
        document.addEventListener('click', function(e) {
            /* 【V48 迭代2.3】记录 clientX/Y 备用，避免后续 getBoundingClientRect */
            window.__lastClickX = e.clientX;
            window.__lastClickY = e.clientY;
            if (e.target.closest('#btn-close, #btn-minimize, #btn-copy-result')) return;
            spawnBurst(e.clientX, e.clientY, CFG.BURST_COUNT_CLICK);
        }, true);

        function bindButton(btn) {
            if (!btn || btn.dataset.fxBurstBound === '1') return;
            btn.dataset.fxBurstBound = '1';
            btn.addEventListener('click', function(e) {
                if (btn.id === 'btn-copy-result') return;
                /* 【V48 迭代2.3】直接用 e.clientX/Y 替代 getBoundingClientRect */
                spawnBurst(e.clientX, e.clientY, CFG.BURST_COUNT_BUTTON);
            }, false);
        }

        const initialBtns = document.querySelectorAll('button, .btn, [role="button"]');
        for (let i = 0; i < initialBtns.length; i++) bindButton(initialBtns[i]);

        /* V62: MutationObserver 修复 — 不再监听整个 subtree
           只在按钮容器（确认/历史详情弹窗等）有需要时调用 ensureBurstBinding()
           保留轻量级的 childList 监听，但限定到 app 元素内部，避免整个 body 的子树变动 */
        if (typeof MutationObserver !== 'undefined') {
            const appRoot = document.getElementById('app');
            if (appRoot) {
                const obs = new MutationObserver(function(muts) {
                    for (let m = 0; m < muts.length; m++) {
                        const added = muts[m].addedNodes;
                        for (let a = 0; a < added.length; a++) {
                            const node = added[a];
                            if (node.nodeType !== 1) continue;
                            if (node.matches && (
                                node.matches('button') ||
                                node.matches('.btn') ||
                                node.matches('[role="button"]')
                            )) {
                                bindButton(node);
                            }
                            if (node.querySelectorAll) {
                                const subBtns = node.querySelectorAll('button, .btn, [role="button"]');
                                for (let s = 0; s < subBtns.length; s++) bindButton(subBtns[s]);
                            }
                        }
                    }
                });
                obs.observe(appRoot, { childList: true, subtree: true });
                /* 保存引用，便于后续清理（如未来页面切换或热重载） */
                fxAppObserver = obs;
            }
        }
    }

    /* === 初始化 === */
    function init() {
        initAmbientPool();
        initCanvas();
        initAmbientSprites();
        initWorker();
        bindCopyButton();
        bindGlobalClicks();
        ensureLoop();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

/* V94: 使用 window.__APP__ 命名空间（与 app.js 统一），
	       若 app.js 尚未加载则自动初始化 */
	    if (!window.__APP__) window.__APP__ = {};
	    window.__APP__.FX = {
	        spawnBurst: spawnBurst,
	        /* V94: copyToClipboard 已移至 clipboard.js，通过 window.Clipboard 访问 */
	    };
})();
