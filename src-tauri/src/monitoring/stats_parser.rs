//! Pure parsers for /proc files and standard tool output.
//!
//! Nothing is installed on the remote server: the watcher runs `cat`, `df`,
//! `uname` and `ps` over exec channels of the existing SSH session and these
//! functions turn the raw text into metrics. All sizes are in bytes.

use serde::Serialize;

/// One filesystem from `df -k -P`.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiskUsage {
    pub mount: String,
    pub used: u64,
    pub total: u64,
}

/// One process from `ps axo pcpu=,pmem=,comm=`.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcInfo {
    pub name: String,
    pub cpu_percent: f32,
    pub mem_percent: f32,
}

/// Full snapshot emitted to the frontend as `monitor:stats`.
#[derive(Debug, Clone, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemStats {
    /// `None` until two consecutive samples exist to diff.
    pub cpu_percent: Option<f32>,
    pub load: [f32; 3],
    pub mem_used: u64,
    pub mem_total: u64,
    pub swap_used: u64,
    pub swap_total: u64,
    pub disks: Vec<DiskUsage>,
    pub net_rx_bps: u64,
    pub net_tx_bps: u64,
    pub uptime_secs: u64,
    pub os_name: String,
    pub kernel: String,
    pub top: Vec<ProcInfo>,
}

/// Memory and swap figures from /proc/meminfo, in bytes.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct MemInfo {
    pub mem_used: u64,
    pub mem_total: u64,
    pub swap_used: u64,
    pub swap_total: u64,
}

/// Aggregate CPU counters from /proc/stat.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CpuTimes {
    pub idle: u64,
    pub total: u64,
}

/// Filesystem types hidden from the disk list (virtual or loop devices).
const SKIPPED_FS: [&str; 4] = ["tmpfs", "devtmpfs", "overlay", "loop"];

/// First three load averages; the first line is used so the combined
/// `cat /proc/loadavg /proc/stat` output works too. Missing values are 0.
pub fn parse_loadavg(text: &str) -> [f32; 3] {
    let first = text.lines().next().unwrap_or("");
    let mut fields = first.split_whitespace();
    let mut out = [0.0f32; 3];
    for slot in &mut out {
        *slot = fields
            .next()
            .and_then(|f| f.parse().ok())
            .unwrap_or_default();
    }
    out
}

/// Memory usage from /proc/meminfo. `used` prefers MemAvailable and falls
/// back to MemFree on old kernels. Missing files yield zeros.
pub fn parse_meminfo(text: &str) -> MemInfo {
    let mut total = 0u64;
    let mut free: Option<u64> = None;
    let mut available: Option<u64> = None;
    let mut swap_total = 0u64;
    let mut swap_free: Option<u64> = None;

    for line in text.lines() {
        let Some((key, value)) = line.split_once(':') else {
            continue;
        };
        let value = value
            .split_whitespace()
            .next()
            .and_then(|v| v.parse::<u64>().ok())
            .unwrap_or_default();
        match key.trim() {
            "MemTotal" => total = value,
            "MemFree" => free = Some(value),
            "MemAvailable" => available = Some(value),
            "SwapTotal" => swap_total = value,
            "SwapFree" => swap_free = Some(value),
            _ => {}
        }
    }

    MemInfo {
        mem_used: total.saturating_sub(available.or(free).unwrap_or_default()) * 1024,
        mem_total: total * 1024,
        swap_used: swap_total.saturating_sub(swap_free.unwrap_or_default()) * 1024,
        swap_total: swap_total * 1024,
    }
}

