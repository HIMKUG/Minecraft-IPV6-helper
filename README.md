# Minecraft IPv6 Connection Tool

我的世界 IPv6 联机工具 — 一款帮助 Minecraft 玩家通过 IPv6 实现直连联机的桌面工具。

## 功能

- **IPv6 检测** — 检测本机 IPv6 地址和公网可用性
- **地址生成** — 自动生成带端口的 IPv6 联机地址
- **网络修复** — 快速/深度修复 IPv6 网络栈异常
- **性能诊断** — 高精度多维度网络延迟/丢包测量
- **历史记录** — 加密存储检测与诊断记录
- **双语界面** — 中文/English 完整支持
- **Liquid Glass UI** — 毛玻璃 + 粒子特效视觉效果

## 技术栈

- **前端**: 原生 HTML5 / CSS3 / JavaScript（无框架）
- **后端**: Rust + Tauri v2
- **视觉效果**: tsParticles + OffscreenCanvas Web Worker
- **加密**: ChaCha20-Poly1305 AEAD

## 构建

```bash
cd src-tauri
cargo build --release
```

产物位于 `src-tauri/target/release/ipv6-tool.exe`。

## 许可

Apache License 2.0 — 详见 [LICENSE](LICENSE)。