// When a present is wrapped: a day of the year ("11-07", every 7 November) or one date
// ("2026-11-07"). Pure: the caller passes today's date, read in the device's local time, so a
// birthday starts at the family's midnight, not at UTC's.

/** @typedef {{month: number, day: number, year?: number}} GiftDay  month 1 to 12 */

/**
 * @param {string | GiftDay} when "MM-DD" (every year), "YYYY-MM-DD" (that day only) or an object
 * @returns {GiftDay}
 */
export function parseWhen(when) {
  if (typeof when === "object" && when !== null) return checked({ month: when.month, day: when.day, year: when.year });
  const m = /^(?:(\d{4})-)?(\d{1,2})-(\d{1,2})$/.exec(String(when).trim());
  if (!m) throw new RangeError(`Gift day "${when}" is not MM-DD or YYYY-MM-DD`);
  return checked({ month: Number(m[2]), day: Number(m[3]), year: m[1] ? Number(m[1]) : undefined });
}

/**
 * Is `date` (local time) the gift day?
 * @param {Date} date
 * @param {string | GiftDay} when
 */
export function isGiftDay(date, when) {
  const w = typeof when === "string" ? parseWhen(when) : when;
  if (date.getMonth() + 1 !== w.month || date.getDate() !== w.day) return false;
  return w.year === undefined || date.getFullYear() === w.year;
}

/** Days in a month; February has 29 unless the year is given and is not a leap year. */
function daysIn(month, year) {
  if (month === 2) return year === undefined || (year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function checked(w) {
  const ok = Number.isInteger(w.month) && w.month >= 1 && w.month <= 12 && Number.isInteger(w.day) && w.day >= 1 && w.day <= 31;
  if (!ok || w.day > daysIn(w.month, w.year)) throw new RangeError(`Gift day ${JSON.stringify(w)} has no such month or day`);
  if (w.year === undefined) delete w.year;
  return w;
}