/// Mounted real filesystems from `df -k -P`, converted to bytes.
/// Virtual filesystems (tmpfs/devtmpfs/overlay/loop*) and empty entries are
/// skipped; mount points containing spaces are preserved.
pub fn parse_df(text: &str) -> Vec<DiskUsage> {
    let mut disks = Vec::new();
    for line in text.lines() {
        let mut fields = line.split_whitespace();
        let Some(fs) = fields.next() else {
            continue;
        };
        let number = |v: Option<&str>| v.and_then(|s| s.parse::<u64>().ok());
        let (Some(total_kb), Some(used_kb)) = (number(fields.next()), number(fields.next())) else {
            continue; // header, error message or a truncated line
        };
        // Skip the "available" and "capacity" columns, then the rest of the
        // line is the mount point, which may contain spaces.
        fields.next();
        fields.next();
        let mount = fields.collect::<Vec<_>>().join(" ");
        if mount.is_empty() || total_kb == 0 {
            continue;
        }
        let base = fs.rsplit('/').next().unwrap_or(fs);
        if SKIPPED_FS.iter().any(|prefix| base.starts_with(prefix)) {
            continue;
        }
        disks.push(DiskUsage {
            mount,
            used: used_kb.saturating_mul(1024),
            total: total_kb.saturating_mul(1024),
        });
    }
    disks
}

/// Summed rx/tx byte counters over active interfaces of /proc/net/dev.
/// The loopback interface and fully idle interfaces are excluded; the caller
/// computes the deltas between samples.
pub fn parse_net_dev(text: &str) -> (u64, u64) {
    let mut total_rx = 0u64;
    let mut total_tx = 0u64;
    for line in text.lines() {
        let Some((name, rest)) = line.split_once(':') else {
            continue;
        };
        let name = name.trim();
        if name.is_empty() || name == "lo" {
            continue;
        }
        let values: Vec<u64> = rest
            .split_whitespace()
            .filter_map(|v| v.parse().ok())
            .collect();
        if values.len() < 9 {
            continue;
        }
        let (rx, tx) = (values[0], values[8]);
        if rx == 0 && tx == 0 {
            continue; // interface exists but is down/unused
        }
        total_rx = total_rx.saturating_add(rx);
        total_tx = total_tx.saturating_add(tx);
    }
    (total_rx, total_tx)
}

/// Seconds since boot from /proc/uptime ("12345.67 23456.78").
pub fn parse_uptime(text: &str) -> u64 {
    text.split_whitespace()
        .next()
        .and_then(|v| v.parse::<f64>().ok())
        .map(|v| v as u64)
        .unwrap_or_default()
}

/// PRETTY_NAME from /etc/os-release (quotes stripped); empty when missing.
pub fn parse_os_release(text: &str) -> String {
    for line in text.lines() {
        if let Some(value) = line.strip_prefix("PRETTY_NAME=") {
            return value
                .trim()
                .trim_matches(|c| c == '"' || c == '\'')
                .to_string();
        }
    }
    String::new()
}

/// Processes from `ps axo pcpu=,pmem=,comm=`; header/error lines are skipped.
/// The returned list is unsorted — the caller picks the top entries.
pub fn parse_ps_top(text: &str) -> Vec<ProcInfo> {
    let mut procs = Vec::new();
    for line in text.lines() {
        let mut fields = line.split_whitespace();
        let Some(cpu) = fields.next().and_then(|v| v.parse::<f32>().ok()) else {
            continue;
        };
        let Some(mem) = fields.next().and_then(|v| v.parse::<f32>().ok()) else {
            continue;
        };
        let name = fields.collect::<Vec<_>>().join(" ");
        if name.is_empty() {
            continue;
        }
        procs.push(ProcInfo {
            name,
            cpu_percent: cpu,
            mem_percent: mem,
        });
    }
    procs
}

/// Aggregate `cpu` line of /proc/stat: total across all jiffy counters and
/// the idle portion (idle + iowait). `None` when the line is absent.
pub fn parse_cpu_stat(text: &str) -> Option<CpuTimes> {
    for line in text.lines() {
        let Some(rest) = line.strip_prefix("cpu ") else {
            continue;
        };
        let fields: Vec<u64> = rest
            .split_whitespace()
            .filter_map(|v| v.parse().ok())
            .collect();
        if fields.is_empty() {
            return None;
        }
        let total: u64 = fields.iter().sum();
        let idle =
            fields.get(3).copied().unwrap_or_default() + fields.get(4).copied().unwrap_or_default();
        return Some(CpuTimes { idle, total });
    }
    None
}

