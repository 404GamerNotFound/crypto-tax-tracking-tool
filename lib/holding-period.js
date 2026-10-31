// Haltefrist-Berechnung nach Kalenderdaten.
//
// Eine Haltefrist, die ein ganzzahliges Vielfaches von 365 Tagen ist, wird als
// Frist in Kalenderjahren gerechnet (Deutschland: § 23 EStG „nicht mehr als ein
// Jahr“, Fristberechnung nach §§ 187, 188 BGB). Die Frist beginnt am Tag nach
// der Anschaffung und endet mit Ablauf des Tages, der dem Anschaffungstag ein
// Jahr später entspricht. Steuerfrei ist eine Veräußerung daher erst ab dem
// darauffolgenden Tag: Kauf am 15.01.2024 → frei ab 16.01.2025.
//
// Maßgeblich ist das Kalenderdatum in Europe/Berlin, nicht UTC. Andere
// Fristen (z. B. 180 Tage in einem frei angelegten Profil) bleiben eine
// einfache Tagesfrist.

const DAY_MS = 86400000;
const DEFAULT_TIME_ZONE = "Europe/Berlin";
const formatters = new Map();

function formatterFor(timeZone) {
  if (!formatters.has(timeZone)) {
    formatters.set(timeZone, new Intl.DateTimeFormat("en-CA", {
      timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
    }));
  }
  return formatters.get(timeZone);
}

function zonedParts(milliseconds, timeZone = DEFAULT_TIME_ZONE) {
  const parts = Object.fromEntries(formatterFor(timeZone).formatToParts(new Date(milliseconds)).map((part) => [part.type, part.value]));
  return {
    year: Number(parts.year), month: Number(parts.month), day: Number(parts.day),
    hour: Number(parts.hour), minute: Number(parts.minute), second: Number(parts.second),
  };
}

function pad(value, length = 2) {
  return String(value).padStart(length, "0");
}

/** Kalenderdatum (YYYY-MM-DD) eines Zeitpunkts in der angegebenen Zeitzone. */
function calendarDate(timestamp, timeZone = DEFAULT_TIME_ZONE) {
  const milliseconds = typeof timestamp === "number" ? timestamp : Date.parse(timestamp);
  if (!Number.isFinite(milliseconds)) return null;
  const { year, month, day } = zonedParts(milliseconds, timeZone);
  return `${pad(year, 4)}-${pad(month)}-${pad(day)}`;
}

function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Addiert Kalenderjahre; ein 29.02. ohne Entsprechung endet am Monatsletzten (§ 188 Abs. 3 BGB). */
function addCalendarYears(date, years) {
  const [year, month, day] = String(date).split("-").map(Number);
  const targetYear = year + years;
  return `${pad(targetYear, 4)}-${pad(month)}-${pad(Math.min(day, daysInMonth(targetYear, month)))}`;
}

function addCalendarDays(date, days) {
  const [year, month, day] = String(date).split("-").map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return `${pad(shifted.getUTCFullYear(), 4)}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`;
}

/** Beginn (00:00 Uhr) eines Kalendertags in der Zeitzone als UTC-Millisekunden. */
function startOfCalendarDay(date, timeZone = DEFAULT_TIME_ZONE) {
  const [year, month, day] = String(date).split("-").map(Number);
  const guess = Date.UTC(year, month - 1, day);
  const local = zonedParts(guess, timeZone);
  const offset = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute, local.second) - guess;
  return guess - offset;
}

function usesCalendarYears(holdingPeriodDays) {
  const days = Number(holdingPeriodDays);
  return Number.isInteger(days) && days > 0 && days % 365 === 0;
}

/**
 * Liefert den Zeitpunkt, ab dem eine Veräußerung die Haltefrist erfüllt, sowie
 * die Prüffunktion. `null`, wenn das Profil keine Haltefrist kennt oder das
 * Anschaffungsdatum fehlt.
 */
function holdingPeriodRule(acquiredAt, profile, { timeZone = DEFAULT_TIME_ZONE } = {}) {
  if (!profile?.holdingPeriodEnabled) return null;
  const acquiredMs = Date.parse(acquiredAt);
  if (!Number.isFinite(acquiredMs)) return null;
  const days = Number(profile.holdingPeriodDays) || 0;
  if (usesCalendarYears(days)) {
    const periodEnd = addCalendarYears(calendarDate(acquiredMs, timeZone), days / 365);
    const eligibleDate = addCalendarDays(periodEnd, 1);
    return {
      mode: "calendar",
      eligibleDate,
      eligibleAtMs: startOfCalendarDay(eligibleDate, timeZone),
      isMetAt: (timestamp) => {
        const date = calendarDate(timestamp, timeZone);
        return date !== null && date >= eligibleDate;
      },
    };
  }
  const eligibleAtMs = acquiredMs + days * DAY_MS;
  return {
    mode: "days",
    eligibleDate: calendarDate(eligibleAtMs, timeZone),
    eligibleAtMs,
    isMetAt: (timestamp) => {
      const milliseconds = typeof timestamp === "number" ? timestamp : Date.parse(timestamp);
      return Number.isFinite(milliseconds) && milliseconds >= eligibleAtMs;
    },
  };
}

function isHoldingPeriodMet(acquiredAt, disposedAt, profile, options) {
  const rule = holdingPeriodRule(acquiredAt, profile, options);
  return rule ? rule.isMetAt(disposedAt) : false;
}

module.exports = {
  DEFAULT_TIME_ZONE,
  addCalendarDays,
  addCalendarYears,
  calendarDate,
  holdingPeriodRule,
  isHoldingPeriodMet,
  startOfCalendarDay,
  usesCalendarYears,
};
