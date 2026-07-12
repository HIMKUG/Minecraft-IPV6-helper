/* ==========================================================================
   Liquid Glass Helpers
   只做"装饰式"增强，不改写 app.js 中的业务状态机
   - 鼠标位置追踪 → 写入 :root 的 --lg-lx / --lg-ly
   - 观察 .page.active 变化，对内部主要 block 做错位淡入
   - 暴露 LG.stagger() 给其他模块手动调用
   ========================================================================== */
(function() {
    'use strict';
    const LG = window.LG = {};

    const rafId = null;
    const curX = 0, curY = 0;
    const tgtX = 0, tgtY = 0;
    const active = false;
    /* 【V48 迭代1.6】脏标记 — mousemove 只更新 tgt，tick 内才 setProperty
       防止高频 mousemove 触发每帧多次 CSS 变量写入（Chrome 会做 style recalc） */
    const dirty = false;

    function tick() {
        if (active && dirty) {
            curX += (tgtX - curX) * 0.18;
            curY += (tgtY - curY) * 0.18;
            document.documentElement.style.setProperty('--lg-lx', curX + 'px');
            document.documentElement.style.setProperty('--lg-ly', curY + 'px');
            dirty = false;
        }
        rafId = requestAnimationFrame(tick);
    }

    function onMove(e) {
        tgtX = e.clientX;
        tgtY = e.clientY;
        dirty = true;
        if (!active) {
            curX = tgtX;
            curY = tgtY;
            active = true;
        }
    }

    function onLeave() {
        active = false;
    }

    /* 通用 stagger：给一组元素做"淡入"的错位进入
       【V35 Bug-C 修复】原代码用 transform: translateY 实现位移动画，
       但 transform 会创建 stacking context，瞬间破坏毛玻璃效果。
       改用纯 opacity 过渡（不创建 SC），仅保留极轻微的"出现"感。 */
    LG.stagger = function(elements, options) {
        options = options || {};
        let step = options.step || 60;
        const duration = options.duration || 450;
        const arr = (elements && elements.length !== undefined) ?
            Array.prototype.slice.call(elements) : [elements];
        arr.forEach(function(el, i) {
            if (!el) return;
            el.style.transition = 'none';
            el.style.opacity = '0';
            void el.offsetHeight; /* 强制 reflow */
            setTimeout(function() {
                el.style.transition =
                    'opacity ' + duration + 'ms cubic-bezier(0.2, 0.8, 0.3, 1)';
                el.style.opacity = '1';
            }, i * step);
        });
    };

    /* 对单个 page 的"主要区块"做 stagger 错位进入 */
    LG.staggerPageContent = function(pageEl) {
        if (!pageEl) return;
        const blocks = pageEl.querySelectorAll(
            '.logo-area, .btn-group, .btn-group-vertical, ' +
            '.config-section, .result-section, .fault-section, ' +
            '.latency-section, .steps-container'
        );
        if (!blocks || blocks.length === 0) return;
        LG.stagger(blocks, { step: 90, duration: 500, distance: 16 });
    };

    /* 初始化：鼠标跟踪 + 观察 page.active 变化 */
    LG.init = function() {
        document.addEventListener('mousemove', onMove, { passive: true });
        document.addEventListener('mouseleave', onLeave);
        if (!rafId) rafId = requestAnimationFrame(tick);

        /* MutationObserver: 监听 page 切到 active，仅触发一次 stagger */
        if (typeof MutationObserver !== 'undefined') {
            const pageObserver = new MutationObserver(function(muts) {
                muts.forEach(function(m) {
                    if (m.type !== 'attributes' || m.attributeName !== 'class') return;
                    let el = m.target;
                    if (!el.classList || !el.classList.contains('page')) return;
                    if (!el.classList.contains('active')) return;
                    if (el.dataset.lgStaggered === '1') return;
                    el.dataset.lgStaggered = '1';
                    setTimeout(function() { LG.staggerPageContent(el); }, 80);
                });
            });
            document.querySelectorAll('.page').forEach(function(p) {
                pageObserver.observe(p, { attributes: true, attributeFilter: ['class'] });
            });
        }
    };

    function ready() { LG.init(); }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', ready);
    } else {
        ready();
    }
})();