/// Busy percentage between two /proc/stat samples. `None` when the counters
/// did not advance (or went backwards, e.g. after a VM suspend).
pub fn cpu_percent_between(prev: &CpuTimes, cur: &CpuTimes) -> Option<f32> {
    let d_total = cur.total.checked_sub(prev.total)?;
    let d_idle = cur.idle.checked_sub(prev.idle)?;
    if d_total == 0 {
        return None;
    }
    Some((((d_total - d_idle) as f32) / d_total as f32 * 100.0).clamp(0.0, 100.0))
}

#[cfg(test)]
mod tests {
    use super::*;

    const LOADAVG_AND_STAT: &str = "0.52 0.58 0.59 2/1823 45670\ncpu  74608 2520 24433 1115322 6176 4054 0 0 0 0\ncpu0 37304 1260 12216 557661 3088 2027 0 0 0 0\n";

    #[test]
    fn loadavg_parses_first_line_of_combined_output() {
        assert_eq!(parse_loadavg(LOADAVG_AND_STAT), [0.52, 0.58, 0.59]);
        // Missing trailing fields fall back to zero.
        assert_eq!(parse_loadavg("1.10 2.20"), [1.10, 2.20, 0.0]);
        assert_eq!(parse_loadavg(""), [0.0; 3]);
        assert_eq!(parse_loadavg("garbage\nmore"), [0.0; 3]);
    }

    #[test]
    fn meminfo_prefers_available_and_converts_to_bytes() {
        let out = "\
MemTotal:       16305384 kB
MemFree:         1234567 kB
MemAvailable:    8901234 kB
Buffers:          345678 kB
Cached:          4567890 kB
SwapTotal:       2097148 kB
SwapFree:        1048576 kB
HugePages_Total:       0
";
        let mem = parse_meminfo(out);
        assert_eq!(mem.mem_total, 16_305_384 * 1024);
        assert_eq!(mem.mem_used, (16_305_384 - 8_901_234) * 1024);
        assert_eq!(mem.swap_total, 2_097_148 * 1024);
        assert_eq!(mem.swap_used, (2_097_148 - 1_048_576) * 1024);
    }

    #[test]
    fn meminfo_falls_back_to_free_and_tolerates_missing_fields() {
        // Old kernel without MemAvailable and without swap at all.
        let mem = parse_meminfo("MemTotal: 1000 kB\nMemFree: 400 kB\n");
        assert_eq!(mem.mem_used, 600 * 1024);
        assert_eq!(mem.swap_total, 0);
        assert_eq!(mem.swap_used, 0);
        // Empty or garbage output yields zeros.
        assert_eq!(parse_meminfo(""), MemInfo::default());
        assert_eq!(
            parse_meminfo("no colon line\nBad: line"),
            MemInfo::default()
        );
    }

    #[test]
    fn df_skips_virtual_filesystems_and_keeps_spaced_mounts() {
        let out = "\
Filesystem     1024-blocks      Used Available Capacity Mounted on
/dev/sda1         40188992  12345678  25766746      33% /
tmpfs              2048000         0   2048000       0% /dev/shm
devtmpfs            1024000         0   1024000       0% /dev
overlay            40188992  12345678  25766746      33% /var/lib/docker/merged
/dev/loop0           126912    126912         0     100% /snap/core20/1891
//192.168.1.10/share  1000000    500000    500000      50% /mnt/nas volume my share
/dev/nvme0n1p2     82042368  41021184  36854784      53% /media/user/Storage Drive
";
        let disks = parse_df(out);
        assert_eq!(
            disks,
            vec![
                DiskUsage {
                    mount: "/".into(),
                    used: 12_345_678 * 1024,
                    total: 40_188_992 * 1024
                },
                DiskUsage {
                    mount: "/mnt/nas volume my share".into(),
                    used: 500_000 * 1024,
                    total: 1_000_000 * 1024
                },
                DiskUsage {
                    mount: "/media/user/Storage Drive".into(),
                    used: 41_021_184 * 1024,
                    total: 82_042_368 * 1024
                },
            ]
        );
    }

