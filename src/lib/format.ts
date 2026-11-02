export function formatBytes(n: number): string {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let v = n;
  let u = 0;
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024;
    u++;
  }
  const decimals = v >= 100 || u === 0 ? 0 : 1;
  return `${v.toFixed(decimals)} ${units[u]}`;
}

export function formatTime(epochSeconds: number): string {
  if (!epochSeconds) return "";
  const d = new Date(epochSeconds * 1000);
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function parentPath(path: string, isWindowsLike = false): string {
  if (!path) return path;
  const sep = isWindowsLike ? "\\" : "/";
  const trimmed = path.replace(/[\\/]+$/, "");
  const idx = trimmed.lastIndexOf(sep);
  if (idx <= 0) return isWindowsLike && /^[A-Za-z]:/.test(trimmed) ? trimmed + sep : "";
  return trimmed.slice(0, idx) + (idx === 2 && /^[A-Za-z]:/.test(trimmed) ? sep : "");
}

export function joinPath(dir: string, name: string, isWindowsLike = false): string {
  const sep = isWindowsLike ? "\\" : "/";
  if (!dir) return name;
  if (dir.endsWith(sep)) return dir + name;
  return dir + sep + name;
}
