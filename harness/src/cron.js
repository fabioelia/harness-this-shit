// Schedule triggers: 5-field cron (tz-aware), `every` intervals with jitter,
// one-shot `at`. Ported from the Switchboard server's dependency-free matcher,
// extended with timezone evaluation via Intl (no tz database dependency).

function cronFieldMatch(field, val, min, max) {
  if (field === '*' || field === '?') return true;
  for (const part of String(field).split(',')) {
    const [rangePart, stepPart] = part.split('/');
    const step = stepPart ? parseInt(stepPart, 10) || 1 : 1;
    let lo, hi;
    if (rangePart === '*') { lo = min; hi = max; }
    else if (rangePart.includes('-')) { const [a, b] = rangePart.split('-').map(Number); lo = a; hi = b; }
    else { lo = hi = Number(rangePart); }
    if (Number.isNaN(lo) || Number.isNaN(hi)) continue;
    for (let v = lo; v <= hi; v += step) if (v === val) return true;
  }
  return false;
}

// Wall-clock components of `date` in `tz` (IANA name). Falls back to local time
// on an unknown zone — callers should have linted the tz at load.
export function zonedParts(date, tz) {
  if (!tz) {
    return { minute: date.getMinutes(), hour: date.getHours(), day: date.getDate(), month: date.getMonth() + 1, dow: date.getDay() };
  }
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone: tz, minute: 'numeric', hour: 'numeric', hourCycle: 'h23', day: 'numeric', month: 'numeric', weekday: 'short' });
  const parts = Object.fromEntries(fmt.formatToParts(date).filter((p) => p.type !== 'literal').map((p) => [p.type, p.value]));
  const DOW = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return { minute: +parts.minute, hour: +parts.hour, day: +parts.day, month: +parts.month, dow: DOW[parts.weekday] ?? 0 };
}

export function cronMatches(expr, date, tz) {
  const p = String(expr).trim().split(/\s+/);
  if (p.length !== 5) return false;
  const z = zonedParts(date, tz);
  return cronFieldMatch(p[0], z.minute, 0, 59)
    && cronFieldMatch(p[1], z.hour, 0, 23)
    && cronFieldMatch(p[2], z.day, 1, 31)
    && cronFieldMatch(p[3], z.month, 1, 12)
    && cronFieldMatch(p[4], z.dow, 0, 6);
}

export function validTz(tz) {
  if (!tz) return true;
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch { return false; }
}

// A once-per-matching-minute stamp so a <60s tick never double-fires.
export const minuteStamp = (date, tz) => {
  const z = zonedParts(date, tz);
  return `${date.getUTCFullYear()}-${date.getUTCMonth()}-${date.getUTCDate()}T${z.hour}:${z.minute}`;
};

// Next cron fire time (for status display) — scans minute-by-minute, capped at 8 days.
export function nextCronFire(expr, tz, from = new Date()) {
  const start = new Date(from.getTime() + 60_000 - (from.getTime() % 60_000));
  for (let i = 0; i < 8 * 24 * 60; i++) {
    const d = new Date(start.getTime() + i * 60_000);
    if (cronMatches(expr, d, tz)) return d;
  }
  return null;
}
