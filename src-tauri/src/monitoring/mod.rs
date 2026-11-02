//! Live server statistics polled over exec channels of an existing SSH
//! session. Nothing is installed remotely: the watcher runs `cat`, `df`,
//! `uname` and `ps` every few seconds and parses /proc-style output.

pub mod stats_parser;

use serde::Serialize;
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::oneshot;

use crate::ssh::{self, SshManager};
use stats_parser::{
    cpu_percent_between, parse_cpu_stat, parse_df, parse_loadavg, parse_meminfo, parse_net_dev,
    parse_os_release, parse_ps_top, parse_uptime, CpuTimes, ProcInfo, SystemStats,
};

const POLL_INTERVAL: Duration = Duration::from_secs(5);
const TOP_PROCS: usize = 5;

/// Probe commands executed sequentially once per tick. Output order matches
/// the fields of `RawSample` below.
const PROBES: [&str; 8] = [
    "cat /proc/loadavg /proc/stat",
    "cat /proc/meminfo",
    "df -k -P",
    "cat /proc/net/dev",
    "cat /proc/uptime",
    "cat /etc/os-release 2>/dev/null || cat /usr/lib/os-release 2>/dev/null",
    "uname -r",
    "ps axo pcpu=,pmem=,comm=",
];

/// Registry of per-session polling tasks.
pub struct MonitoringManager {
    watchers: Mutex<HashMap<String, WatcherHandle>>,
}

impl Default for MonitoringManager {
    fn default() -> Self {
        Self {
            watchers: Mutex::new(HashMap::new()),
        }
    }
}

/// Cancels the polling task when `cancel` is fired.
pub struct WatcherHandle {
    cancel: oneshot::Sender<()>,
}

impl MonitoringManager {
    /// Starts polling unless a watcher for this session already exists.
    /// Returns `true` when a watcher was already running.
    pub fn ensure_started(&self, app: AppHandle, session_id: &str) -> bool {
        let mut watchers = self.watchers.lock().unwrap();
        if watchers.contains_key(session_id) {
            return true;
        }
        let (cancel, cancelled) = oneshot::channel();
        watchers.insert(session_id.to_string(), WatcherHandle { cancel });
        drop(watchers);
        tokio::spawn(watcher_loop(app, session_id.to_string(), cancelled));
        false
    }

    /// Stops and removes the watcher; a no-op when it is not running.
    pub fn stop(&self, session_id: &str) {
        if let Some(handle) = self.watchers.lock().unwrap().remove(session_id) {
            let _ = handle.cancel.send(());
        }
    }

