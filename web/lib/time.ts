/** Relative-time label via the native Intl API. No runtime imports, so `node --test` loads it. */

const RELATIVE = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

/** Formats a past timestamp as "N units ago"; future as "in N units"; ~now as "now". */
export function timeAgo(timestamp: number, now: number = Date.now()): string {
  const seconds = Math.round((timestamp - now) / 1000);
  const magnitude = Math.abs(seconds);
  if (magnitude < 60) return RELATIVE.format(seconds, "second");
  if (magnitude < 3600) return RELATIVE.format(Math.round(seconds / 60), "minute");
  if (magnitude < 86400) return RELATIVE.format(Math.round(seconds / 3600), "hour");
  if (magnitude < 2_592_000) return RELATIVE.format(Math.round(seconds / 86400), "day");
  if (magnitude < 31_536_000) return RELATIVE.format(Math.round(seconds / 2_592_000), "month");
  return RELATIVE.format(Math.round(seconds / 31_536_000), "year");
}
