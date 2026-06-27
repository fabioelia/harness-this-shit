export function relativeTime(ts: number | null | undefined): string {
  if (!ts) return '—';
  const diff = ts - Date.now();
  const abs = Math.abs(diff);
  const m = 60_000, h = 3_600_000, d = 86_400_000;
  const fmt = (n: number, unit: string) => `${n}${unit}`;
  let str: string;
  if (abs < m) str = 'just now';
  else if (abs < h) str = fmt(Math.round(abs / m), 'm');
  else if (abs < d) str = fmt(Math.round(abs / h), 'h');
  else str = fmt(Math.round(abs / d), 'd');
  if (str === 'just now') return str;
  return diff < 0 ? `${str} ago` : `in ${str}`;
}

export function duration(sec: number | null | undefined): string {
  if (sec == null) return '—';
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  if (m < 60) return s ? `${m}m ${s}s` : `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

export function money(n: number | null | undefined): string {
  if (n == null) return '—';
  return `$${n.toFixed(2)}`;
}

export function percent(n: number): string {
  return `${Math.round(n * 100)}%`;
}

export function pluralize(n: number, one: string, many = one + 's'): string {
  return `${n} ${n === 1 ? one : many}`;
}