    /// Whether a watcher is currently polling this session.
    pub fn is_running(&self, session_id: &str) -> bool {
        self.watchers.lock().unwrap().contains_key(session_id)
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct MonitorStatsEvent<'a> {
    session_id: &'a str,
    stats: &'a SystemStats,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct MonitorErrorEvent<'a> {
    session_id: &'a str,
    message: &'a str,
}

/// Raw probe outputs, in `PROBES` order.
#[derive(Default)]
struct RawSample {
    load_stat: String,
    meminfo: String,
    df: String,
    netdev: String,
    uptime: String,
    os_release: String,
    kernel: String,
    ps: String,
}

/// Previous network counters plus the moment they were taken, so the next
/// sample can be turned into bytes per second.
struct NetSample {
    rx: u64,
    tx: u64,
    at: Instant,
}

async fn watcher_loop(app: AppHandle, session_id: String, mut cancelled: oneshot::Receiver<()>) {
    let ssh = app.state::<SshManager>();
    let monitoring = app.state::<MonitoringManager>();
    let mut interval = tokio::time::interval(POLL_INTERVAL);
    interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    let mut prev_cpu: Option<CpuTimes> = None;
    let mut prev_net: Option<NetSample> = None;

    loop {
        tokio::select! {
            // The panel closed or the watcher was replaced.
            _ = &mut cancelled => break,
            _ = interval.tick() => {}
        }

        let mut errors: Vec<String> = Vec::new();
        let Some(raw) = gather_raw(&ssh, &session_id, &mut errors).await else {
            // The session is gone: report once and stop polling.
            let _ = app.emit(
                "monitor:error",
                &MonitorErrorEvent {
                    session_id: &session_id,
                    message: "session_not_found",
                },
            );
            break;
        };

        let stats = build_stats(&raw, &mut prev_cpu, &mut prev_net);
        let _ = app.emit(
            "monitor:stats",
            &MonitorStatsEvent {
                session_id: &session_id,
                stats: &stats,
            },
        );
        if !errors.is_empty() {
            let _ = app.emit(
                "monitor:error",
                &MonitorErrorEvent {
                    session_id: &session_id,
                    message: &errors.join("; "),
                },
            );
        }
    }

    monitoring.watchers.lock().unwrap().remove(&session_id);
}

/// Runs every probe in its own exec channel, one after another. Individual
/// failures are collected into `errors` (polling continues with empty
/// output); a vanished session yields `None`.
async fn gather_raw(
    ssh: &SshManager,
    session_id: &str,
    errors: &mut Vec<String>,
) -> Option<RawSample> {
    let mut outputs: Vec<String> = Vec::with_capacity(PROBES.len());
    for cmd in PROBES {
        match ssh::exec(ssh, session_id, cmd).await {
            Ok((_, text)) => outputs.push(text),
            Err(e) if e == "session_not_found" => return None,
            Err(e) => {
                errors.push(e);
                outputs.push(String::new());
            }
        }
    }
    let Ok([load_stat, meminfo, df, netdev, uptime, os_release, kernel, ps]) =
        <[String; 8]>::try_from(outputs)
    else {
        return None; // unreachable: exactly one output per probe
    };
    Some(RawSample {
        load_stat,
        meminfo,
        df,
        netdev,
        uptime,
        os_release,
        kernel,
        ps,
    })
}

/// Turns one raw sample into metrics, diffing CPU jiffies and network byte
/// counters against the previous sample (first iteration: `None` for CPU
/// and 0 B/s for the network).
fn build_stats(
    raw: &RawSample,
    prev_cpu: &mut Option<CpuTimes>,
    prev_net: &mut Option<NetSample>,
) -> SystemStats {
    let mem = parse_meminfo(&raw.meminfo);

    let cpu_times = parse_cpu_stat(&raw.load_stat);
    let cpu_percent = match (*prev_cpu, cpu_times) {
        (Some(prev), Some(cur)) => cpu_percent_between(&prev, &cur),
        _ => None,
    };
    if cpu_times.is_some() {
        *prev_cpu = cpu_times;
    }

    let (rx, tx) = parse_net_dev(&raw.netdev);
    let (net_rx_bps, net_tx_bps) = match prev_net.take() {
        None => (0, 0),
        Some(prev) => {
            let elapsed = prev.at.elapsed().as_secs_f64();
            if elapsed < 1.0 || rx < prev.rx || tx < prev.tx {
                // Interval too short or counters reset (interface recreated).
                (0, 0)
            } else {
                (
                    ((rx - prev.rx) as f64 / elapsed) as u64,
                    ((tx - prev.tx) as f64 / elapsed) as u64,
                )
            }
        }
    };
    *prev_net = Some(NetSample {
        rx,
        tx,
        at: Instant::now(),
    });

    let mut top: Vec<ProcInfo> = parse_ps_top(&raw.ps);
    top.sort_by(|a, b| {
        b.cpu_percent
            .partial_cmp(&a.cpu_percent)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    top.truncate(TOP_PROCS);

    SystemStats {
        cpu_percent,
        load: parse_loadavg(&raw.load_stat),
        mem_used: mem.mem_used,
        mem_total: mem.mem_total,
        swap_used: mem.swap_used,
        swap_total: mem.swap_total,
        disks: parse_df(&raw.df),
        net_rx_bps,
        net_tx_bps,
        uptime_secs: parse_uptime(&raw.uptime),
        os_name: parse_os_release(&raw.os_release),
        kernel: raw.kernel.lines().next().unwrap_or("").trim().to_string(),
        top,
    }
}
