/** Returns the UTC offset (in minutes, tz - UTC) of the given timezone at
 *  the given instant. */
function getTzOffsetMinutes(timezone: string, date: Date): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = dtf.formatToParts(date).reduce((acc, p) => {
    acc[p.type] = p.value;
    return acc;
  }, {} as Record<string, string>);

  const asUTC = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  return (asUTC - date.getTime()) / 60000;
}

/** Returns the real UTC instant corresponding to the next local midnight
 *  (00:00) in the given IANA timezone, relative to now. Small imprecision
 *  is possible right at a DST transition boundary — acceptable for a
 *  daily quota reset. */
export function getNextLocalMidnightUTC(timezone: string): Date {
  const now = new Date();
  let offsetMin: number;
  try {
    offsetMin = getTzOffsetMinutes(timezone, now);
  } catch {
    offsetMin = 0; // Unknown/invalid timezone — fall back to UTC.
  }

  const localNow = new Date(now.getTime() + offsetMin * 60000);
  const nextLocalMidnight = new Date(
    Date.UTC(localNow.getUTCFullYear(), localNow.getUTCMonth(), localNow.getUTCDate() + 1, 0, 0, 0),
  );
  return new Date(nextLocalMidnight.getTime() - offsetMin * 60000);
}
