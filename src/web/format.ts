/** Display helpers. Money in the sim is in $k. */

export const money = (k: number): string => {
  const sign = k < 0 ? "−" : "";
  const abs = Math.abs(k);
  return abs >= 1000 ? `${sign}$${(abs / 1000).toFixed(2)}M` : `${sign}$${Math.round(abs)}k`;
};

export const km = (m: number, digits = 1): string => `${(m / 1000).toFixed(digits)} km`;
export const kPa = (pa: number): string => `${(pa / 1000).toFixed(1)} kPa`;
export const seconds = (s: number): string => `${s.toFixed(s < 10 ? 1 : 0)} s`;
export const pct = (x: number): string => `${x >= 0 ? "+" : "−"}${Math.abs(x * 100).toFixed(1)}%`;
export const signed = (n: number): string => (n > 0 ? `+${n}` : `${n}`);

/** Day 0 of every run. Days are the sim's clock; dates make the calendar readable. */
const EPOCH = Date.UTC(2027, 0, 4);
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export const dateOf = (day: number): Date => new Date(EPOCH + day * 86_400_000);
export const dayOf = (date: Date): number => Math.round((date.getTime() - EPOCH) / 86_400_000);
export const shortDate = (day: number): string => {
  const d = dateOf(day);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
};
export const monthName = (year: number, month: number): string => `${MONTHS[month]} ${year}`;
