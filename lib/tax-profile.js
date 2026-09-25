const DEFAULT_INCOME_PURPOSES = Object.freeze([
  "Staking Rewards",
  "Mining Reward",
  "Airdrop",
  "Lending-Ertrag",
  "DeFi-Ertrag",
]);

const GERMANY_PROFILE = Object.freeze({
  id: "DE-2025",
  countryCode: "DE",
  label: "Deutschland – Standardvorlage",
  currency: "EUR",
  disposalTaxEnabled: true,
  holdingPeriodEnabled: true,
  holdingPeriodDays: 365,
  exemptionThresholdEnabled: true,
  exemptionThresholdEur: 1000,
  lossOffsetEnabled: true,
  incomeTaxEnabled: true,
  incomePurposes: DEFAULT_INCOME_PURPOSES,
  disposalTaxRatePercent: 0,
  incomeTaxRatePercent: 0,
  ruleNote: "Vorlage für private Vorgänge. Die konkrete steuerliche Einordnung und anwendbare Ausnahmen müssen geprüft werden.",
});

function boundedNumber(value, fallback, minimum, maximum) {
  const number = Number(value);
  return Number.isFinite(number) && number >= minimum && number <= maximum ? number : fallback;
}

function boolean(value, fallback) {
  if (typeof value === "boolean") return value;
  if (value === "true" || value === "1") return true;
  if (value === "false" || value === "0") return false;
  return fallback;
}

function cleanText(value, fallback, maximum = 160) {
  const text = String(value || "").trim().replace(/\s+/g, " ");
  return text ? text.slice(0, maximum) : fallback;
}

function normalizeIncomePurposes(value, fallback = DEFAULT_INCOME_PURPOSES) {
  const values = Array.isArray(value) ? value : String(value || "").split(",");
  const purposes = [...new Set(values.map((entry) => cleanText(entry, "", 80)).filter(Boolean))];
  return purposes.length ? purposes : [...fallback];
}

function normalizeTaxProfile(input = {}, defaults = GERMANY_PROFILE) {
  return {
    id: cleanText(input.id, defaults.id, 40),
    countryCode: cleanText(input.countryCode, defaults.countryCode, 8).toUpperCase(),
    label: cleanText(input.label, defaults.label),
    currency: "EUR",
    disposalTaxEnabled: boolean(input.disposalTaxEnabled, defaults.disposalTaxEnabled),
    holdingPeriodEnabled: boolean(input.holdingPeriodEnabled, defaults.holdingPeriodEnabled),
    holdingPeriodDays: Math.round(boundedNumber(input.holdingPeriodDays, defaults.holdingPeriodDays, 0, 36500)),
    exemptionThresholdEnabled: boolean(input.exemptionThresholdEnabled, defaults.exemptionThresholdEnabled),
    exemptionThresholdEur: boundedNumber(input.exemptionThresholdEur, defaults.exemptionThresholdEur, 0, 1000000000),
    lossOffsetEnabled: boolean(input.lossOffsetEnabled, defaults.lossOffsetEnabled),
    incomeTaxEnabled: boolean(input.incomeTaxEnabled, defaults.incomeTaxEnabled),
    incomePurposes: normalizeIncomePurposes(input.incomePurposes, defaults.incomePurposes),
    disposalTaxRatePercent: boundedNumber(input.disposalTaxRatePercent, defaults.disposalTaxRatePercent, 0, 100),
    incomeTaxRatePercent: boundedNumber(input.incomeTaxRatePercent, defaults.incomeTaxRatePercent, 0, 100),
    ruleNote: cleanText(input.ruleNote, defaults.ruleNote, 500),
  };
}

function germanyProfile(personalTaxRatePercent = 0) {
  const rate = boundedNumber(personalTaxRatePercent, 0, 0, 100);
  return normalizeTaxProfile({
    ...GERMANY_PROFILE,
    disposalTaxRatePercent: rate,
    incomeTaxRatePercent: rate,
  });
}

module.exports = { DEFAULT_INCOME_PURPOSES, GERMANY_PROFILE, germanyProfile, normalizeTaxProfile };
