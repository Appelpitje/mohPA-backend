const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
];

/**
 * Formats a Date object into EA FESL curTime string format: "Mmm-DD-YYYY HH:mm:ss UTC"
 * Example: "Sep-02-2026 14:30:00 UTC"
 */
export function formatFeslDate(date: Date = new Date()): string {
  const month = MONTHS[date.getUTCMonth()];
  const day = String(date.getUTCDate()).padStart(2, '0');
  const year = date.getUTCFullYear();
  const hours = String(date.getUTCHours()).padStart(2, '0');
  const minutes = String(date.getUTCMinutes()).padStart(2, '0');
  const seconds = String(date.getUTCSeconds()).padStart(2, '0');

  return `${month}-${day}-${year} ${hours}:${minutes}:${seconds} UTC`;
}

/**
 * Parses an EA FESL formatted date string back into a Date object.
 */
export function parseFeslDate(dateStr: string): Date | null {
  const trimmed = dateStr.replace(/^["']|["']$/g, '').trim();
  const match = trimmed.match(/^([A-Za-z]{3})-(\d{1,2})-(\d{4})\s+(\d{2}):(\d{2}):(\d{2})\s*(UTC|GMT)?$/);
  if (!match) {
    const timestamp = Date.parse(trimmed);
    return isNaN(timestamp) ? null : new Date(timestamp);
  }

  const [, monthStr, dayStr, yearStr, hourStr, minStr, secStr] = match;
  const monthIndex = MONTHS.findIndex((m) => m.toLowerCase() === monthStr.toLowerCase());
  if (monthIndex === -1) return null;

  const date = new Date(Date.UTC(
    parseInt(yearStr, 10),
    monthIndex,
    parseInt(dayStr, 10),
    parseInt(hourStr, 10),
    parseInt(minStr, 10),
    parseInt(secStr, 10)
  ));

  return isNaN(date.getTime()) ? null : date;
}
