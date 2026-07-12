/**
 * 剪贴板模块（V94）
 * 封装剪贴板操作逻辑，支持 Tauri、navigator.clipboard 和 execCommand 降级
 * 提供统一的超时保护、UI 反馈和错误处理
 */

/* === 常量（封装在 IIFE 内，避免顶层 const 污染全局词法环境，
   防止与 app.js 的 const CLIPBOARD_TIMEOUT 撞名导致 SyntaxError 拖垮整个前端） === */
(function() {
'use strict';
const CLIPBOARD_TIMEOUT = 3000;
const COPY_SUCCESS_DURATION = 2000;

/**
 * 复制文本到剪贴板（带超时保护）
 * @param {string} text - 要复制的文本
 * @param {Object} [options] - 选项
 * @param {Function} [options.onSuccess] - 成功回调（UI 更新）
 * @param {Function} [options.onFail] - 失败回调（UI 更新）
 * @returns {Promise<boolean>} - 是否成功
 */
async function copyToClipboard(text, options = {}) {
    if (!text || typeof text !== 'string') {
        console.warn('[clipboard] Invalid text to copy:', text);
        return false;
    }

    /* 优先使用 Tauri Win32 API（快速可靠），加 3s 超时防止挂起 */
    if (window.__TAURI__ && window.__TAURI__.core && window.__TAURI__.core.invoke) {
        try {
            const tauriPromise = window.__TAURI__.core.invoke('copy_to_clipboard', { text: text });
            let timeoutPromise = new Promise(function(_, reject) {
                setTimeout(function() { reject(new Error('timeout')); }, CLIPBOARD_TIMEOUT);
            });
            await Promise.race([tauriPromise, timeoutPromise]);

            if (options.onSuccess) options.onSuccess();
            return true;
        } catch (e) {
            console.warn('[clipboard] Tauri copy failed:', e);
        }
    }

    /* 降级：navigator.clipboard */
    try {
        await navigator.clipboard.writeText(text);
        if (options.onSuccess) options.onSuccess();
        return true;
    } catch (e) {
        console.warn('[clipboard] navigator.clipboard failed:', e);
    }

    /* 最终降级：execCommand */
    try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand('copy');
        document.body.removeChild(ta);
        if (ok) {
            if (options.onSuccess) options.onSuccess();
            return true;
        }
    } catch (e) {
        console.warn('[clipboard] execCommand failed:', e);
    }

    if (options.onFail) options.onFail();
    return false;
}

/**
 * 复制结果到剪贴板并显示成功反馈
 * @param {string} text - 要复制的文本
 * @param {string} originalText - 按钮原始文本
 * @param {string} successText - 成功后显示的文本
 * @param {string} failText - 失败后显示的文本
 * @param {HTMLElement} [btn] - 按钮 DOM 元素（可选）
 */
function copyResult(text, originalText, successText, failText, btn) {
    let textNode = btn ? btn.querySelector('.liquidGlass-text') : null;
    let origText = textNode ? textNode.textContent : originalText;

    copyToClipboard(text, {
        onSuccess: function() {
            if (textNode) textNode.textContent = successText;
            if (btn) btn.classList.add('copy-success');
            setTimeout(function() {
                if (textNode) textNode.textContent = origText;
                if (btn) btn.classList.remove('copy-success');
            }, COPY_SUCCESS_DURATION);
        },
        onFail: function() {
            if (textNode) textNode.textContent = failText;
            setTimeout(function() {
                if (textNode) textNode.textContent = origText;
            }, COPY_SUCCESS_DURATION);
        }
    });
}

/* 暴露到全局 */
window.Clipboard = {
    copyToClipboard: copyToClipboard,
    copyResult: copyResult,
    TIMEOUT: CLIPBOARD_TIMEOUT,
    SUCCESS_DURATION: COPY_SUCCESS_DURATION
};
})();
