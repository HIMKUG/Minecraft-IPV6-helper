/* ==========================================================================
   V48 Burst Particle Worker — 爆发粒子并行渲染
   接收来自主线程的 spawnBurst 请求，独立 OffscreenCanvas 渲染
   充分利用多核，主线程零阻塞
   ========================================================================== */

(function() {
    'use strict';

    const CFG = {
        BURST_POOL_SIZE: 250,
        FRICTION: 0.975,
        GRAVITY: 0.05,
        LIFE_MIN: 1400,
        LIFE_MAX: 2400,
        HUE_SPREAD: 50,
        GLASS_RATIO: 0.35
    };

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

    const pool = [];
    const active = [];

    function acquire() {
        for (var i = 0; i < pool.length; i++) {
            if (!pool[i].active) return pool[i];
        }
        const p = createParticle();
        pool.push(p);
        return p;
    }

    const canvas = null;
    const ctx = null;
    const rafId = null;
    const lastTime = 0;
    const dpr = 1;
    const w = 0, h = 0;
    const globalHue = 0;

    /* === 预渲染 Sprite 缓存 ===
       5种色调 × 4种size = 20张缓存位图
       替代 createRadialGradient + fill (节省 20-40x 渲染时间) */
    const spriteCache = {};
    const SPRITE_HUES = [0, 90, 180, 270, 60];
    const SPRITE_SIZES = [3, 5, 7, 9];

    function buildSprite(hue, size) {
        const c = new OffscreenCanvas(size * 4, size * 4);
        const c2d = c.getContext('2d');
        const cx = size * 2;
        const cy = size * 2;
        const grad = c2d.createRadialGradient(cx, cy, 0, cx, cy, size);
        grad.addColorStop(0, 'hsla(' + hue + ', 100%, 85%, 1)');
        grad.addColorStop(0.4, 'hsla(' + hue + ', 95%, 65%, 0.6)');
        grad.addColorStop(1, 'hsla(' + hue + ', 90%, 50%, 0)');
        c2d.fillStyle = grad;
        c2d.beginPath();
        c2d.arc(cx, cy, size, 0, Math.PI * 2);
        c2d.fill();
        return c;
    }

    function initSprites() {
        for (var hi = 0; hi < SPRITE_HUES.length; hi++) {
            for (var si = 0; si < SPRITE_SIZES.length; si++) {
                const h = SPRITE_HUES[hi];
                let s = SPRITE_SIZES[si];
                spriteCache[h + '_' + s] = buildSprite(h, s);
            }
        }
    }

    function nearestSprite(hue, size) {
        /* 找最近 hue */
        const nh = SPRITE_HUES[0];
        const minDiff = 999;
        for (var i = 0; i < SPRITE_HUES.length; i++) {
            let d = Math.abs(SPRITE_HUES[i] - hue);
            if (d < minDiff) { minDiff = d; nh = SPRITE_HUES[i]; }
        }
        /* 找最近 size */
        const ns = SPRITE_SIZES[0];
        minDiff = 999;
        for (var j = 0; j < SPRITE_SIZES.length; j++) {
            const d2 = Math.abs(SPRITE_SIZES[j] - size);
            if (d2 < minDiff) { minDiff = d2; ns = SPRITE_SIZES[j]; }
        }
        return spriteCache[nh + '_' + ns];
    }

    function initCanvas(off) {
        canvas = off;
        ctx = canvas.getContext('2d');
        dpr = self.devicePixelRatio || 1;
        w = canvas.width / dpr;
        h = canvas.height / dpr;
    }

    function resize(width, height) {
        if (!canvas) return;
        dpr = self.devicePixelRatio || 1;
        canvas.width = width * dpr;
        canvas.height = height * dpr;
        w = width;
        h = height;
    }

    function spawnBurst(cx, cy, count, baseHue) {
        if (count == null) count = 32;
        if (baseHue == null) {
            baseHue = (globalHue + Math.random() * 360) % 360;
            globalHue = (globalHue + 47) % 360;
        }

        for (var i = 0; i < count; i++) {
            const p = acquire();
            const angle = Math.random() * Math.PI * 2;
            const speed = 1.4 + Math.random() * 2.6;
            const isGlass = Math.random() < CFG.GLASS_RATIO;

            p.active = true;
            p.x = cx;
            p.y = cy;
            p.vx = Math.cos(angle) * speed;
            p.vy = Math.sin(angle) * speed - 0.5;
            p.maxLife = CFG.LIFE_MIN + Math.random() * (CFG.LIFE_MAX - CFG.LIFE_MIN);
            p.life = p.maxLife;
            p.size = isGlass ? (2.5 + Math.random() * 3.5) : (2 + Math.random() * 2.5);
            p.hue = (baseHue + (Math.random() - 0.5) * CFG.HUE_SPREAD * 2) % 360;
            if (p.hue < 0) p.hue += 360;
            p.isGlass = isGlass;
            p.rotation = Math.random() * Math.PI * 2;
            p.rotSpeed = (Math.random() - 0.5) * 0.25;
            p.opacityScale = 1;
            active.push(p);
        }
        ensureLoop();
    }

    function update(now) {
        if (lastTime === 0) lastTime = now;
        const dt = Math.min(now - lastTime, 32);
        lastTime = now;

        ctx.clearRect(0, 0, w, h);
        ctx.globalCompositeOperation = 'lighter';

        const i = active.length;
        while (i--) {
            const p = active[i];
            if (!p.active) { active.splice(i, 1); continue; }

            p.vx *= CFG.FRICTION;
            p.vy *= CFG.FRICTION;
            p.vy += CFG.GRAVITY;
            p.x += p.vx;
            p.y += p.vy;
            p.rotation += p.rotSpeed;
            p.life -= dt;

            if (p.life <= 0 || p.x < -50 || p.x > w + 50 || p.y < -50 || p.y > h + 50) {
                p.active = false;
                active.splice(i, 1);
                continue;
            }

            const progress = 1 - (p.life / p.maxLife);
            const alpha = (1 - progress);
            alpha = alpha * alpha;
            alpha *= p.opacityScale;
            const size = p.size * (1 - progress * 0.4);

            if (p.isGlass) {
                const half = size * 0.7;
                ctx.globalAlpha = alpha;
                ctx.fillStyle = 'hsla(' + p.hue + ', 90%, 70%, ' + (alpha * 0.8) + ')';
                ctx.fillRect(p.x - half, p.y - half, half * 2, half * 2);
            } else {
                const sprite = nearestSprite(p.hue, size);
                const sw = sprite.width / dpr;
                ctx.globalAlpha = alpha;
                ctx.drawImage(sprite, p.x - sw / 2, p.y - sw / 2, sw, sw);
            }
        }

        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 1;

        if (active.length > 0) {
            rafId = setTimeout(update, 16);
        } else {
            rafId = null;
        }
    }

    function ensureLoop() {
        if (!rafId) {
            lastTime = 0;
            rafId = setTimeout(update, 16);
        }
    }

    self.onmessage = function(e) {
        let msg = e.data;
        if (!msg) return;
        switch (msg.type) {
            case 'init':
                initCanvas(msg.canvas);
                initSprites();
                break;
            case 'resize':
                resize(msg.width, msg.height);
                break;
            case 'burst':
                spawnBurst(msg.x, msg.y, msg.count, msg.hue);
                break;
        }
    };
})();
