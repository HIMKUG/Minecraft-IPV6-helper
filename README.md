# Minecraft IPv6 Helper

> 我的世界 IPv6 联机工具 — 基于 Tauri v2 的 Windows 桌面应用，帮助 Minecraft 玩家通过 IPv6 与好友联机。

## 功能

- IPv6 连接地址生成与分享
- IPv6 网络性能诊断（延迟测试、连通性检测）
- IPv6 异常处理向导
- 历史检测记录（加密存储）
- 中英双语界面 / 亮暗主题切换
- 粘贴板一键复制连接地址
- 管理员权限自动提权（UAC）

## 技术栈

| 层 | 技术 |
|---|------|
| 前端 | 原生 HTML / CSS / JS |
| 后端 | Rust (Tauri v2) |
| 构建 | Tauri CLI + Cargo |
| 加密 | ChaCha20-Poly1305 |
| 特效 | tsparticles + Anime.js |

## 快速开始

### 环境要求

- [Node.js](https://nodejs.org/) 18+
- [Rust](https://www.rust-lang.org/) 最新稳定版
- Windows 10/11

### 开发

```bash
npm install
npm run dev
```

### 构建

```bash
npm run build
```

构建产物在 `src-tauri/target/release/` 目录。

## 项目结构

```
tauri_ipv6/
├── src/                  # 前端源码
│   ├── index.html        # 主页面
│   ├── style.css         # 样式
│   ├── app.js            # 主逻辑
│   ├── app-i18n.js       # 国际化
│   ├── clipboard.js      # 剪贴板
│   ├── liquid-glass.js   # 玻璃特效
│   ├── fx-particles.js   # 粒子特效
│   └── fx-burst-worker.js
├── src-tauri/            # Rust 后端
│   ├── src/
│   │   ├── main.rs       # 入口
│   │   └── lib.rs        # 核心逻辑
│   ├── Cargo.toml
│   └── tauri.conf.json
├── CHANGELOG.md
└── LICENSE
```

## 版本号

当前版本：**v106**

版本号规则：主版本号递增（V90 → V91 → ...），由 `Cargo.toml` 的 `version.major` 统一管理。

## 许可证

[Apache License 2.0](LICENSE)

Copyright (c) 2026 HIMKUG
