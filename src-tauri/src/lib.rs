use encoding_rs::GB18030;
use once_cell::sync::Lazy;
use regex::Regex;
use reqwest::blocking::Client;
use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::fs;
use std::net::TcpStream;
use std::os::windows::process::CommandExt;
use std::path::PathBuf;
use std::process::Command;
use std::sync::atomic::AtomicBool;  /* V53: repair_running 防并发 */
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

/* V62: ChaCha20-Poly1305 AEAD 加解密依赖 */
use chacha20poly1305::{ChaCha20Poly1305, Key, Nonce};
use chacha20poly1305::aead::{Aead, KeyInit};
use rand::RngCore;
use sha2::{Sha256, Digest};

const CREATE_NO_WINDOW: u32 = 0x08000000;

/* V62: 统一版本号 —— 从 Cargo.toml 主版本号派生（91.0.0 -> v91），
   单一来源：版本只在 Cargo.toml 与 tauri.conf.json 两处维护，
   前端 app-i18n.js 运行期由 getVersion() 取主版本号同步，显示不带 .0.0。 */
pub const APP_VERSION: &str = concat!("v", env!("CARGO_PKG_VERSION_MAJOR"));

/* V67: Debug 模式开关 —— 默认关闭，用户需在免责声明框上 5 秒内点击 10 次开启。
   开启后 debug_log! 宏才会写入日志文件，避免无谓的 IO 开销。 */
use std::sync::atomic::Ordering;
static DEBUG_ENABLED: AtomicBool = AtomicBool::new(false);

/* V69.1: 正则全局预编译（Lazy<Regex>），修复 #2/#3：
   - 避免每次检测/诊断都重新编译正则（性能浪费）。
   - 把热路径上的 .unwrap() 收敛为一次性初始化（首次调用时编译一次，失败才 panic）。 */
static RE_DETECT_IPV6: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?i)ipv6[^:\n]*:\s*([0-9a-fA-F:]+)").unwrap());
static RE_DETECT_ADAPTER: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?i)(?:适配器|adapter)\s+(.+?):").unwrap());
static RE_PING_TARGET: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?i)ping\s+([0-9a-fA-F:]+)").unwrap());
static RE_PING_REPLY: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?i)(?:来自|from)\s+([0-9a-fA-F:]+).*?(?:时间|time)[<=]*(\d+(?:\.\d+)?)\s*(?:ms|毫秒)").unwrap());
static RE_TIMEOUT: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?i)(?:请求超时|request timed out)").unwrap());
static RE_ICMPV6_TIME: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?i)(?:时间|time)[<=]*(\d+(?:\.\d+)?)\s*(?:ms|毫秒)").unwrap());
static RE_TRACERT_HOP: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?i)^\s*(\d+)\s").unwrap());
static RE_TRACERT_MS: Lazy<Regex> = Lazy::new(|| Regex::new(r"(\d+)\s*ms").unwrap());

/* V65: 调试日志写入文件（%APPDATA%/IPV6Tool/debug.log）
   V67: 改为按需创建 —— 只有 DEBUG_ENABLED 为 true 时才创建文件。
   日志文件每次启动截断旧内容（truncate），只保留本次会话。 */
use std::sync::Mutex;
static DEBUG_LOG: once_cell::sync::Lazy<Mutex<Option<std::fs::File>>> = once_cell::sync::Lazy::new(|| {
    Mutex::new(None)
});

/* V67: 替代 eprintln! 的调试日志宏，仅在 DEBUG_ENABLED 为 true 时写入 */
macro_rules! debug_log {
    ($($arg:tt)*) => {
        {
            if crate::DEBUG_ENABLED.load(std::sync::atomic::Ordering::Relaxed) {
                let msg = format!($($arg)*);
                if let Ok(mut guard) = crate::DEBUG_LOG.lock() {
                    if guard.is_none() {
                        let log_path = crate::get_data_dir().join("debug.log");
                        if let Ok(file) = std::fs::File::create(&log_path) {
                            *guard = Some(file);
                        }
                    }
                    if let Some(ref mut file) = *guard {
                        use std::io::Write;
                        let _ = writeln!(file, "{}", msg);
                        let _ = file.flush();
                    }
                }
            }
        }
    };
}

/* === V62: 历史记录加密存储（ChaCha20-Poly1305 AEAD） === */
/* ChaCha20-Poly1305 主密钥长度：32 字节（256 位） */
const HISTORY_KEY_LEN: usize = 32;
/* ChaCha20-Poly1305 nonce 长度：12 字节（96 位，IETF 推荐） */
const HISTORY_NONCE_LEN: usize = 12;
/* 历史记录最大条数（V62 收紧到 30） */
const MAX_HISTORY_RECORDS: usize = 30;
/* IPv6 地址截断展示长度（V62 隐私优化） */
const IPV6_DISPLAY_PREFIX: usize = 8;

/* === 超时与重试常量 === */
/* HTTP 客户端 */
const HTTP_CLIENT_TIMEOUT: Duration = Duration::from_secs(15);
const HTTP_CONNECT_TIMEOUT: Duration = Duration::from_secs(5);
const HTTP_POOL_IDLE_TIMEOUT: Duration = Duration::from_secs(30);
const TCP_KEEPALIVE_TIMEOUT: Duration = Duration::from_secs(60);

/* HTTP 测试超时 */
const HTTP_TEST_TIMEOUT: Duration = Duration::from_secs(8);
const HTTP_LARGE_FILE_TIMEOUT: Duration = Duration::from_secs(15);
const HTTP_DNS_TIMEOUT: Duration = Duration::from_secs(6);

/* 网络探测超时 */
const NAT66_TIMEOUT: Duration = Duration::from_secs(8);
const PING_TIMEOUT: Duration = Duration::from_secs(20);
const TRACERT_TIMEOUT: Duration = Duration::from_secs(45);

/* TCP 连接超时 */
const TCP_CONNECT_TIMEOUT: Duration = Duration::from_secs(5);
const TCP_HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(3);

/* 修复超时 */
const REPAIR_STEP_TIMEOUT: Duration = Duration::from_secs(60);
const REPAIR_NETSH_RESET_TIMEOUT: Duration = Duration::from_secs(90);

/* 睡眠间隔 */
const SLEEP_ONE_SECOND: Duration = Duration::from_secs(1);

/* 剪贴板重试参数 */
const CLIPBOARD_RETRY_INTERVAL: Duration = Duration::from_millis(200);
const CLIPBOARD_MAX_RETRIES: usize = 5;

/* 网络探测参数 */
const PING_COUNT: u32 = 10;
const PING_PER_HOP_TIMEOUT_MS: &str = "1500";
const TRACERT_MAX_HOPS: &str = "30";

/* 【V48 迭代1.1】reqwest 客户端单例 + 连接池
   避免每次 HTTP 测试都重建 Client（省 5次 TLS 握手 ≈ 2-3s） */
static HTTP_CLIENT: Lazy<Client> = Lazy::new(|| {
    Client::builder()
        .timeout(HTTP_CLIENT_TIMEOUT)
        .connect_timeout(HTTP_CONNECT_TIMEOUT)
        .pool_max_idle_per_host(10)
        .pool_idle_timeout(HTTP_POOL_IDLE_TIMEOUT)
        .tcp_keepalive(TCP_KEEPALIVE_TIMEOUT)
        .danger_accept_invalid_certs(cfg!(debug_assertions))  /* V53: 仅 debug 跳过证书验证 */
        .build()
        .expect("HTTP 客户端初始化失败")
});

fn cmd_no_window(program: &str) -> Command {
    let mut cmd = Command::new(program);
    cmd.creation_flags(CREATE_NO_WINDOW);
    cmd
}

/* V57/V58: 带进程级超时的命令执行，避免外部命令 hang 死阻塞线程
   超时后主动 kill 子进程，防止僵尸进程堆积 */
fn run_cmd_with_timeout(program: &str, args: &[&str], timeout: Duration) -> Result<std::process::Output, String> {
    use std::sync::{Arc, atomic::{AtomicU32, Ordering}};
    use std::sync::mpsc;
    use std::process::Stdio;

    let program = program.to_string();
    let args: Vec<String> = args.iter().map(|s| s.to_string()).collect();
    let (tx, rx) = mpsc::channel();

    /* 共享 PID：子线程在 spawn 成功后立即写入，主线程超时 kill 时按 PID 精确终止 */
    let pid_shared = Arc::new(AtomicU32::new(0));
    let pid_for_thread = Arc::clone(&pid_shared);
    let program_for_kill = program.clone();

    std::thread::spawn(move || {
        let child = match Command::new(&program)
            .creation_flags(CREATE_NO_WINDOW)
            .args(&args)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
        {
            Ok(c) => c,
            Err(e) => {
                let _ = tx.send(Err(e));
                return;
            }
        };
        pid_for_thread.store(child.id(), Ordering::SeqCst);
        let result = child.wait_with_output();
        let _ = tx.send(Ok(result));
    });

    match rx.recv_timeout(timeout) {
        Ok(Ok(Ok(out))) => Ok(out),
        Ok(Ok(Err(e))) => Err(format!("命令执行失败: {}", e)),
        Ok(Err(e)) => Err(format!("命令启动失败: {}", e)),
        Err(_) => {
            /* 尽力 kill 掉已创建的子进程：优先按 PID，获取不到再回退 /IM */
            let pid = pid_shared.load(Ordering::SeqCst);
            if pid != 0 {
                let _ = cmd_no_window("taskkill")
                    .args(["/PID", &pid.to_string(), "/T", "/F"])
                    .output();
            } else {
                let _ = cmd_no_window("taskkill")
                    .args(["/IM", &program_for_kill, "/T", "/F"])
                    .output();
            }
            Err("命令执行超时".into())
        }
    }
}

fn decode_cmd_output(output: &[u8]) -> String {
    match String::from_utf8(output.to_vec()) {
        Ok(s) => s,
        Err(_) => {
            let (cow, _, _) = GB18030.decode(output);
            cow.to_string()
        }
    }
}

fn http_get_timeout(url: &str, timeout: Duration) -> Result<String, String> {
    /* 【V48 迭代1.1】使用全局单例 HTTP 客户端，避免重复 TLS 握手 */
    let start = Instant::now();
    let resp = HTTP_CLIENT
        .get(url)
        .timeout(timeout)
        .send()
        .map_err(|e| format!("HTTP 请求失败: {}", e))?;
    let elapsed = start.elapsed();

    if !resp.status().is_success() {
        return Err(format!("HTTP 状态码: {}", resp.status()));
    }

    /* V53: 处理可能的 GZIP/Deflate 响应，用 encoding_rs 解码 */
    let bytes = resp.bytes().map_err(|e| format!("读取响应失败: {}", e))?;
    let (text_decoded, _, _) = encoding_rs::UTF_8.decode(&bytes);
    Ok(format!("{} ({}ms)", text_decoded.trim(), elapsed.as_millis()))
}

/* V69.1: 外部服务 fallback（#22）—— 按顺序尝试多个端点，返回首个成功且非空的文本。
   单点服务（如 17nas / TUNA）下线或变更时自动切换到备用端点，避免功能直接失效。 */
fn http_get_first_ok(urls: &[&str], timeout: Duration) -> Option<String> {
    for u in urls {
        match http_get_timeout(u, timeout) {
            Ok(s) if !s.trim().is_empty() => return Some(s),
            _ => debug_log!("[fallback] 端点失败，尝试下一个: {}", u),
        }
    }
    None
}

/* === V51：HEAD 请求版本，只取响应头不下载 body ===
   用于 1GB speedtest 文件的大数据包测试，避免浪费时间 */
