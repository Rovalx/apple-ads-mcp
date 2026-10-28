const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function validateDate(value: string, fieldName: string): void {
  if (!DATE_RE.test(value) || isNaN(Date.parse(value))) {
    throw new Error(`Invalid ${fieldName}: "${value}". Expected YYYY-MM-DD format.`);
  }
}

/** Campaign reports reject MONTHLY unless the range covers whole calendar months. */
export function validateMonthlyRange(startDate: string, endDate: string, granularity?: string): void {
  if (granularity !== "MONTHLY") return;
  if (!startDate.endsWith("-01")) {
    throw new Error(
      `MONTHLY granularity requires startDate on the first day of a month (YYYY-MM-01). Got "${startDate}".`
    );
  }
  const [year, month, day] = endDate.split("-").map(Number);
  const lastDay = new Date(Date.UTC(year!, month!, 0)).getUTCDate();
  if (day !== lastDay) {
    const monthText = String(month).padStart(2, "0");
    throw new Error(
      `MONTHLY granularity requires endDate on the last day of a month. Got "${endDate}"; ${year}-${monthText} ends on day ${lastDay}.`
    );
  }
}