    #[test]
    fn df_handles_empty_and_garbage_output() {
        assert!(parse_df("").is_empty());
        assert!(parse_df("df: /mnt/x: Permission denied").is_empty());
        // Header only.
        assert!(parse_df("Filesystem 1024-blocks Used Available Capacity Mounted on").is_empty());
    }

    #[test]
    fn net_dev_sums_active_interfaces_and_skips_lo() {
        let out = "\
Inter-|   Receive                                                |  Transmit
 face |bytes    packets errs drop fifo frame compressed multicast|bytes    packets errs drop fifo colls carrier compressed
    lo: 1234567    9876    0    0    0     0          0         0  1234567    9876    0    0    0     0       0          0
  eth0: 987654321 123456    0    0    0     0          0         0  876543210 123456    0    0    0     0       0          0
  eth1:  1000000   1000    0    0    0     0          0         0   2000000   2000    0    0    0     0       0          0
 wg0:        0       0    0    0    0     0          0         0        0       0    0    0    0     0       0          0
";
        assert_eq!(
            parse_net_dev(out),
            (987_654_321 + 1_000_000, 876_543_210 + 2_000_000)
        );
        assert_eq!(parse_net_dev(""), (0, 0));
        assert_eq!(parse_net_dev("no colons here\n"), (0, 0));
    }

    #[test]
    fn uptime_and_os_release_parse() {
        assert_eq!(parse_uptime("84512.35 330123.90\n"), 84_512);
        assert_eq!(parse_uptime(""), 0);
        assert_eq!(parse_uptime("garbage"), 0);

        let os = "NAME=\"Ubuntu\"\nPRETTY_NAME=\"Ubuntu 22.04.4 LTS\"\nVERSION_ID=\"22.04\"\n";
        assert_eq!(parse_os_release(os), "Ubuntu 22.04.4 LTS");
        assert_eq!(parse_os_release("PRETTY_NAME='Debian 12'\n"), "Debian 12");
        assert_eq!(parse_os_release(""), "");
        assert_eq!(parse_os_release("NAME=\"Alpine\"\n"), "");
    }

    #[test]
    fn ps_top_skips_headers_and_errors() {
        let out = "\
 12.3  4.5 firefox-bin
  8.1  2.0 code
  0.0  0.1 bash
ps: invalid option -- 'x'
";
        let procs = parse_ps_top(out);
        assert_eq!(
            procs,
            vec![
                ProcInfo {
                    name: "firefox-bin".into(),
                    cpu_percent: 12.3,
                    mem_percent: 4.5
                },
                ProcInfo {
                    name: "code".into(),
                    cpu_percent: 8.1,
                    mem_percent: 2.0
                },
                ProcInfo {
                    name: "bash".into(),
                    cpu_percent: 0.0,
                    mem_percent: 0.1
                },
            ]
        );
        assert!(parse_ps_top("").is_empty());
        assert!(parse_ps_top(" %CPU %MEM COMMAND").is_empty());
    }

    #[test]
    fn cpu_stat_delta_produces_percent() {
        let prev = parse_cpu_stat(LOADAVG_AND_STAT).unwrap();
        assert_eq!(prev.total, 74608 + 2520 + 24433 + 1_115_322 + 6176 + 4054);
        assert_eq!(prev.idle, 1_115_322 + 6176);

        // 100 total jiffies, 30 idle -> 70% busy.
        let cur = CpuTimes {
            idle: prev.idle + 30,
            total: prev.total + 100,
        };
        let pct = cpu_percent_between(&prev, &cur).unwrap();
        assert!((pct - 70.0).abs() < 0.01);
        // Counters reset or did not advance -> None.
        assert!(cpu_percent_between(&cur, &prev).is_none());
        assert!(cpu_percent_between(&prev, &prev).is_none());
        assert!(parse_cpu_stat("").is_none());
        assert!(parse_cpu_stat("cpu0 1 2 3 4\n").is_none());
    }
}