fn http_head_timeout(url: &str, timeout: Duration) -> Result<String, String> {
    let start = Instant::now();
    let resp = HTTP_CLIENT
        .head(url)
        .timeout(timeout)
        .send()
        .map_err(|e| format!("HTTP 请求失败: {}", e))?;
    let elapsed = start.elapsed();

    if !resp.status().is_success() {
        return Err(format!("HTTP 状态码: {}", resp.status()));
    }

    /* 不读取 body，避免下载 1GB */
    let content_length = resp
        .headers()
        .get("content-length")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("?");
    Ok(format!("HEAD OK 大小={}B ({}ms)", content_length, elapsed.as_millis()))
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AddressInfo {
    pub interface: String,
    pub address: String,
    pub is_temporary: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct HopResult {
    pub hop: u32,
    pub ip: String,
    pub latencies: Vec<String>,
    pub status: String,
}

/* === v6-probe: 高精度 IPv6 网络性能诊断 === */

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct LatencyMetric {
    /// 最小延迟 (ms)
    pub min: f64,
    /// 最大延迟 (ms)
    pub max: f64,
    /// 平均延迟 (ms)
    pub mean: f64,
    /// P95 延迟 (ms)
    pub p95: f64,
    /// 抖动 Mean Deviation (ms)
    pub jitter: f64,
    /// 丢包率 (0-100)
    pub loss_rate: f64,
    /// 成功样本数
    pub samples: u32,
    /// 总探测次数
    pub total: u32,
    /// 原始延迟样本 (ms)
    pub raw: Vec<f64>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ProbeResult {
    /// ICMPv6 Echo RTT (端到端往返延迟)
    pub icmp_rtt: Option<LatencyMetric>,
    /// TCP Handshake RTT (业务建连耗时)
    pub tcp_handshake: Option<LatencyMetric>,
    /// DNS AAAA 解析耗时 (ms)
    pub dns_latency: Option<f64>,
    /// 路径跳数
    pub hop_count: u32,
    /// First Hop Latency (本机->网关, ms)
    pub first_hop: Option<f64>,
    /// Last Hop Latency (对端网关->目标, ms)
    pub last_hop: Option<f64>,
    /// 路径各跳延迟 (ms)
    pub path_latencies: Vec<f64>,
    /// 综合评估
    pub summary: String,
    /// 错误信息
    pub error: String,
    /// V55: 综合评分（0-100）
    #[serde(default)]
    pub score: u32,
    /// V55: 评分等级文字（如"优秀"/"良好"/"一般"/"较差"/"很差"）
    #[serde(default)]
    pub score_label: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DetectionStep {
    pub index: u32,
    pub status: String,       /* "success" / "fail" / "warn" / "running" */
    pub message: String,
    /// V54: 检测的网址/目标
    #[serde(default)]
    pub target_url: String,
    /// V54: 延迟情况（毫秒），无则空字符串
    #[serde(default)]
    pub latency: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DetectionResult {
    pub success: bool,
    pub addresses: Vec<AddressInfo>,
    pub error: String,
    pub steps: Vec<DetectionStep>,
    /// V52: IPv4/IPv6 访问优先级（"IPv4 优先" / "IPv6 优先" / ""）
    pub ip_priority: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct RepairLog {
    pub messages: Vec<String>,
}

/* === V50 重构：修复步骤结构（流式返回，支持前端实时显示当前修复哪一步） === */
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct RepairStep {
    /// 步骤索引（0 开始）
    pub index: u32,
    /// 步骤名称（如"启用 IPv6 组件"）
    pub name: String,
    /// 状态：pending / running / success / fail / warn
    pub status: String,
    /// 详细信息（成功/失败描述）
    pub message: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct RepairResult {
    /// 修复模式："quick" 或 "deep"
    pub mode: String,
    /// 步骤列表
    pub steps: Vec<RepairStep>,
    /// 总结：成功 N 项 / 失败 N 项
    pub summary: String,
    /// 总体成功
    pub success: bool,
}

pub struct AppState {
    /* 【V48 迭代1.5】AtomicBool 替代 Mutex<bool> */
    pub repair_running: AtomicBool,
}

#[tauri::command]
async fn detect_ipv6() -> DetectionResult {
    let mut steps = Vec::new();
    let mut addresses = Vec::new();

    steps.push(DetectionStep {
        index: 0,
        status: "running".into(),
        message: "正在枚举网卡...".into(),
        target_url: String::new(),
        latency: String::new(),
    });

    let ipconfig_result = tokio::task::spawn_blocking(|| {
        cmd_no_window("ipconfig")
            .args(["/all"])
            .output()
            .ok()
            .filter(|o| !o.stdout.is_empty())
            .map(|o| decode_cmd_output(&o.stdout))
            .unwrap_or_else(|| "IPCONFIG_FAILED".into())  /* V53: 标记命令失败 */
    }).await.unwrap_or_else(|_| "IPCONFIG_FAILED".into());

    if ipconfig_result == "IPCONFIG_FAILED" {
        steps.push(DetectionStep {
            index: 0,
            status: "fail".into(),
            message: "枚举网卡失败（ipconfig 命令无法执行）".into(),
            target_url: String::new(),
            latency: String::new(),
        });
        return DetectionResult {
            success: false,
            addresses: Vec::new(),
            error: "无法执行 ipconfig 命令，请检查系统环境".into(),
            steps,
            ip_priority: String::new(),
        };
    }

    steps.push(DetectionStep {
        index: 0,
        status: "success".into(),
        message: "枚举网卡完成".into(),
        target_url: String::new(),
        latency: String::new(),
    });
    steps.push(DetectionStep {
        index: 1,
        status: "running".into(),
        message: "正在过滤链路本地地址(fe80::)...".into(),
        target_url: String::new(),
        latency: String::new(),
    });

    let ipv6_re = &*RE_DETECT_IPV6;
    let adapter_re = &*RE_DETECT_ADAPTER;

    /* 【V48 迭代1.3】两遍解析：先并行提取所有 IPv6 候选（每行独立），再串行去重+关联adapter
       充分利用多核处理大文本（10k+行 ipconfig 输出） */
    let lines: Vec<&str> = ipconfig_result.lines().collect();
    let mut adapter_map: Vec<(usize, String)> = Vec::with_capacity(lines.len());
    for (idx, line) in lines.iter().enumerate() {
        if let Some(cap) = adapter_re.captures(line) {
            adapter_map.push((idx, cap[1].to_string()));
        }
    }

    let candidates: Vec<(usize, String, bool)> = lines
        .par_iter()
        .enumerate()
        .filter_map(|(idx, line)| {
            let cap = ipv6_re.captures(line)?;
            let addr = cap[1].to_string();
            let line_lower = line.to_lowercase();
            let is_temp = line_lower.contains("临时") || line_lower.contains("temporary");
            Some((idx, addr, is_temp))
        })
        .collect();

    let mut current_adapter = String::new();
    let mut seen = HashSet::new();
    let mut adapter_idx = 0usize;
    for (idx, addr, is_temp) in candidates {
        /* 找到 idx 之前最近的 adapter 名（线性扫描在小数据集上比二分快） */
        while adapter_idx < adapter_map.len() && adapter_map[adapter_idx].0 < idx {
            current_adapter = adapter_map[adapter_idx].1.clone();
            adapter_idx += 1;
        }
        let clean = addr.split('%').next().unwrap_or(&addr).to_lowercase();
        /* V52: 排除链路本地(fe80)、ULA(fc/fd)、组播(ff)、回环(::1) — 仅保留公网 IPv6 */
        let is_public = !clean.starts_with("fe80")
            && !clean.starts_with("fc")
            && !clean.starts_with("fd")
            && !clean.starts_with("ff")
            && clean != "::1";
        if is_public && seen.insert(clean.clone()) {
            addresses.push(AddressInfo {
                interface: current_adapter.clone(),
                address: addr,
                is_temporary: is_temp,
            });
        }
    }

    steps.push(DetectionStep {
        index: 1,
        status: "success".into(),
        message: "过滤链路本地地址完成".into(),
        target_url: String::new(),
        latency: String::new(),
    });
    steps.push(DetectionStep {
        index: 2,
        status: "running".into(),
        message: "正在提取公网 IPv6 地址...".into(),
        target_url: String::new(),
        latency: String::new(),
    });

    if addresses.is_empty() {
        steps.push(DetectionStep {
            index: 2,
            status: "fail".into(),
            message: "未检测到公网 IPv6 地址".into(),
            target_url: String::new(),
            latency: String::new(),
        });
        return DetectionResult {
            success: false,
            addresses,
            error: "未检测到公网 IPv6 地址".into(),
            steps,
            ip_priority: String::new(),
        };
    }
    let ip_list: Vec<String> = addresses.iter().take(3).map(|a| a.address.clone()).collect();
    steps.push(DetectionStep {
        index: 2,
        status: "success".into(),
        message: format!("已提取公网 IPv6 地址: {}", ip_list.join(", ")),
        target_url: String::new(),
        latency: String::new(),
    });

    /* === V51 优化：所有 HTTP 测试切换为清华 TUNA 国内 IPv6 资源 ===
       验证（curl -4/-6 测试结果）：
       - mirrors4.tuna.tsinghua.edu.cn : A=101.6.15.130，AAAA 不可解析 (只 IPv4)
       - mirrors6.tuna.tsinghua.edu.cn : AAAA=2402:f000:1:400::2，A 不可解析 (只 IPv6)
       - mirrors.tuna.tsinghua.edu.cn  : A+AAAA 双栈
       - mirrors.tuna.tsinghua.edu.cn/speedtest/1000mb.bin : 1GB 大文件 (用 HEAD 避免下载) */
    let http_tests = vec![
        (3, "IPv4 域名连接测试", "https://mirrors4.tuna.tsinghua.edu.cn/", HTTP_TEST_TIMEOUT, false),
        (4, "IPv6 域名连接测试", "https://mirrors6.tuna.tsinghua.edu.cn/", HTTP_TEST_TIMEOUT, true),
        (5, "双栈域名连接测试", "https://mirrors.tuna.tsinghua.edu.cn/", HTTP_TEST_TIMEOUT, true),
        (6, "双栈域名大数据包传输", "https://mirrors.tuna.tsinghua.edu.cn/speedtest/1000mb.bin", HTTP_LARGE_FILE_TIMEOUT, false),
        (7, "IPv6 大数据包传输", "https://mirrors6.tuna.tsinghua.edu.cn/speedtest/1000mb.bin", HTTP_LARGE_FILE_TIMEOUT, false),
        /* V69.1: 备用镜像（#22）—— TUNA 不可达时仍可验证 IPv4/双栈连通性 */
        (8, "IPv4 域名连接测试(备用)", "https://mirrors.aliyun.com/", HTTP_TEST_TIMEOUT, false),
        (9, "双栈域名连接测试(备用)", "https://mirrors.aliyun.com/", HTTP_TEST_TIMEOUT, true),
    ];

    let http_results = tokio::task::spawn_blocking(move || {
        http_tests.par_iter().map(|&(index, name, url, timeout, is_required)| {
            /* V51: 大数据包测试用 HEAD 请求，避免下载 1GB 浪费时间 */
            let result = if url.contains("speedtest") {
                http_head_timeout(url, timeout)
            } else {
                http_get_timeout(url, timeout)
            };
            /* V54: 保留 url 用于 DetectionStep.target_url */
            (index, name, url, result, is_required)
        }).collect::<Vec<_>>()
    }).await.unwrap_or_default();

    /* V52 Bug 修复: 如果 spawn_blocking panic 导致 http_results 为空，
       原 code 会跳过 for 循环，ipv6_ok/ds_ok 仍为 true，最终误报 success。
       修复：空集合直接判失败 */
    if http_results.is_empty() {
        steps.push(DetectionStep {
            index: 3,
            status: "fail".into(),
            message: "HTTP 测试任务异常终止（spawn_blocking panic）".into(),
            target_url: String::new(),
            latency: String::new(),
        });
        return DetectionResult {
            success: false,
            addresses: Vec::new(),  // V53: 清空避免前后矛盾
            error: "HTTP 测试任务异常终止".into(),
            steps,
            ip_priority: String::new(),
        };
    }

    let mut ipv6_ok = true;
    let mut ds_ok = true;
    let mut required_all_ok = true;

    for &(index, name, url, ref result, is_required) in &http_results {
        steps.push(DetectionStep {
            index,
            status: "running".into(),
            message: format!("{}...", name),
            target_url: url.to_string(),  /* V54 */
            latency: String::new(),
        });

        match result {
            Ok(res) => {
                let time = res.split(' ').last().unwrap_or("").trim_end_matches(')');
                steps.push(DetectionStep {
                    index,
                    status: "success".into(),
                    message: format!("{} 成功 {}", name, time),
                    target_url: url.to_string(),  /* V54 */
                    latency: time.to_string(),    /* V54 */
                });
            }
            Err(e) => {
                if is_required {
                    steps.push(DetectionStep {
                        index,
                        status: "fail".into(),
                        message: format!("{} 失败: {}", name, e),
                        target_url: url.to_string(),  /* V54 */
                        latency: String::new(),
                    });
                    if index == 4 { ipv6_ok = false; }
                    if index == 5 { ds_ok = false; }
                    required_all_ok = false;
                } else {
                    steps.push(DetectionStep {
                        index,
                        status: "warn".into(),
                        message: format!("{} 超时: {}", name, e),
                        target_url: url.to_string(),  /* V54 */
                        latency: String::new(),
                    });
                }
            }
        }
    }

    /* === V52 重构：NAT66 + IPv4/IPv6 优先级检测（独立异步，8s 上限） ===
       旧问题（V51）：NAT66 复用 mirrors6.tuna 的 HTTP 响应体提取外部 IP，
       但 mirrors6 返回 HTML 重定向内容，不是纯 IP，导致 NAT66 检测无效。
       V52 修复：改用 17nas.com 系列服务（ipw.cn 已被攻击无法使用）：
       - v6.17nas.com  → 返回纯文本外部 IPv6 地址（用于 NAT66 比对）
       - ip.17nas.com  → 返回当前连接使用的 IP（IPv4 或 IPv6，判断访问优先级）
       并行请求两服务（rayon::join），8s 超时上限，超时跳过不卡住 */
    let nat66_handle = {
        let addresses_clone = addresses.clone();
        tokio::spawn(async move {
            let inner = tokio::task::spawn_blocking(move || {
                /* 并行请求外部 IPv6 回声服务与当前连接 IP 服务（均为纯文本响应）。
                   V69.1: 各自带 fallback 端点（#22），主服务下线时自动切换 */
                let (v6_res, prio_res) = rayon::join(
                    || http_get_first_ok(
                        &["https://v6.17nas.com/", "https://6.ip.me/"],
                        HTTP_DNS_TIMEOUT,
                    ),
                    || http_get_first_ok(
                        &["https://ip.17nas.com/", "https://ip.me/"],
                        HTTP_DNS_TIMEOUT,
                    ),
                );

                /* 解析外部 IPv6 地址 */
                let mut external_ip = String::new();
                let mut local_match = false;
                let mut is_ula = false;
                if let Some(res) = v6_res {
                    /* 响应格式："2408:8207:...::1 (123ms)"，取首个空格前的纯 IP */
                    let returned_ip = res.split(' ').next().unwrap_or("").trim().to_lowercase();
                    if returned_ip.contains(':') {
                        external_ip = returned_ip.clone();
                        is_ula = external_ip.starts_with("fc") || external_ip.starts_with("fd");
                        local_match = addresses_clone.iter().any(|a| {
                            let local = a.address.split('%').next().unwrap_or(&a.address).to_lowercase();
                            local == external_ip
                        });
                    }
                }

                /* 解析访问优先级：ip.17nas.com 返回当前连接所用 IP */
                let mut ip_priority = String::new();
                if let Some(res) = prio_res {
                    let returned_ip = res.split(' ').next().unwrap_or("").trim().to_lowercase();
                    if returned_ip.contains(':') {
                        ip_priority = "IPv6 优先".into();
                    } else if returned_ip.contains('.') {
                        ip_priority = "IPv4 优先".into();
                    }
                }

                (external_ip, local_match, is_ula, ip_priority)
            });
            /* NAT66 超时上限，超时返回 None 不卡住 */
            match tokio::time::timeout(NAT66_TIMEOUT, inner).await {
                Ok(Ok(tuple)) => Some(tuple),
                _ => None,
            }
        })
    };

    /* 主流程：先推 running，await NAT66 后再推最终结果 */
    steps.push(DetectionStep {
        index: 10,
        status: "running".into(),
        message: "NAT66 + 优先级检测中（独立异步，超时上限）...".into(),
        target_url: "v6.17nas.com".into(),  /* V54 */
        latency: String::new(),
    });

    let nat66_outcome: Option<(String, bool, bool, String)> = match nat66_handle.await {
        Ok(Some(tuple)) => Some(tuple),
        _ => None,
    };

    /* 拆出 ip_priority，单独传递到最终结果 */
    let detected_ip_priority = nat66_outcome
        .as_ref()
        .map(|(_, _, _, p)| p.clone())
        .unwrap_or_default();

    match nat66_outcome {
        Some((ip, _local_match, true, _)) if !ip.is_empty() => {
            /* ULA 区间警告 */
            steps.push(DetectionStep {
                index: 10,
                status: "warn".into(),
                message: format!("NAT66 警告: 外部返回地址 {} 属于 ULA 区间 (fc00::/7)", ip),
                target_url: "v6.17nas.com".into(),  /* V54 */
                latency: String::new(),
            });
        }
        Some((ip, false, false, _)) if !ip.is_empty() => {
            /* 外部 IP 与本地不一致，但不是 ULA → 视为运营商转发，通过 */
            steps.push(DetectionStep {
                index: 10,
                status: "success".into(),
                message: format!("NAT66 检测通过（外部 IP {} 与本地不同，运营商转发模式，国内常见）", ip),
                target_url: "v6.17nas.com".into(),  /* V54 */
                latency: String::new(),
            });
        }
        Some((_, _, _, _)) => {
            /* 一致或 IP 为空 → 通过 */
            steps.push(DetectionStep {
                index: 10,
                status: "success".into(),
                message: "NAT66 检测通过".into(),
                target_url: "v6.17nas.com".into(),  /* V54 */
                latency: String::new(),
            });
        }
        None => {
            /* 超时/异常 → 跳过（不再卡住） */
            steps.push(DetectionStep {
                index: 10,
                status: "warn".into(),
                message: "NAT66 + 优先级检测跳过（独立异步超时或异常）".into(),
                target_url: "v6.17nas.com".into(),  /* V54 */
                latency: String::new(),
            });
        }
    }

    if !ipv6_ok {
        return DetectionResult {
            success: false,
            addresses,
            error: "IPv6 域名连接测试失败，请检查网络设置".into(),
            steps,
            ip_priority: detected_ip_priority,
        };
    }

    if !ds_ok {
        return DetectionResult {
            success: false,
            addresses,
            error: "双栈域名连接测试失败，IPv6 公网可用性存在问题".into(),
            steps,
            ip_priority: detected_ip_priority,
        };
    }

    DetectionResult {
        success: required_all_ok,
        addresses,
        error: String::new(),
        steps,
        ip_priority: detected_ip_priority,
    }
}

#[tauri::command]
fn check_ipv6_connectivity() -> bool {
    /* V52: 改用国内 DNS（中科院 240c::6666）替代 Google DNS，
       Google DNS 在国内常被屏蔽导致连通性误判 */
    let addr = match "[240c::6666]:53".parse::<std::net::SocketAddr>() {
        Ok(a) => a,
        Err(_) => return false,
    };
    TcpStream::connect_timeout(&addr, TCP_CONNECT_TIMEOUT).is_ok()
}

#[tauri::command]
fn format_ipv6_address(addr: String, port: u16) -> Result<String, String> {
    let addr = addr.trim();
    /* Bug 修复：先去除可能存在的方括号再校验，否则 [::1] 格式会被 parse 拒绝，
       导致下面方括号处理分支永远不可达（死代码） */
    let inner = addr
        .strip_prefix('[')
        .and_then(|s| s.strip_suffix(']'))
        .unwrap_or(addr);
    /* V57: 真正验证 IPv6 合法性，无效输入返回错误 */
    if inner.parse::<std::net::Ipv6Addr>().is_err() {
        return Err(format!("无效的 IPv6 地址: {}", addr));
    }
    Ok(format!("[{}]:{}", inner, port))
}

/* Bug 修复：windows 0.58 crate 未导出 GlobalFree，用 FFI 直接声明 kernel32 函数 */
extern "system" {
    fn GlobalFree(hmem: *mut std::ffi::c_void) -> *mut std::ffi::c_void;
}

#[tauri::command]
async fn copy_to_clipboard(text: String) -> Result<(), String> {
    let task = tauri::async_runtime::spawn_blocking(move || {
        use windows::Win32::System::DataExchange::{
            OpenClipboard, CloseClipboard, EmptyClipboard, SetClipboardData,
        };
        use windows::Win32::System::Memory::{
            GlobalAlloc, GlobalLock, GlobalUnlock, GMEM_MOVEABLE,
        };
        use windows::Win32::Foundation::HANDLE;

        // Windows 剪贴板格式常量：CF_UNICODETEXT = 13
        const CF_UNICODETEXT: u32 = 13u32;

        // 最多重试 5 次，每次间隔 200ms，处理剪贴板被其他进程锁定的情况
        let mut last_err = String::new();
        for attempt in 0..5u32 {
            unsafe {
                // OpenClipboard(NULL) 允许任何窗口访问
                if OpenClipboard(None).is_err() {
                    last_err = format!("OpenClipboard 失败（尝试 {}/5）", attempt + 1);
                    std::thread::sleep(CLIPBOARD_RETRY_INTERVAL);
                    continue;
                }

                // 清空当前剪贴板内容
                if let Err(e) = EmptyClipboard() {
                    last_err = format!("EmptyClipboard 失败: {}", e);
                    let _ = CloseClipboard();
                    std::thread::sleep(CLIPBOARD_RETRY_INTERVAL);
                    continue;
                }

                // 将文本编码为 UTF-16LE（Windows 剪贴板 CF_UNICODETEXT 格式）
                let mut wide: Vec<u16> = text.encode_utf16().collect();
                wide.push(0u16); // null terminator

                let byte_len = wide.len() * 2;

                // 分配全局内存
                let h_mem = match GlobalAlloc(GMEM_MOVEABLE, byte_len) {
                    Ok(h) => h,
                    Err(e) => {
                        last_err = format!("GlobalAlloc 失败: {}", e);
                        let _ = CloseClipboard();
                        std::thread::sleep(CLIPBOARD_RETRY_INTERVAL);
                        continue;
                    }
                };

                // 锁定内存，写入数据（windows 0.58 直接返回 *mut c_void）
                let ptr = GlobalLock(h_mem);
                if ptr.is_null() {
                    last_err = format!("GlobalLock 失败（尝试 {}/5）", attempt + 1);
                    /* Bug 修复：GlobalLock 失败时 h_mem 仍由调用方持有，必须释放避免内存泄漏 */
                    let _ = GlobalFree(h_mem.0);
                    let _ = CloseClipboard();
                    std::thread::sleep(CLIPBOARD_RETRY_INTERVAL);
                    continue;
                }

                std::ptr::copy_nonoverlapping(wide.as_ptr() as *const u8, ptr as *mut u8, byte_len);
                let _ = GlobalUnlock(h_mem);

                // 设置剪贴板数据：HGLOBAL → HANDLE
                if SetClipboardData(CF_UNICODETEXT, HANDLE(h_mem.0)).is_err() {
                    last_err = format!("SetClipboardData 失败（尝试 {}/5）", attempt + 1);
                    /* Bug 修复：SetClipboardData 失败时所有权未转移给系统，必须释放 h_mem 避免内存泄漏 */
                    let _ = GlobalFree(h_mem.0);
                    let _ = CloseClipboard();
                    std::thread::sleep(CLIPBOARD_RETRY_INTERVAL);
                    continue;
                }

                let _ = CloseClipboard();
                return Ok(());
            }
        }
        Err(format!("复制到剪贴板失败: {}", last_err))
    });

    // JS 端调用超时保护：TCP_HANDSHAKE_TIMEOUT 内必须完成
    match tokio::time::timeout(TCP_HANDSHAKE_TIMEOUT, task).await {
        Ok(Ok(Ok(()))) => Ok(()),
        Ok(Ok(Err(e))) => Err(e),
        Ok(Err(e)) => Err(format!("任务执行失败: {}", e)),
        Err(_) => Err("复制到剪贴板超时，请重试".into()),
    }
}

#[tauri::command]
fn is_admin() -> bool {
    // V53: 开发环境跳过管理员检查，避免误报
    #[cfg(debug_assertions)]
    {
        return true;
    }
    #[cfg(not(debug_assertions))]
    unsafe {
        windows::Win32::UI::Shell::IsUserAnAdmin().as_bool()
    }
}

#[tauri::command]
fn close_window(window: tauri::Window) -> Result<(), String> {
    window.close().map_err(|e| e.to_string())
}

#[tauri::command]
fn minimize_window(window: tauri::Window) -> Result<(), String> {
    window.minimize().map_err(|e| e.to_string())
}

/* === V50 重构：修复流程返回 RepairResult，包含流式步骤 === */

/* V58: 辅助：尝试执行一个命令并返回是否成功（带 60s 超时，防止修复命令 hang 死） */
fn run_repair_step(name: &str, program: &str, args: &[&str]) -> bool {
    debug_log!("[repair] 执行步骤 `{}`: {} {:?}", name, program, args);
    match run_cmd_with_timeout(program, args, REPAIR_STEP_TIMEOUT) {
        Ok(out) => {
            let stderr = String::from_utf8_lossy(&out.stderr).to_lowercase();
            /* V53: 即使 status.success，stderr 含"error"/"失败" 也算失败 */
            let has_error = stderr.contains("error") || stderr.contains("失败") || stderr.contains("cannot");
            out.status.success() && !has_error
        }
        _ => false,
    }
}

/* V94: 辅助函数：添加修复步骤并更新状态（封装重复代码） */
fn add_repair_step(
    steps: &mut Vec<RepairStep>,
    idx: &mut usize,
    name: &str,
    program: &str,
    args: &[&str],
    success_msg: &str,
    fail_msg: &str,
    status_on_fail: &str,
) -> usize {
    steps.push(RepairStep {
        index: (*idx) as u32,
        name: name.into(),
        status: "running".into(),
        message: format!("正在{}...", name).into(),
    });
    let result = run_repair_step(name, program, args);
    let status = if result { "success" } else { status_on_fail }.into();
    let message = if result {
        success_msg.into()
    } else {
        fail_msg.into()
    };
    steps[*idx].status = status;
    steps[*idx].message = message;
    *idx += 1;
    steps.len() - 1
}

/* V94: 辅助函数：添加深度修复步骤（封装手动创建 RepairStep 的重复代码） */
fn add_deep_repair_step(
    steps: &mut Vec<RepairStep>,
    idx: &mut usize,
    name: &str,
    message: &str,
    status: &str,
) -> usize {
    steps.push(RepairStep {
        index: (*idx) as u32,
        name: name.into(),
        status: status.into(),
        message: message.into(),
    });
    *idx += 1;
    steps.len() - 1
}

/* V94: 辅助函数：执行 netsh reset 类命令并更新修复步骤（封装重复的 match 模式）
   用于深度修复中执行 netsh int ipv6 reset / netsh winsock reset 等同类操作 */
fn exec_netsh_reset_step(
    steps: &mut Vec<RepairStep>,
    idx: &mut usize,
    name: &str,
    running_msg: &str,
    args: &[&str],
    success_msg: &str,
    program: &str,
) {
    add_deep_repair_step(steps, idx, name, running_msg, "running");
    let mut cmd_success = false;
    let cmd_msg: String;
    match run_cmd_with_timeout(program, args, REPAIR_NETSH_RESET_TIMEOUT) {
        Ok(out) => {
            cmd_success = out.status.success();
            if cmd_success {
                cmd_msg = success_msg.into();
            } else {
                let stderr = String::from_utf8_lossy(&out.stderr);
                let stdout = String::from_utf8_lossy(&out.stdout);
                cmd_msg = format!("重置返回非零（需管理员权限）\n{}\n{}", stdout, stderr);
            }
        }
        Err(e) => {
            cmd_msg = format!("执行失败: {}", e);
        }
    }
    /* idx 在 add_deep_repair_step 中已自增，需回退 1 以更新刚添加的步骤 */
    let prev = *idx - 1;
    steps[prev].status = if cmd_success { "success" } else { "fail" }.into();
    steps[prev].message = cmd_msg;
}

fn run_quick_repair_internal() -> Vec<RepairStep> {
    let mut steps: Vec<RepairStep> = Vec::new();
    let mut idx: usize = 0;

    /* 步骤 1: 启用所有网卡的 IPv6 组件 */
    let ps_enable = r#"Get-NetAdapterBinding -ComponentID "ms_tcpip6" | ForEach-Object { Enable-NetAdapterBinding -Name $_.Name -ComponentID "ms_tcpip6" -ErrorAction SilentlyContinue }"#;
    add_repair_step(
        &mut steps,
        &mut idx,
        "启用所有网卡的 IPv6 组件",
        "powershell",
        &["-NoProfile", "-Command", ps_enable],
        "IPv6 组件已启用",
        "启用失败，请检查管理员权限",
        "warn",
    );

    /* 步骤 2: 设置 iphlpsvc 服务为自动启动 */
    add_repair_step(
        &mut steps,
        &mut idx,
        "设置 IP Helper 服务",
        "sc",
        &["config", "iphlpsvc", "start=", "auto"],
        "iphlpsvc 服务已设为自动启动",
        "设置 iphlpsvc 失败",
        "warn",
    );

    /* 步骤 3: 启动 IP Helper 服务 */
    add_repair_step(
        &mut steps,
        &mut idx,
        "启动 IP Helper 服务",
        "net",
        &["start", "iphlpsvc"],
        "iphlpsvc 已启动",
        "启动失败（可能已运行）",
        "warn",
    );

    /* 步骤 4: 设置 DHCP 服务为自动启动 */
    add_repair_step(
        &mut steps,
        &mut idx,
        "设置 DHCP 客户端服务",
        "sc",
        &["config", "dhcp", "start=", "auto"],
        "dhcp 服务已设为自动启动",
        "设置 dhcp 失败",
        "warn",
    );

    /* 步骤 5: 修改注册表 DisabledComponents=0（启用 IPv6） */
    let ps_reg = r#"
        $path = "HKLM:\SYSTEM\CurrentControlSet\Services\TCPIP6\Parameters"
        if (-not (Test-Path $path)) { New-Item -Path $path -Force | Out-Null }
        Set-ItemProperty -Path $path -Name "DisabledComponents" -Value 0 -Type DWord -Force
    "#;
    add_repair_step(
        &mut steps,
        &mut idx,
        "修改注册表启用 IPv6",
        "powershell",
        &["-NoProfile", "-Command", ps_reg],
        "注册表 DisabledComponents=0 已设置",
        "注册表修改失败，可能权限不足",
        "fail",
    );

    /* 步骤 6: 重置 Teredo 隧道 */
    add_repair_step(
        &mut steps,
        &mut idx,
        "重置 Teredo 隧道",
        "netsh",
        &["interface", "teredo", "set", "state", "default"],
        "Teredo 隧道已重置",
        "Teredo 隧道重置失败（国内运营商一般无 Teredo，可忽略）",
        "warn",
    );

    /* 步骤 7: 重置 ISATAP 隧道 */
    add_repair_step(
        &mut steps,
        &mut idx,
        "重置 ISATAP 隧道",
        "netsh",
        &["interface", "isatap", "set", "state", "default"],
        "ISATAP 隧道已重置",
        "ISATAP 隧道重置失败（国内运营商一般无 ISATAP，可忽略）",
        "warn",
    );

    /* === V52 新增 步骤 8: 设置 IPv6 地址为自动获取（DHCPv6/SLAAC） ===
       对应手动操作：IPv6 属性 → "自动获取 IPv6 地址"
       实现：启用 DHCPv6 + 启用路由器发现（RA-based SLAAC） */
    let ps_addr_auto = r#"Get-NetAdapter -Physical | Where-Object {$_.Status -eq "Up"} | ForEach-Object {
        Set-NetIPInterface -InterfaceAlias $_.Name -AddressFamily IPv6 -Dhcp Enabled -ErrorAction SilentlyContinue
        Set-NetIPInterface -InterfaceAlias $_.Name -AddressFamily IPv6 -RouterDiscovery Enabled -ErrorAction SilentlyContinue
    }"#;
    add_repair_step(
        &mut steps,
        &mut idx,
        "设置 IPv6 地址为自动获取",
        "powershell",
        &["-NoProfile", "-Command", ps_addr_auto],
        "IPv6 地址已设为自动获取（DHCPv6/SLAAC 已启用）",
        "设置失败，可能需要手动在网卡属性中配置",
        "warn",
    );

    /* === V52 新增 步骤 9: 设置 IPv6 DNS 服务器为自动获取 ===
       对应手动操作：IPv6 属性 → "自动获取 DNS 服务器地址"
       实现：ResetServerAddresses 清空静态 DNS，恢复 RA/DHCPv6 下发的 DNS */
    let ps_dns_auto = r#"Get-NetAdapter -Physical | Where-Object {$_.Status -eq "Up"} | ForEach-Object {
        Set-DnsClientServerAddress -InterfaceAlias $_.Name -ResetServerAddresses -ErrorAction SilentlyContinue
    }"#;
    add_repair_step(
        &mut steps,
        &mut idx,
        "设置 IPv6 DNS 为自动获取",
        "powershell",
        &["-NoProfile", "-Command", ps_dns_auto],
        "IPv6 DNS 已设为自动获取",
        "DNS 重置失败，可能需要手动配置",
        "warn",
    );

    /* 步骤 10: 刷新 DNS 缓存 */
    add_repair_step(
        &mut steps,
        &mut idx,
        "刷新 DNS 缓存",
        "ipconfig",
        &["/flushdns"],
        "DNS 缓存已刷新",
        "刷新 DNS 失败",
        "warn",
    );

    steps
}

#[tauri::command]
async fn run_quick_repair(app: tauri::AppHandle) -> Result<RepairResult, String> {
    /* V52: 使用 AppState.repair_running 防止并发修复
       原 Bug#15：repair_running 字段从未使用，用户快速双击会触发两次修复
       用 AppHandle（'static）替代 State<'_>，避免 async 命令的 lifetime 问题 */
    use tauri::Manager;
    let state = app.state::<AppState>();
    if state.repair_running.compare_exchange(
        false, true,
        std::sync::atomic::Ordering::SeqCst,
        std::sync::atomic::Ordering::SeqCst,
    ).is_err() {
        return Ok(RepairResult {
            mode: "quick".into(),
            steps: vec![],
            summary: "修复正在进行中，请勿重复点击".into(),
            success: false,
        });
    }

    /* 确保无论成功/失败/panic 都重置标志 */
    let result = run_quick_repair_impl().await;
    state.repair_running.store(false, std::sync::atomic::Ordering::SeqCst);
    Ok(result)
}

/// 实际的快速修复逻辑（从 run_quick_repair 拆出，便于加锁包裹）
async fn run_quick_repair_impl() -> RepairResult {
    let steps = tauri::async_runtime::spawn_blocking(run_quick_repair_internal)
        .await
        .unwrap_or_default();

    let succ = steps.iter().filter(|s| s.status == "success").count();
    let fail = steps.iter().filter(|s| s.status == "fail").count();
    let warn = steps.iter().filter(|s| s.status == "warn").count();
    let total = steps.len();
    let success = fail == 0;

    let summary = if fail == 0 && succ == total {
        format!("✓ 快速修复完成，全部 {} 项成功", total)
    } else if fail == 0 {
        format!("✓ 快速修复完成：{} 项成功，{} 项警告（部分组件可能未安装，可忽略）", succ, warn)
    } else {
        format!("⚠ 快速修复完成：{} 项成功，{} 项失败，{} 项警告（请检查管理员权限）", succ, fail, warn)
    };

    RepairResult {
        mode: "quick".into(),
        steps,
        summary,
        success,
    }
}

#[tauri::command]
async fn run_deep_repair(app: tauri::AppHandle) -> Result<RepairResult, String> {
    /* V52: 同 run_quick_repair，使用 repair_running 防并发 */
    use tauri::Manager;
    let state = app.state::<AppState>();
    if state.repair_running.compare_exchange(
        false, true,
        std::sync::atomic::Ordering::SeqCst,
        std::sync::atomic::Ordering::SeqCst,
    ).is_err() {
        return Ok(RepairResult {
            mode: "deep".into(),
            steps: vec![],
            summary: "修复正在进行中，请勿重复点击".into(),
            success: false,
        });
    }

    let result = run_deep_repair_impl().await;
    state.repair_running.store(false, std::sync::atomic::Ordering::SeqCst);
    Ok(result)
}

/// 实际的深度修复逻辑（从 run_deep_repair 拆出，便于加锁包裹）
async fn run_deep_repair_impl() -> RepairResult {
    /* 深度修复 = 快速修复 + 协议栈重置 */
    let quick_steps = tauri::async_runtime::spawn_blocking(run_quick_repair_internal)
        .await
        .unwrap_or_default();

    let mut steps = quick_steps;
    let mut idx: usize = steps.len();

    /* 深度修复步骤 1: 重置 IPv6 协议栈（必须单独执行，不要混用旧命令）*/
    exec_netsh_reset_step(
        &mut steps,
        &mut idx,
        "重置 IPv6 协议栈",
        "正在执行 netsh int ipv6 reset（请勿关闭此窗口）...",
        &["int", "ipv6", "reset"],
        "IPv6 协议栈已重置，需重启计算机生效",
        "netsh",
    );

    /* 深度修复步骤 2: 重置 Winsock 目录 */
    exec_netsh_reset_step(
        &mut steps,
        &mut idx,
        "重置 Winsock 目录",
        "正在执行 netsh winsock reset...",
        &["winsock", "reset"],
        "Winsock 目录已重置，需重启计算机生效",
        "netsh",
    );

    /* 深度修复步骤 3: 验证网络接口状态 */
    let verify_ok = tauri::async_runtime::spawn_blocking(check_ipv6_connectivity)
        .await
        .unwrap_or(false);
    let verify_status = if verify_ok { "success" } else { "warn" }.into();
    let verify_message = if verify_ok {
        "网络接口验证通过".into()
    } else {
        "验证未通过，请重启计算机后重试检测".into()
    };
    steps.push(RepairStep {
        index: idx as u32,
        name: "验证网络接口状态".into(),
        status: verify_status,
        message: verify_message,
    });
    idx += 1;

    let succ = steps.iter().filter(|s| s.status == "success").count();
    let fail = steps.iter().filter(|s| s.status == "fail").count();
    let warn = steps.iter().filter(|s| s.status == "warn").count();
    let _total = steps.len();
    let success = fail == 0;

    let summary = if fail == 0 {
        format!("✓ 深度修复完成：{} 项成功，{} 项警告\n⚠ 重要提示：必须重启计算机后才能生效", succ, warn)
    } else {
        format!("⚠ 深度修复完成：{} 项成功，{} 项失败，{} 项警告\n请以管理员身份运行本软件后重试", succ, fail, warn)
    };

    RepairResult {
        mode: "deep".into(),
        steps,
        summary,
        success,
    }
}

#[tauri::command]
fn open_url(url: String) -> Result<(), String> {
    /* V52 安全修复：原实现用 cmd /c start <url>，存在命令注入风险
       （如 url 含 & | 等元字符可拼接任意命令）。
       改用 ShellExecuteW 直接传 URL 给系统默认浏览器，不经 shell 解析。 */
    use std::os::windows::ffi::OsStrExt;
    use windows::Win32::UI::Shell::ShellExecuteW;
    use windows::core::PCWSTR;

    /* 协议白名单：仅允许 http/https，防止 file:// 或其他危险协议 */
    let url_lower = url.to_lowercase();
    if !url_lower.starts_with("http://") && !url_lower.starts_with("https://") {
        return Err("仅支持 http/https 协议".into());
    }

    let open_w: Vec<u16> = std::ffi::OsStr::new("open")
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    let url_w: Vec<u16> = std::ffi::OsStr::new(&url)
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();

    unsafe {
        let hinst = ShellExecuteW(
            None,
            PCWSTR(open_w.as_ptr()),
            PCWSTR(url_w.as_ptr()),
            PCWSTR::null(),
            PCWSTR::null(),
            windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL,
        );
        /* ShellExecuteW 返回 HINSTANCE <= 32 表示失败 */
        if hinst.0 as usize <= 32 {
            return Err("打开 URL 失败".into());
        }
    }
    Ok(())
}

#[tauri::command]
#[deprecated(note = "已废弃，使用 run_v6_probe")]
async fn run_tracert_parse(target: String) -> Result<Vec<HopResult>, String> {
    /* 用 spawn_blocking 把同步阻塞的 ping 放到独立线程，
       避免卡住 Tauri 的 async runtime（解决 UI 卡顿根源） */
    tauri::async_runtime::spawn_blocking(move || {
        let output = cmd_no_window("ping")
            .args(["-6", "-n", "3", "-w", "2000", &target])
            .output()
            .map_err(|e| format!("ping 执行失败: {}", e))?;

        let stdout = decode_cmd_output(&output.stdout);

        let target_re = &*RE_PING_TARGET;
        let target_ip = target_re
            .captures(&stdout)
            .map(|c| c[1].to_string())
            .unwrap_or_else(|| target.clone());

        let reply_re = &*RE_PING_REPLY;
        let timeout_re = &*RE_TIMEOUT;

        let mut latencies = Vec::new();
        for line in stdout.lines() {
            if let Some(cap) = reply_re.captures(line) {
                latencies.push(format!("{} ms", &cap[2]));
            } else if timeout_re.is_match(line) {
                latencies.push("*".into());
            }
        }

        if latencies.is_empty() {
            return Err("目标不可达，请检查 IPv6 地址和防火墙设置".into());
        }

        while latencies.len() < 3 {
            latencies.push("*".into());
        }

        let all_timeout = latencies.iter().all(|l| l == "*");
        let status = if all_timeout { "超时" } else { "成功" };

        Ok(vec![HopResult {
            hop: 1,
            ip: target_ip,
            latencies,
            status: status.into(),
        }])
    })
    .await
    .map_err(|e| format!("任务执行失败: {}", e))?
}

/* ================== v6-probe: 高精度 IPv6 网络性能诊断 ================== */

/// 计算统计指标：Min / Max / Mean / P95 / Jitter / Loss
fn compute_metric(samples: Vec<Option<f64>>, total: u32) -> LatencyMetric {
    let ok: Vec<f64> = samples.iter().filter_map(|x| *x).collect();
    let samples_n = ok.len() as u32;
    /* Bug 修复：当 ping 输出有多余匹配行时 ok.len() 可能超过 total，
       导致 1.0 - ok.len()/total 为负数，产生负丢包率。用 .min() 钳制 */
    let loss_rate = if total == 0 { 0.0 } else { (1.0 - ok.len().min(total as usize) as f64 / total as f64) * 100.0 };

    if ok.is_empty() {
        return LatencyMetric {
            min: 0.0, max: 0.0, mean: 0.0, p95: 0.0, jitter: 0.0,
            loss_rate, samples: 0, total, raw: vec![],
        };
    }

    let mut sorted = ok.clone();
    sorted.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let min = sorted.first().copied().unwrap_or(0.0);
    let max = sorted.last().copied().unwrap_or(0.0);
    let mean = ok.iter().sum::<f64>() / ok.len() as f64;

    // P95
    let p95_idx = ((sorted.len() as f64 - 1.0) * 0.95).round() as usize;
    let p95 = sorted.get(p95_idx).copied().unwrap_or(max);

    // Jitter (Mean Deviation of consecutive differences)
    let jitter = if ok.len() > 1 {
        let diffs: Vec<f64> = ok.windows(2).map(|w| (w[1] - w[0]).abs()).collect();
        diffs.iter().sum::<f64>() / diffs.len() as f64
    } else { 0.0 };

    LatencyMetric {
        min, max, mean, p95, jitter, loss_rate,
        samples: samples_n, total, raw: ok,
    }
}

/// 测量 ICMPv6 Echo RTT (10 次)
/// 【V48 迭代1.4】process 加 timeout 包装，防止进程 hang 死
fn probe_icmpv6(target: &str) -> LatencyMetric {
    let total: u32 = PING_COUNT;
    let mut samples: Vec<Option<f64>> = Vec::with_capacity(total as usize);

    /* V57: 根据目标类型自动选择 -4 / -6，避免 IPv4 目标使用 -6 导致失败 */
    let is_ipv6 = target.parse::<std::net::Ipv6Addr>().is_ok();
    let family_flag = if is_ipv6 { "-6" } else { "-4" };

    // 一次性 ping 10 次，解析输出提取每次延迟
    // V57: 使用带超时的命令执行，防止 ping 异常 hang 死阻塞线程（最多 20s）
    let output = run_cmd_with_timeout(
        "ping",
        &[family_flag, "-n", &PING_COUNT.to_string(), "-w", PING_PER_HOP_TIMEOUT_MS, target],
        PING_TIMEOUT,
    );

    if let Ok(out) = output {
        let stdout = decode_cmd_output(&out.stdout);
        let reply_re = &*RE_ICMPV6_TIME;
        let timeout_re = &*RE_TIMEOUT;

        for line in stdout.lines() {
            if let Some(cap) = reply_re.captures(line) {
                if let Ok(v) = cap[1].parse::<f64>() {
                    samples.push(Some(v));
                }
            } else if timeout_re.is_match(line) {
                samples.push(None);
            }
        }
    }

    // 补齐未识别的样本为 None
    while (samples.len() as u32) < total {
        samples.push(None);
    }

    compute_metric(samples, total)
}

/// 测量 TCP Handshake RTT (连接到 80/443)
/// 【V48 迭代1.2】80/443 完全并行：2 端口 × 5 次 = 10 个连接同时发起
/// 【V48 迭代1.4】统一 3s 超时保护
async fn probe_tcp_handshake(target: &str) -> LatencyMetric {
    let probes_per_port: u32 = 5;
    let is_ipv6 = target.parse::<std::net::Ipv6Addr>().is_ok();
    let format_addr = |port: u16| -> String {
        if is_ipv6 {
            format!("[{}]:{}", target, port)
        } else {
            format!("{}:{}", target, port)
        }
    };

    /* 构建 10 个并发连接任务：80×5 + 443×5 */
    let mut tasks = Vec::with_capacity(10);
    for &port in &[80u16, 443u16] {
        let addr = format_addr(port);
        for _ in 0..probes_per_port {
            let addr = addr.clone();
            tasks.push(tokio::spawn(async move {
                let t0 = Instant::now();
                match tokio::time::timeout(
                    TCP_HANDSHAKE_TIMEOUT,
                    tokio::net::TcpStream::connect(&addr),
                ).await {
                    Ok(Ok(_)) => Some(t0.elapsed().as_secs_f64() * 1000.0),
                    _ => None,
                }
            }));
        }
    }

    let mut samples: Vec<Option<f64>> = Vec::with_capacity(tasks.len());
    for t in tasks {
        if let Ok(v) = t.await {
            samples.push(v);
        }
    }
    let total_n = samples.len() as u32;

    compute_metric(samples, total_n)
}

/// 测量 DNS AAAA 解析耗时 (如果是域名)
/// 修正：计时移入闭包内部，排除 spawn_blocking 调度开销
async fn probe_dns_latency(target: &str) -> Option<f64> {
    // V57: 如果是 IP 地址（IPv4 或 IPv6），跳过 DNS 测量
    if target.parse::<std::net::Ipv6Addr>().is_ok()
        || target.parse::<std::net::Ipv4Addr>().is_ok()
    {
        return None;
    }
    let result = tokio::task::spawn_blocking({
        let t = target.to_string();
        move || {
            use std::net::ToSocketAddrs;
            let t0 = Instant::now();
            // 域名使用 host:0 格式（IPv6 才需要 []）
            let addr = format!("{}:0", t);
            match addr.to_socket_addrs().map(|mut it| it.next()) {
                Ok(Some(_)) => Some(t0.elapsed().as_secs_f64() * 1000.0),
                _ => None,
            }
        }
    }).await;
    result.ok().flatten()
}

/// 测量路径延迟 (tracert -6)
/// 【V48 迭代3.2】分段并行：30 跳拆 1-10/11-20/21-30 三段并发执行
/// 【V48 迭代1.4】process 加 timeout 保护
fn probe_path(target: &str) -> (u32, Option<f64>, Option<f64>, Vec<f64>) {
    /* V52 重构：原实现用 3 段并行 tracert（-h 10/20/30），但每段都跑全量 tracert，
       实为重复执行 3 次同一目标，浪费时间和系统资源。
       修复：改为单次 tracert -h 30，一次解析所有跳。
       V57: 根据目标类型自动选择 -4 / -6，并加 45s 进程级超时防止阻塞。 */
    let is_ipv6 = target.parse::<std::net::Ipv6Addr>().is_ok();
    let family_flag = if is_ipv6 { "-6" } else { "-4" };
    let stdout = match run_cmd_with_timeout(
        "tracert",
        &[family_flag, "-d", "-h", TRACERT_MAX_HOPS, "-w", PING_PER_HOP_TIMEOUT_MS, target],
        TRACERT_TIMEOUT,
    ) {
        Ok(out) => decode_cmd_output(&out.stdout),
        Err(_) => String::new(),
    };

    let hop_re = &*RE_TRACERT_HOP;
    let ms_re = &*RE_TRACERT_MS;

    let mut path_latencies: Vec<f64> = Vec::new();
    let mut hop_count = 0u32;
    let mut first_hop: Option<f64> = None;
    let mut last_hop: Option<f64> = None;
    let mut seen_hops: HashSet<u32> = HashSet::new();

    for line in stdout.lines() {
        if let Some(cap) = hop_re.captures(line) {
            if let Ok(n) = cap[1].parse::<u32>() {
                if !seen_hops.insert(n) { continue; } /* 跳过重复 */
                if n > hop_count { hop_count = n; }
                if let Some(m) = ms_re.captures(line) {
                    if let Ok(v) = m[1].parse::<f64>() {
                        if first_hop.is_none() && n == 1 {
                            first_hop = Some(v);
                        }
                        last_hop = Some(v);
                        path_latencies.push(v);
                    }
                }
            }
        }
    }

    (hop_count, first_hop, last_hop, path_latencies)
}

/* V54: 从目标地址中提取 host — 支持 URL、IPv6带端口、纯域名等格式 */
fn extract_host_from_target(target: &str) -> String {
    let target = target.trim();
    if target.is_empty() {
        return String::new();
    }
    /* 去除 scheme */
    let after_scheme = if target.starts_with("https://") {
        &target[8..]
    } else if target.starts_with("http://") {
        &target[7..]
    } else {
        target
    };
    /* 去除路径（第一个 / 之后） */
    let after_path = after_scheme.split('/').next().unwrap_or(after_scheme);
    /* 去除端口和 ZoneId — 但要小心 IPv6 地址 [::1]:443 */
    if after_path.starts_with('[') {
        /* IPv6 带 [ ] 格式，如 [2001:db8::1]:443 或 [fe80::1%eth0]:80 */
        if let Some(end) = after_path.find(']') {
            return after_path[1..end].to_string();
        }
    }
    /* 普通 IPv6（无方括号）或 IPv4 或域名 — 去端口 */
    /* IPv6 含多个冒号，不能简单按冒号分割；IPv4/域名只有一个冒号（端口） */
    let colon_count = after_path.matches(':').count();
    if colon_count == 0 {
        /* 无冒号，纯域名或 IPv4 */
        after_path.to_string()
    } else if colon_count == 1 {
        /* 一个冒号，可能是 域名:端口 或 IPv4:端口 */
        after_path.split(':').next().unwrap_or(after_path).to_string()
    } else {
        /* 多个冒号，是 IPv6 地址（可能带 ZoneId） */
        /* 去除 ZoneId（%eth0 等） */
        let without_zone = after_path.split('%').next().unwrap_or(after_path);
        without_zone.to_string()
    }
}

/* V54: 校验探测目标 — 支持 IPv6/IPv4/域名/URL（含 http://、https://、端口、路径） */
fn is_valid_probe_target(target: &str) -> bool {
    if target.is_empty() || target.len() > 2048 {
        return false;
    }
    /* 先尝试提取 host（处理 URL 格式） */
    let host = extract_host_from_target(target);
    if host.is_empty() {
        return false;
    }
    /* host 合法性：IPv6/IPv4 直接通过，域名做字符集校验 */
    if host.parse::<std::net::Ipv6Addr>().is_ok() {
        return true;
    }
    if host.parse::<std::net::Ipv4Addr>().is_ok() {
        return true;
    }
    /* 域名校验：允许字母数字、点、连字符，总长度≤253，每段≤63 */
    if host.len() > 253 {
        return false;
    }
    host.split('.').all(|label| {
        !label.is_empty()
            && label.len() <= 63
            && label.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
            && !label.starts_with('-')
            && !label.ends_with('-')
    })
}

#[tauri::command]
async fn run_v6_probe(target: String) -> Result<ProbeResult, String> {
    let target = target.trim().to_string();
    if target.is_empty() {
        return Err("目标地址不能为空".into());
    }
    /* V54: 校验探测目标合法性，避免注入到 ping/tracert 等子进程 */
    if !is_valid_probe_target(&target) {
        return Err(format!("无效的探测目标: {}", target));
    }
    /* V54: 提取 host（剥离 scheme/路径/端口），tracert/ping 需要纯主机名 */
    let target = extract_host_from_target(&target);
    if target.is_empty() {
        return Err("无法解析目标地址".into());
    }

    // 并发执行所有 4 个探测维度（DNS + ICMP + TCP + Path）
    // 使用 tokio::join! 让所有探测同时运行，总耗时 ≈ 最慢的那个而非全部之和
    let target_dns = target.clone();
    let target_icmp = target.clone();
    let target_tcp = target.clone();
    let target_path = target.clone();

    let (dns_res, icmp_res, tcp_res, path_res) = tokio::join!(
        // 1. DNS AAAA 解析
        async { probe_dns_latency(&target_dns).await },
        // 2. ICMPv6 Echo RTT (10 次) — 阻塞调用放 spawn_blocking
        async {
            tauri::async_runtime::spawn_blocking(move || probe_icmpv6(&target_icmp))
                .await
                .ok()
        },
        // 3. TCP Handshake RTT (5 次) — async 直接执行
        async {
            tauri::async_runtime::spawn(async move {
                probe_tcp_handshake(&target_tcp).await
            }).await.ok()
        },
        // 4. Path Latency (tracert) — 阻塞调用放 spawn_blocking
        async {
            tauri::async_runtime::spawn_blocking(move || probe_path(&target_path))
                .await
                .unwrap_or((0u32, None, None, vec![]))
        },
    );

    let dns_latency = dns_res;
    let icmp_rtt = icmp_res;
    let tcp_handshake = tcp_res;
    let (hop_count, first_hop, last_hop, path_latencies) = path_res;

    // 5. 综合评估
    let mut summary = String::new();
    if let Some(ref icmp) = icmp_rtt {
        if icmp.samples > 0 {
            summary.push_str(&format!(
                "ICMP 平均 {:.1}ms / P95 {:.1}ms / 丢包 {:.0}%\n",
                icmp.mean, icmp.p95, icmp.loss_rate
            ));
        }
    }
    if let Some(ref tcp) = tcp_handshake {
        if tcp.samples > 0 {
            summary.push_str(&format!(
                "TCP 建连 平均 {:.1}ms (P95 {:.1}ms)\n",
                tcp.mean, tcp.p95
            ));
        }
    }
    if let Some(dns) = dns_latency {
        summary.push_str(&format!("DNS 解析 {:.2}ms\n", dns));
    }
    if hop_count > 0 {
        summary.push_str(&format!("路径跳数 {}", hop_count));
    }
    if summary.is_empty() {
        summary = "所有探测均失败，请检查目标 IPv6 地址和防火墙设置".into();
    }

    /* V55: 计算综合评分（0-100）— 基于延迟、丢包率、抖动加权 */
    let (score, score_label) = {
        let mut total_score: f64 = 0.0;
        let mut weight_sum: f64 = 0.0;
        /* ICMP 权重 0.40 */
        if let Some(ref icmp) = icmp_rtt {
            if icmp.samples > 0 {
                let s_lat = if icmp.mean <= 30.0 { 100.0 }
                    else if icmp.mean >= 300.0 { 0.0 }
                    else { 100.0 * (300.0 - icmp.mean) / (300.0 - 30.0) };
                let s_loss = if icmp.loss_rate <= 0.0 { 100.0 }
                    else if icmp.loss_rate >= 5.0 { 0.0 }
                    else { 100.0 * (5.0 - icmp.loss_rate) / 5.0 };
                let s_jit = if icmp.jitter <= 5.0 { 100.0 }
                    else if icmp.jitter >= 60.0 { 0.0 }
                    else { 100.0 * (60.0 - icmp.jitter) / (60.0 - 5.0) };
                total_score += (s_lat * 0.40 + s_loss * 0.35 + s_jit * 0.25) * 0.50;
                weight_sum += 0.50;
            }
        }
        /* TCP 权重 0.30 */
        if let Some(ref tcp) = tcp_handshake {
            if tcp.samples > 0 {
                let s_lat = if tcp.mean <= 30.0 { 100.0 }
                    else if tcp.mean >= 300.0 { 0.0 }
                    else { 100.0 * (300.0 - tcp.mean) / (300.0 - 30.0) };
                let s_loss = if tcp.loss_rate <= 0.0 { 100.0 }
                    else if tcp.loss_rate >= 5.0 { 0.0 }
                    else { 100.0 * (5.0 - tcp.loss_rate) / 5.0 };
                let s_jit = if tcp.jitter <= 5.0 { 100.0 }
                    else if tcp.jitter >= 60.0 { 0.0 }
                    else { 100.0 * (60.0 - tcp.jitter) / (60.0 - 5.0) };
                total_score += (s_lat * 0.40 + s_loss * 0.35 + s_jit * 0.25) * 0.30;
                weight_sum += 0.30;
            }
        }
        /* DNS 权重 0.20 */
        if let Some(dns) = dns_latency {
            let s_dns = if dns <= 50.0 { 100.0 }
                else if dns >= 500.0 { 0.0 }
                else { 100.0 * (500.0 - dns) / (500.0 - 50.0) };
            total_score += s_dns * 0.20;
            weight_sum += 0.20;
        }
        let final_score = if weight_sum > 0.0 { (total_score / weight_sum).round() as u32 } else { 0 };
        let label = if final_score >= 90 { "优秀" }
            else if final_score >= 75 { "良好" }
            else if final_score >= 60 { "一般" }
            else if final_score >= 40 { "较差" }
            else { "很差" };
        (final_score, label.to_string())
    };

    let result = ProbeResult {
        icmp_rtt,
        tcp_handshake,
        dns_latency,
        hop_count,
        first_hop,
        last_hop,
        path_latencies,
        summary,
        error: String::new(),
        score,
        score_label,
    };

    /* V58: 自动保存诊断结果到历史记录（同步 IO 放 spawn_blocking，不阻塞 tokio runtime） */
    let save_target = target.clone();
    let save_result = result.clone();
    let save_score = result.score;
    let save_score_label = result.score_label.clone();
    match tauri::async_runtime::spawn_blocking(move || {
        record_probe_result_to_history(save_target, save_result, save_score, save_score_label)
    }).await {
        Ok(Ok(_)) => {}
        Ok(Err(e)) => debug_log!("保存诊断历史记录失败: {}", e),
        Err(e) => debug_log!("保存诊断历史记录任务失败: {}", e),
    }

    Ok(result)
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct HistoryRecord {
    pub id: String,
    pub timestamp: i64,
    pub ipv6_address: String,
    pub success: bool,
    pub summary: String,
    /// V54: 详细步骤记录（含每步目标 URL 与延迟），向后兼容旧记录
    #[serde(default)]
    pub steps: Vec<DetectionStep>,
    /// V55: 网络性能诊断结果（可选，仅诊断记录有）
    #[serde(default)]
    pub probe_result: Option<ProbeResult>,
    /// V55: 记录类型 "detection" 或 "probe"
    #[serde(default)]
    pub record_type: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AppConfig {
    #[serde(default)]
    pub first_run_accepted: bool,
    /// V62: ChaCha20-Poly1305 主密钥（hex 编码的 32 字节）—— 持久化在 config.json 中
    /// 旧版 config.json 没有此字段，#[serde(default)] 让其默认为空字符串
    #[serde(default)]
    pub secret_key: String,
    /// V62: 仅在内存中返回给前端，序列化到 config.json 时跳过
    /// 实际历史记录改存到加密的 history.dat 中
    /// V66: 移除 skip_serializing，确保 records 能通过 Tauri 命令正确返回给前端
    #[serde(default)]
    pub records: Vec<HistoryRecord>,
    /// V67: Debug 模式开关，持久化在 config.json 中
    #[serde(default)]
    pub debug_mode: bool,
}

fn get_data_dir() -> PathBuf {
    let appdata = std::env::var("APPDATA")
        .unwrap_or_else(|_| ".".to_string());
    let dir = PathBuf::from(appdata).join("IPV6Tool");
    let _ = fs::create_dir_all(&dir);
    dir
}

fn get_config_path() -> PathBuf {
    get_data_dir().join("config.json")
}

fn get_history_path() -> PathBuf {
    get_data_dir().join("history.dat")
}

/* ================== V62: ChaCha20-Poly1305 AEAD 加解密 ==================
   使用 IETF 标准的 ChaCha20-Poly1305 AEAD（authenticated encryption with associated data）。
   相比 V62 旧的 XOR 混淆：提供机密性 + 完整性 + 防篡改，任何密文被改动都会导致解密失败。
   算法参数：
   - Key  : 32 字节（256 位），主密钥持久化在 config.json 的 secret_key 字段
   - Nonce: 12 字节（96 位），每次加密时由 CSPRNG 随机生成，绝不重用
   - Tag  : 16 字节 Poly1305 MAC，附在密文尾部，由库自动管理
   文件格式：nonce(12) + ciphertext(含 tag)
   解密失败返回 Err（旧版 XOR 格式的 history.dat 无法解密，但 load_history 已做兼容） */

/* 读取整个 config.json 文件到 AppConfig（不存在则返回默认值） */
fn load_full_config_from_disk() -> AppConfig {
    let path = get_config_path();
    if path.exists() {
        if let Ok(content) = fs::read_to_string(&path) {
            if let Ok(parsed) = serde_json::from_str::<AppConfig>(&content) {
                return parsed;
            }
        }
    }
    AppConfig {
        first_run_accepted: false,
        secret_key: String::new(),
        records: Vec::new(),
        debug_mode: false,
    }
}

/* 把 AppConfig 原子写入 config.json（records 字段因 skip_serializing 不会持久化）
   V64: secret_key 不再使用（改为机器绑定派生密钥），写入时强制清空，
        清除旧版遗留在 config.json 中的明文密钥。 */
fn save_full_config_to_disk(config: &AppConfig) -> Result<(), String> {
    let path = get_config_path();
    /* V64: 克隆后清空 secret_key，确保明文密钥不再落盘 */
    /* V66: 同时清空 records，防止因移除了 skip_serializing 而误写入 config.json */
    let mut to_save = config.clone();
    to_save.secret_key = String::new();
    to_save.records = Vec::new();
    let json = serde_json::to_string_pretty(&to_save)
        .map_err(|e| format!("序列化配置失败: {}", e))?;
    let tmp_path = path.with_extension("tmp");
    if let Err(e) = fs::write(&tmp_path, json) {
        let _ = fs::remove_file(&tmp_path);
        return Err(format!("写入临时配置文件失败: {}", e));
    }
    if let Err(e) = fs::rename(&tmp_path, &path) {
        let _ = fs::remove_file(&tmp_path);
        return Err(format!("保存配置文件失败: {}", e));
    }
    Ok(())
}

/* ================== V64: 机器绑定派生密钥（替代明文存储的 secret_key） ==================
   原 V62 方案：随机生成 32 字节密钥，hex 编码后明文存储在 config.json 的 secret_key 字段。
   问题1：密钥与密文（history.dat）同目录明文存放，黑客打开 config.json 即可拿到密钥，
          加解密形同虚设。
   问题2：config.json 在多命令并发写入、版本迁移等场景下可能丢失 secret_key，
          导致 history.dat 无法解密 → 历史记录全部丢失。

   V64 新方案：密钥永不落盘。每次启动从 Windows MachineGuid（机器唯一标识）
   + 硬编码应用 salt 通过 SHA-256 派生 32 字节密钥。
   - 机密性：密钥不在任何文件中，黑客无法从磁盘读取。
   - 机器绑定：history.dat 只能在本机解密，复制到其他机器无法读取（隐私保护更强）。
   - 稳定性：不依赖 config.json，杜绝密钥丢失导致历史记录无法解密的问题。
   - 代价：重装系统（MachineGuid 改变）后旧 history.dat 无法解密，视为可接受。 */

/* 应用固定 salt —— 硬编码在二进制中，与 MachineGuid 一起参与密钥派生。
   作用：即使两台机器的 MachineGuid 碰巧相同（概率极低），不同应用的 salt 不同，
   派生出的密钥也不同，防止跨应用密钥复用攻击。 */
const APP_KEY_SALT: &[u8] = b"IPv6Tool::V64::HistoryEncryption::ChaCha20Poly1305";

/* 读取 Windows MachineGuid（注册表 HKLM\SOFTWARE\Microsoft\Cryptography\MachineGuid）。
   MachineGuid 是 Windows 安装时生成的唯一机器标识，重装系统才会改变。
   用 reg query 命令读取（带 CREATE_NO_WINDOW 防止黑窗）。 */
fn read_machine_guid() -> String {
    let output = Command::new("reg")
        .args([
            "query",
            r"HKLM\SOFTWARE\Microsoft\Cryptography",
            "/v",
            "MachineGuid",
        ])
        .creation_flags(CREATE_NO_WINDOW)
        .output();
    match output {
        Ok(o) => {
            let text = String::from_utf8_lossy(&o.stdout);
            /* reg query 输出格式（中文/英文系统）：
                   HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\Cryptography
                       MachineGuid    REG_SZ    12345678-1234-1234-1234-123456789abc
               取最后一个空白分隔的字段即为 GUID。 */
            for line in text.lines() {
                let trimmed = line.trim();
                if trimmed.to_lowercase().contains("machineguid") {
                    let parts: Vec<&str> = trimmed.split_whitespace().collect();
                    if let Some(guid) = parts.last() {
                        let g = guid.trim();
                        if !g.is_empty() {
                            return g.to_string();
                        }
                    }
                }
            }
            String::new()
        }
        Err(_) => String::new(),
    }
}

/* V65: 使用 OnceCell 缓存派生密钥，进程生命周期内只计算一次。
   原 V64 每次加解密都重新执行 reg query 读取 MachineGuid，
   在 Tauri 异步上下文中 reg query 可能因线程调度/权限沙箱返回不一致值，
   导致加密和解密用不同密钥 → 解密失败 → 历史记录"无法读取"。
   通过缓存密钥，保证进程内每次加解密使用完全相同的 32 字节密钥。 */
static MACHINE_KEY: once_cell::sync::OnceCell<[u8; HISTORY_KEY_LEN]> = once_cell::sync::OnceCell::new();

fn derive_machine_key() -> &'static [u8; HISTORY_KEY_LEN] {
    MACHINE_KEY.get_or_init(|| {
        let guid = read_machine_guid();
        let mut hasher = Sha256::new();
        hasher.update(guid.as_bytes());
        hasher.update(APP_KEY_SALT);
        let result = hasher.finalize();
        let mut key = [0u8; HISTORY_KEY_LEN];
        key.copy_from_slice(&result);
        debug_log!("[V65] derive_machine_key: guid='{}' first_bytes={:02x}{:02x}..{:02x}",
            guid, key[0], key[1], key[31]);
        key
    })
}

/* ChaCha20-Poly1305 加密：plain → nonce(12) || ciphertext(含 16 字节 tag)
   V64: 密钥改为 derive_machine_key()（机器绑定，不落盘）
   V65: derive_machine_key() 返回引用，直接传入 from_slice */
fn encrypt_data(plain: &[u8]) -> Result<Vec<u8>, String> {
    let key = derive_machine_key();
    let key_obj = Key::from_slice(key);
    let cipher = ChaCha20Poly1305::new(key_obj);

    let mut nonce_bytes = [0u8; HISTORY_NONCE_LEN];
    rand::thread_rng().fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);

    let ciphertext = cipher
        .encrypt(nonce, plain)
        .map_err(|e| format!("加密失败: {}", e))?;

    let mut out = Vec::with_capacity(HISTORY_NONCE_LEN + ciphertext.len());
    out.extend_from_slice(&nonce_bytes);
    out.extend_from_slice(&ciphertext);
    Ok(out)
}

/* ChaCha20-Poly1305 解密：nonce(12) || ciphertext → plain
   V64: 密钥改为 derive_machine_key()（机器绑定，不落盘）
   V65: derive_machine_key() 返回引用，直接传入 from_slice
   任何错误（长度不足、tag 校验失败）都返回 Err，由调用方决定是否视为空 */
fn decrypt_data(cipher: &[u8]) -> Result<Vec<u8>, String> {
    if cipher.len() < HISTORY_NONCE_LEN {
        return Err("密文长度不足".into());
    }
    let key = derive_machine_key();
    let key_obj = Key::from_slice(key);
    let cipher_obj = ChaCha20Poly1305::new(key_obj);
    let (nonce_bytes, payload) = cipher.split_at(HISTORY_NONCE_LEN);
    let nonce = Nonce::from_slice(nonce_bytes);

    cipher_obj
        .decrypt(nonce, payload)
        .map_err(|e| format!("解密失败: {}", e))
}

/* ================== V62: 历史数据脱敏 ================== */

/* IPv6 地址截断：超过 8 字符的部分用 "..." 替代 */
fn truncate_ipv6(addr: &str) -> String {
    let s = addr.trim();
    if s.is_empty() {
        return String::new();
    }
    let truncated: String = s.chars().take(IPV6_DISPLAY_PREFIX).collect();
    if s.chars().count() > IPV6_DISPLAY_PREFIX {
        format!("{}...", truncated)
    } else {
        truncated
    }
}

/* 移除 URL 中的查询参数（保留 scheme + 域名 + 路径） */
fn sanitize_target_url(url: &str) -> String {
    if let Some(idx) = url.find('?') {
        url[..idx].to_string()
    } else {
        url.to_string()
    }
}

/* 移除 probe_result 中的大体积字段：path_latencies 与 raw 延迟样本 */
fn sanitize_probe_result(probe: &mut ProbeResult) {
    probe.path_latencies.clear();
    if let Some(ref mut m) = probe.icmp_rtt {
        m.raw.clear();
    }
    if let Some(ref mut m) = probe.tcp_handshake {
        m.raw.clear();
    }
}

/* 单条历史记录脱敏（写入前调用） */
fn sanitize_history_record(mut record: HistoryRecord) -> HistoryRecord {
    record.ipv6_address = truncate_ipv6(&record.ipv6_address);
    for step in record.steps.iter_mut() {
        if !step.target_url.is_empty() {
            step.target_url = sanitize_target_url(&step.target_url);
        }
    }
    if let Some(ref mut probe) = record.probe_result {
        sanitize_probe_result(probe);
    }
    record
}

/* ================== V62: history.dat 加解密读写 ==================
   文件格式（V62 ChaCha20-Poly1305 新格式）：nonce(12) + ciphertext(含 16 字节 tag)
   旧版 XOR 格式（magic "IV6T" + nonce + payload_len + payload）无法解密时
   会被 decrypt_data 返回 Err，load_history 直接返回空 Vec，UI 不会崩溃。
   任何读/解密/解析失败都返回空 Vec（兼容旧版本数据/损坏文件） */

fn load_history() -> Vec<HistoryRecord> {
    let path = get_history_path();
    if !path.exists() {
        debug_log!("[V65] load_history: history.dat not found at {:?}", path);
        return Vec::new();
    }
    let cipher = match fs::read(&path) {
        Ok(c) => c,
        Err(e) => {
            debug_log!("[V65] load_history: read error: {}", e);
            return Vec::new();
        }
    };
    debug_log!("[V65] load_history: read {} bytes from {:?}", cipher.len(), path);
    let plain = match decrypt_data(&cipher) {
        Ok(p) => p,
        Err(e) => {
            debug_log!("[V65] load_history: decrypt failed: {}", e);
            return Vec::new();
        }
    };
    match serde_json::from_slice::<Vec<HistoryRecord>>(&plain) {
        Ok(records) => {
            debug_log!("[V65] load_history: parsed {} records", records.len());
            records
        }
        Err(e) => {
            debug_log!("[V65] load_history: json parse failed: {}", e);
            Vec::new()
        }
    }
}

fn save_history(records: &[HistoryRecord]) -> Result<(), String> {
    let path = get_history_path();
    /* 写入前对每条记录做脱敏（截断 IPv6 / 清空 raw / 去掉查询参数） */
    let sanitized: Vec<HistoryRecord> = records
        .iter()
        .cloned()
        .map(sanitize_history_record)
        .collect();
    let json = serde_json::to_vec(&sanitized)
        .map_err(|e| format!("序列化历史记录失败: {}", e))?;
    debug_log!("[V65] save_history: serialized {} records ({} bytes)", sanitized.len(), json.len());

    /* ChaCha20-Poly1305 加密（内部自动生成随机 nonce 并 prepend 到密文） */
    let cipher = encrypt_data(&json)?;
    debug_log!("[V65] save_history: encrypted {} bytes", cipher.len());

    /* 原子写入：先写临时文件再 rename，避免半写状态 */
    let tmp_path = path.with_extension("tmp");
    if let Err(e) = fs::write(&tmp_path, &cipher) {
        let _ = fs::remove_file(&tmp_path);
        return Err(format!("写入临时历史文件失败: {}", e));
    }
    if let Err(e) = fs::rename(&tmp_path, &path) {
        let _ = fs::remove_file(&tmp_path);
        return Err(format!("保存历史记录失败: {}", e));
    }
    debug_log!("[V65] save_history: written to {:?}", path);
    Ok(())
}

/* 读取 first_run_accepted（V62: config.json 含 first_run_accepted + secret_key） */
fn load_first_run_accepted() -> bool {
    let path = get_config_path();
    if !path.exists() {
        return false;
    }
    if let Ok(content) = fs::read_to_string(&path) {
        if let Ok(parsed) = serde_json::from_str::<AppConfig>(&content) {
            return parsed.first_run_accepted;
        }
    }
    false
}

/* 保存 first_run_accepted —— 必须保留磁盘上已有的 secret_key，否则历史数据无法解密 */
fn save_first_run_accepted(first_run: bool) -> Result<(), String> {
    let mut config = load_full_config_from_disk();
    config.first_run_accepted = first_run;
    save_full_config_to_disk(&config)
}

#[tauri::command]
fn load_config() -> AppConfig {
    /* V65: 增加调试输出便于追踪数据流 */
    debug_log!("[V65] load_config: entered");
    /* V62: config.json 只包含 first_run_accepted，records 来自加密的 history.dat */
    let path = get_config_path();
    let mut first_run = false;
    let mut debug_mode = false;

    if path.exists() {
        debug_log!("[V65] load_config: config.json exists");
        if let Ok(content) = fs::read_to_string(&path) {
            if let Ok(parsed) = serde_json::from_str::<AppConfig>(&content) {
                first_run = parsed.first_run_accepted;
                debug_mode = parsed.debug_mode;
                debug_log!("[V65] load_config: first_run_accepted={}, debug_mode={}", first_run, debug_mode);
                /* V62 迁移：如果旧版 config.json 里仍有 records（明文），
                   自动迁移到加密的 history.dat，并立刻把 config.json 改写为新格式 */
                if !parsed.records.is_empty() {
                    debug_log!("[V65] load_config: migrating {} inline records to history.dat", parsed.records.len());
                    let _ = save_history(&parsed.records);
                    let _ = save_first_run_accepted(first_run);
                }
            }
        }
    }

    /* V67: 根据 config.json 中的 debug_mode 设置全局开关 */
    DEBUG_ENABLED.store(debug_mode, Ordering::Relaxed);
    debug_log!("[V67] debug mode initialized to {}", debug_mode);

    let records = load_history();
    AppConfig {
        first_run_accepted: first_run,
        secret_key: String::new(),
        records,
        debug_mode,
    }
}

#[tauri::command]
fn save_config(config: AppConfig) -> Result<(), String> {
    /* V62: 前端调用的 save_config 仅写 first_run_accepted 到 config.json，
       传入的 records 字段被忽略（skip_serializing 也保证不会被持久化） */
    save_first_run_accepted(config.first_run_accepted)
}

#[tauri::command]
fn accept_disclaimer() -> Result<AppConfig, String> {
    /* V62: 只写 config.json，不涉及 history */
    save_first_run_accepted(true)?;
    let records = load_history();
    Ok(AppConfig {
        first_run_accepted: true,
        secret_key: String::new(),
        records,
        debug_mode: DEBUG_ENABLED.load(Ordering::Relaxed),
    })
}

#[tauri::command]
fn add_history_record(mut record: HistoryRecord) -> Result<AppConfig, String> {
    debug_log!("[V65] add_history_record: id={} ts={} ip={}", record.id, record.timestamp, record.ipv6_address);
    /* V58: 历史记录中不保留中间状态为 running 的步骤 */
    record.steps.retain(|s| s.status != "running");
    /* V63: 脱敏后再保存（函数签名是按值传入并返回新值） */
    record = sanitize_history_record(record);
    let mut records = load_history();
    records.insert(0, record);
    if records.len() > MAX_HISTORY_RECORDS {
        records.truncate(MAX_HISTORY_RECORDS);
    }
    save_history(&records)?;
    let loaded = load_history();
    debug_log!("[V65] add_history_record: after save, loaded {} records", loaded.len());
    Ok(AppConfig {
        first_run_accepted: load_first_run_accepted(),
        secret_key: String::new(),
        records: loaded,
        debug_mode: DEBUG_ENABLED.load(Ordering::Relaxed),
    })
}

/* V58: 内部公共逻辑：保存网络性能诊断记录到历史
   V62: 改写为加密存储到 history.dat
   V63: 调用 sanitize_history_record 脱敏后再保存
   V65: 增加调试输出 */
fn record_probe_result_to_history(
    target: String,
    probe_result: ProbeResult,
    score: u32,
    score_label: String,
) -> Result<AppConfig, String> {
    debug_log!("[V65] record_probe_result_to_history: target={} score={}", target, score);
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    /* V58: 诊断记录的成功状态 — 至少有一个探测维度拿到样本才算成功 */
    let has_any_sample = probe_result.icmp_rtt.as_ref().map(|m| m.samples > 0).unwrap_or(false)
        || probe_result.tcp_handshake.as_ref().map(|m| m.samples > 0).unwrap_or(false)
        || probe_result.dns_latency.is_some()
        || probe_result.hop_count > 0;
    let mut record = HistoryRecord {
        id: format!("probe_{}_{:x}", timestamp, (timestamp * 31 + 7) % 0xFFFFFF),
        timestamp: timestamp as i64,
        ipv6_address: target,
        success: has_any_sample && probe_result.error.is_empty(),
        summary: format!("评分 {}/100 ({}) — {}",
            score, score_label, probe_result.summary),
        steps: Vec::new(),
        probe_result: Some(probe_result),
        record_type: "probe".into(),
    };
    /* V63: 脱敏后再保存，截断 IPv6、清理 probe 原始数据（函数签名是按值传入并返回新值） */
    let mut record = sanitize_history_record(record);
    let mut records = load_history();
    records.insert(0, record);
    if records.len() > MAX_HISTORY_RECORDS {
        records.truncate(MAX_HISTORY_RECORDS);
    }
    save_history(&records)?;
    let loaded = load_history();
    debug_log!("[V65] record_probe_result_to_history: after save, loaded {} records", loaded.len());
    Ok(AppConfig {
        first_run_accepted: load_first_run_accepted(),
        secret_key: String::new(),
        records: loaded,
        debug_mode: DEBUG_ENABLED.load(Ordering::Relaxed),
    })
}

/* V55: 保存网络性能诊断记录到历史 */
#[tauri::command]
fn save_probe_history(
    target: String,
    probe_result: ProbeResult,
    score: u32,
    score_label: String,
) -> Result<AppConfig, String> {
    record_probe_result_to_history(target, probe_result, score, score_label)
}

#[tauri::command]
fn clear_history() -> Result<AppConfig, String> {
    /* V62: 直接删除 history.dat 文件 */
    let path = get_history_path();
    debug_log!("[V65] clear_history: deleting {:?}", path);
    if path.exists() {
        if let Err(e) = fs::remove_file(&path) {
            debug_log!("[V65] clear_history: delete failed: {}", e);
            return Err(format!("删除历史记录失败: {}", e));
        }
        debug_log!("[V65] clear_history: deleted successfully");
    } else {
        debug_log!("[V65] clear_history: file does not exist, nothing to delete");
    }
    Ok(AppConfig {
        first_run_accepted: load_first_run_accepted(),
        secret_key: String::new(),
        records: Vec::new(),
        debug_mode: DEBUG_ENABLED.load(Ordering::Relaxed),
    })
}

/* V54: 删除单条历史记录 —— V62 改写 history.dat */
#[tauri::command]
fn delete_record(index: usize) -> Result<AppConfig, String> {
    let mut records = load_history();
    debug_log!("[V65] delete_record: index={} total={}", index, records.len());
    if index < records.len() {
        let removed = records.remove(index);
        debug_log!("[V65] delete_record: removed id={} ts={}", removed.id, removed.timestamp);
        save_history(&records)?;
    } else {
        /* V115: 索引越界时返回错误而非静默忽略，让前端知道删除未生效 */
        return Err(format!("索引 {} 超出范围（共 {} 条记录）", index, records.len()));
    }
    let loaded = load_history();
    debug_log!("[V65] delete_record: after save, loaded {} records", loaded.len());
    Ok(AppConfig {
        first_run_accepted: load_first_run_accepted(),
        secret_key: String::new(),
        records: loaded,
        debug_mode: DEBUG_ENABLED.load(Ordering::Relaxed),
    })
}

#[tauri::command]
fn get_data_directory() -> String {
    get_data_dir().to_string_lossy().to_string()
}

/* V67: Debug 模式控制命令 */
#[tauri::command]
fn set_debug_mode(enabled: bool) -> Result<bool, String> {
    DEBUG_ENABLED.store(enabled, Ordering::Relaxed);
    /* 持久化到 config.json */
    let mut config = load_full_config_from_disk();
    config.debug_mode = enabled;
    save_full_config_to_disk(&config)?;
    /* 如果关闭 debug 模式，清除已打开的日志文件句柄 */
    if !enabled {
        if let Ok(mut guard) = DEBUG_LOG.lock() {
            *guard = None;
        }
        /* 删除旧的 debug.log 文件 */
        let log_path = get_data_dir().join("debug.log");
        let _ = fs::remove_file(&log_path);
    }
    Ok(enabled)
}

#[tauri::command]
fn get_debug_mode() -> bool {
    DEBUG_ENABLED.load(Ordering::Relaxed)
}

/* V67: 清除缓存目录中的杂余数据文件 */
#[derive(Serialize)]
struct CleanResult {
    cleaned: Vec<String>,
    kept: Vec<String>,
}

#[tauri::command]
fn clean_cache_dir() -> Result<CleanResult, String> {
    let dir = get_data_dir();
    let mut cleaned = Vec::new();
    let mut kept = Vec::new();

    /* 允许保留的文件列表 */
    let allowed_files = ["config.json", "history.dat", "runtime_cache.json"];

    if let Ok(entries) = fs::read_dir(&dir) {
        for entry in entries.flatten() {
            let file_name = entry.file_name().to_string_lossy().to_string();
            if allowed_files.contains(&file_name.as_str()) {
                kept.push(file_name);
            } else {
                /* 删除杂余文件 */
                match fs::remove_file(entry.path()) {
                    Ok(()) => {
                        debug_log!("[V67] clean_cache_dir: removed {}", file_name);
                        cleaned.push(file_name);
                    }
                    Err(e) => {
                        debug_log!("[V67] clean_cache_dir: failed to remove {}: {}", file_name, e);
                    }
                }
            }
        }
    }

    debug_log!("[V67] clean_cache_dir: cleaned {} files, kept {} files", cleaned.len(), kept.len());
    Ok(CleanResult { cleaned, kept })
}

/* === V52: WebView2 + VC++ 运行库启动前检测 === */

/// 检测 WebView2 Runtime 是否已安装
fn check_webview2_installed() -> bool {
    /* 方法1: 查注册表（64位系统在 WOW6432Node 下） */
    let reg_output = cmd_no_window("reg")
        .args([
            "query",
            r"HKLM\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}",
            "/v", "pv",
        ])
        .output();
    if let Ok(out) = reg_output {
        if out.status.success() {
            return true;
        }
    }
    /* 方法2: 查 32 位注册表路径 */
    let reg2 = cmd_no_window("reg")
        .args([
            "query",
            r"HKLM\SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}",
            "/v", "pv",
        ])
        .output();
    if let Ok(out) = reg2 {
        if out.status.success() {
            return true;
        }
    }
    /* 方法3: 检查 msedgewebview2.exe 是否存在 */
    let prog_dir = std::env::var("ProgramFiles").unwrap_or_else(|_| r"C:\Program Files".into());
    let prog_x86 = std::env::var("ProgramFiles(x86)").unwrap_or_else(|_| r"C:\Program Files (x86)".into());
    let local_app = std::env::var("LOCALAPPDATA").unwrap_or_default();

    let paths = [
        format!(r"{}\Microsoft\EdgeWebView\Application", prog_dir),
        format!(r"{}\Microsoft\EdgeWebView\Application", prog_x86),
        format!(r"{}\Microsoft\EdgeWebView\Application", local_app),
    ];
    for p in &paths {
        if std::path::Path::new(p).exists() {
            return true;
        }
    }
    false
}

/// 检测 VC++ 运行库是否已安装
fn check_vcredist_installed() -> bool {
    /* 方法1: 检查 vcruntime140.dll 是否存在于 System32 */
    let system32 = std::env::var("SystemRoot").unwrap_or_else(|_| r"C:\Windows".into());
    let dll_path = format!(r"{}\System32\vcruntime140.dll", system32);
    if std::path::Path::new(&dll_path).exists() {
        return true;
    }
    /* 方法2: 查注册表 */
    let reg = cmd_no_window("reg")
        .args([
            "query",
            r"HKLM\SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes\X64",
            "/v", "Version",
        ])
        .output();
    if let Ok(out) = reg {
        if out.status.success() {
            return true;
        }
    }
    false
}

/// 显示 Windows 原生错误对话框并打开下载链接
fn show_runtime_error_dialog(missing: &str, url: &str) {
    use std::os::windows::ffi::OsStrExt;
    use windows::Win32::UI::WindowsAndMessaging::{MessageBoxW, MB_ICONERROR, MB_OK, SW_SHOWNORMAL};
    use windows::Win32::UI::Shell::ShellExecuteW;
    use windows::core::PCWSTR;

    /* V58: 只允许 http/https 协议的下载链接，防止危险协议被注入 */
    let url_lower = url.to_lowercase();
    if !url_lower.starts_with("http://") && !url_lower.starts_with("https://") {
        return;
    }

    let title: String = format!("运行库缺失 — {}", missing);
    /* V53: 第一个对话框只说"需要安装"，不暴露长 URL（避免截断） */
    let message1: String = format!(
        "本程序运行需要 {}，但当前系统未检测到安装。\n\n点击「确定」后将尝试打开浏览器前往微软官方下载页面。\n安装完成后请重新启动本程序。",
        missing
    );

    let title_w: Vec<u16> = std::ffi::OsStr::new(&title)
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    let msg1_w: Vec<u16> = std::ffi::OsStr::new(&message1)
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();

    unsafe {
        MessageBoxW(
            None,
            PCWSTR(msg1_w.as_ptr()),
            PCWSTR(title_w.as_ptr()),
            MB_OK | MB_ICONERROR,
        );
    }

    /* V53: 尝试用 ShellExecuteW 打开浏览器（用 SW_SHOWNORMAL） */
    let open_w: Vec<u16> = std::ffi::OsStr::new("open")
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    let url_w: Vec<u16> = std::ffi::OsStr::new(url)
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();

    let open_ok = unsafe {
        let hinst = ShellExecuteW(
            None,
            PCWSTR(open_w.as_ptr()),
            PCWSTR(url_w.as_ptr()),
            PCWSTR::null(),
            PCWSTR::null(),
            SW_SHOWNORMAL,
        );
        /* ShellExecuteW 返回 HINSTANCE > 32 表示成功 */
        (hinst.0 as usize) > 32
    };

    /* V53: ShellExecuteW 失败时，第二个 MessageBox 直接展示下载链接让用户手动复制 */
    if !open_ok {
        let message2: String = format!(
            "无法自动打开浏览器（系统可能缺少 WebView2/默认浏览器未配置）。\n\n请手动复制以下链接到浏览器地址栏打开并下载安装 {}：\n\n{}\n\n复制后请关闭此对话框。",
            missing, url
        );
        let msg2_w: Vec<u16> = std::ffi::OsStr::new(&message2)
            .encode_wide()
            .chain(std::iter::once(0))
            .collect();
        unsafe {
            MessageBoxW(
                None,
                PCWSTR(msg2_w.as_ptr()),
                PCWSTR(title_w.as_ptr()),
                MB_OK | MB_ICONERROR,
            );
        }
    }
}

/// 并行检测 WebView2 + VC++ 运行库，缺失则弹窗并退出
fn check_runtime_dependencies() {
    /* 先检查本地缓存（避免每次启动都查注册表） */
    let cache_path = get_data_dir().join("runtime_cache.json");
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    if let Ok(content) = fs::read_to_string(&cache_path) {
        if let Ok(cache) = serde_json::from_str::<serde_json::Value>(&content) {
            /* V53: 缓存超过 24 小时重新检测（避免运行库卸载后仍误判已安装） */
            let cache_ts = cache.get("ts").and_then(|v| v.as_u64()).unwrap_or(0);
            let cache_age_hours = if now > cache_ts { (now - cache_ts) / 3600 } else { 0 };
            let cache_fresh = cache_age_hours < 24;
            if cache_fresh
                && cache.get("webview2").and_then(|v| v.as_bool()).unwrap_or(false)
                && cache.get("vcredist").and_then(|v| v.as_bool()).unwrap_or(false)
            {
                return; /* 缓存有效且两项都已安装 */
            }
        }
    }

    /* 并行检测 */
    /* V57: 使用 catch_unwind 包装检测函数，防止任一检测 panic 导致整个程序崩溃 */
    let webview2_ok = std::panic::catch_unwind(|| check_webview2_installed()).unwrap_or(false);
    let vcredist_ok = std::panic::catch_unwind(|| check_vcredist_installed()).unwrap_or(false);

    if !webview2_ok {
        show_runtime_error_dialog(
            "Microsoft Edge WebView2 Runtime",
            "https://developer.microsoft.com/zh-cn/microsoft-edge/webview2",
        );
        /* V53: 退出前 Sleep 1 秒，让用户看清对话框结果 */
        std::thread::sleep(SLEEP_ONE_SECOND);
        std::process::exit(1);
    }

    if !vcredist_ok {
        show_runtime_error_dialog(
            "Microsoft Visual C++ 运行库",
            "https://aka.ms/vs/17/release/vc_redist.x64.exe",
        );
        /* V53: 退出前 Sleep 1 秒，让用户看清对话框结果 */
        std::thread::sleep(SLEEP_ONE_SECOND);
        std::process::exit(1);
    }

    /* 写入缓存 */
    let cache = serde_json::json!({
        "webview2": true,
        "vcredist": true,
        "ts": std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0),
    });
    let _ = fs::write(&cache_path, cache.to_string());
}

pub fn run() {
    // debug.log will be lazily created on first macro use
    debug_log!("[V65] APP_VERSION={} starting...", APP_VERSION);

    /* === V52: 启动前检测 WebView2 + VC++ 运行库 ===
       在 Tauri Builder 之前执行，若缺失则弹出 Windows 原生对话框并退出。
       使用 rayon 并行检测两项运行库，保证性能。 */
    check_runtime_dependencies();

    tauri::Builder::default()
        .manage(AppState {
            repair_running: AtomicBool::new(false),
        })

        .setup(|app| {
            /* 【V39】移除 Windows DWM 的窗口阴影和边框
               decorations:false + transparent:true 时 DWM 仍会绘制细线边框和阴影，
               调用 set_shadow(false) 移除 */
            use tauri::Manager;
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_shadow(false);
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            detect_ipv6,
            check_ipv6_connectivity,
            format_ipv6_address,
            copy_to_clipboard,
            is_admin,
            close_window,
            minimize_window,
            run_quick_repair,
            run_deep_repair,
            run_tracert_parse,
            run_v6_probe,
            open_url,
            load_config,
            save_config,
            accept_disclaimer,
            add_history_record,
            save_probe_history,
            clear_history,
            delete_record,
            get_data_directory,
            set_debug_mode,
            get_debug_mode,
            clean_cache_dir,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

/* V69.1: 单元测试（#21）—— 核心纯函数回归保护 */
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extract_host_various() {
        assert_eq!(extract_host_from_target("https://example.com/path?x=1"), "example.com");
        assert_eq!(extract_host_from_target("http://[2001:db8::1]:443/foo"), "2001:db8::1");
        assert_eq!(extract_host_from_target("192.168.1.1:8080"), "192.168.1.1");
        assert_eq!(extract_host_from_target("2001:db8::1%eth0"), "2001:db8::1");
        assert_eq!(extract_host_from_target("example.com"), "example.com");
        assert_eq!(extract_host_from_target("   "), "");
        assert_eq!(extract_host_from_target(""), "");
    }

    #[test]
    fn valid_probe_target() {
        assert!(is_valid_probe_target("2001:db8::1"));
        assert!(is_valid_probe_target("192.168.1.1"));
        assert!(is_valid_probe_target("example.com"));
        assert!(is_valid_probe_target("https://example.com:8080/path"));
        assert!(!is_valid_probe_target(""));
        assert!(!is_valid_probe_target("not a domain!"));
        assert!(!is_valid_probe_target(&"a".repeat(2049)));
    }

    #[test]
    fn compute_metric_all_timeout() {
        let m = compute_metric(vec![None, None, None], 3);
        assert_eq!(m.samples, 0);
        assert!((m.loss_rate - 100.0).abs() < 1e-9);
        assert_eq!(m.total, 3);
    }

    #[test]
    fn compute_metric_perfect() {
        let m = compute_metric(vec![Some(10.0), Some(10.0), Some(10.0)], 3);
        assert_eq!(m.min, 10.0);
        assert_eq!(m.max, 10.0);
        assert_eq!(m.mean, 10.0);
        assert_eq!(m.samples, 3);
        assert!(m.loss_rate.abs() < 1e-9);
    }

    #[test]
    fn compute_metric_loss_clamped() {
        /* 多余匹配行导致 ok > total 时，丢包率不应为负（V48 bug 修复验证） */
        let m = compute_metric(vec![Some(1.0), Some(2.0), Some(3.0), Some(4.0)], 2);
        assert!(m.loss_rate >= 0.0 && m.loss_rate <= 100.0);
    }

    #[test]
    fn sanitize_record_truncates_long_ipv6() {
        let rec = HistoryRecord {
            id: "t1".into(),
            timestamp: 0,
            ipv6_address: "2001:0db8:85a3:0000:0000:8a2e:0370:7334".into(),
            success: true,
            summary: String::new(),
            steps: vec![],
            probe_result: None,
            record_type: "detection".into(),
        };
        let out = sanitize_history_record(rec);
        assert!(out.ipv6_address.contains("..."));
        assert!(out.ipv6_address.chars().count() <= 8 + 3);
        assert!(out.success);
    }

    #[test]
    fn encrypt_decrypt_roundtrip() {
        let plain = b"Hello, IPv6 Tool! This is a test message.";
        let cipher = encrypt_data(plain).expect("encryption should succeed");
        assert!(cipher.len() > HISTORY_NONCE_LEN);
        let decrypted = decrypt_data(&cipher).expect("decryption should succeed");
        assert_eq!(&decrypted, plain);
    }

    #[test]
    fn decrypt_short_cipher_returns_err() {
        let too_short = vec![0u8; 5];
        let result = decrypt_data(&too_short);
        assert!(result.is_err());
    }

    #[test]
    fn encrypt_decrypt_empty_data() {
        let plain = b"";
        let cipher = encrypt_data(plain).expect("encryption of empty data should succeed");
        let decrypted = decrypt_data(&cipher).expect("decryption should succeed");
        assert_eq!(decrypted.len(), 0);
    }

    #[test]
    fn encrypt_decrypt_different_keys_produce_different_ciphertext() {
        let plain = b"consistent message";
        let c1 = encrypt_data(plain).expect("encryption 1");
        let c2 = encrypt_data(plain).expect("encryption 2");
        /* 每次加密使用随机 nonce，密文应不同 */
        assert_ne!(c1, c2, "same plaintext with random nonce must differ");
    }

    #[test]
    fn compute_metric_partial_loss() {
        let m = compute_metric(vec![Some(15.0), None, Some(30.0), None, Some(45.0)], 5);
        assert_eq!(m.samples, 3);
        assert!((m.loss_rate - 40.0).abs() < 1e-9);
        assert_eq!(m.min, 15.0);
        assert_eq!(m.max, 45.0);
        assert!((m.mean - 30.0).abs() < 1e-9);
    }

    #[test]
    fn compute_metric_zero_total() {
        let m = compute_metric(vec![], 0);
        assert_eq!(m.samples, 0);
        assert_eq!(m.total, 0);
        assert_eq!(m.loss_rate, 0.0);
        assert_eq!(m.min, 0.0);
        assert_eq!(m.max, 0.0);
        assert_eq!(m.mean, 0.0);
    }

    #[test]
    fn sanitize_target_url_removes_query() {
        let url = "https://example.com/path?query=1&foo=bar#frag";
        let result = sanitize_target_url(url);
        assert!(!result.contains('?'));
        assert!(!result.contains('#'));
        assert!(result.starts_with("https://example.com/path"));
    }

    #[test]
    fn sanitize_target_url_keeps_simple() {
        let url = "http://[2001:db8::1]:8080/";
        let result = sanitize_target_url(url);
        assert_eq!(result, url);
    }

    #[test]
    fn sanitize_probe_result_removes_large_fields() {
        let mut probe = ProbeResult {
            icmp_rtt: Some(LatencyMetric {
                min: 1.0, max: 10.0, mean: 5.0, p95: 9.0, jitter: 2.0,
                loss_rate: 0.0, samples: 10, total: 10, raw: vec![1.0, 2.0, 3.0],
            }),
            tcp_handshake: None,
            dns_latency: None,
            hop_count: 5,
            first_hop: Some(2.0),
            last_hop: Some(8.0),
            path_latencies: vec![1.0, 2.0, 3.0, 4.0, 5.0],
            summary: "test".into(),
            error: String::new(),
            score: 80,
            score_label: "良好".into(),
        };
        sanitize_probe_result(&mut probe);
        if let Some(ref icmp) = probe.icmp_rtt {
            assert!(icmp.raw.is_empty(), "raw samples should be cleared");
        }
        assert!(probe.path_latencies.is_empty(), "path latencies should be cleared");
    }
}
