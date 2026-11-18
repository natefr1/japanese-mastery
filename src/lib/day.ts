/** Local calendar day as YYYY-MM-DD, and its start in unix ms. Days roll over at 4am,
 *  so a late-night session still counts for the same day. */
const ROLLOVER_HOURS = 4;

export function studyDate(now = new Date()): Date {
  const d = new Date(now.getTime() - ROLLOVER_HOURS * 3600_000);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function localDay(now = new Date()): string {
  const d = studyDate(now);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function dayStart(now = new Date()): number {
  return studyDate(now).getTime() + ROLLOVER_HOURS * 3600_000;
}
