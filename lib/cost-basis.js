const { germanyProfile, normalizeTaxProfile } = require("./tax-profile");
const { NETWORK_FEE_PURPOSE, networkFeeRows } = require("./network-fees");

// Gemeinsamer Kaufposten-Motor für Steuerzentrum und Dashboard.
//
// Regeln (bewusst explizit, damit Ergebnisse nachvollziehbar bleiben):
// - Zugang mit Zweck „Kauf“ oder „DeFi Swap“ → Kaufposten (Anschaffung).
// - Zugang mit einem Ertragszweck des Steuerprofils (z. B. Staking Rewards)
//   → eigener Posten; Einstandswert ist der Kurs bei Zufluss.
// - Abgang mit Zweck „Verkauf“ oder „DeFi Swap“ → Veräußerung (Tausch zählt
//   als Veräußerung des hingegebenen Assets).
// - Abgang mit Zweck „Gebühr“ sowie abgeleitete Netzwerkgebühren → verbraucht
//   Posten, ohne als Verkauf in die Gewinnermittlung einzugehen.
// - Transfers und alle übrigen Zwecke berühren die Posten nicht.
// Fehlende Kurse werden nicht geschätzt; Posten und Verkäufe bleiben dann
// unvollständig und sichtbar.

const ACQUISITION_PURPOSES = Object.freeze(new Set(["Kauf", "DeFi Swap"]));
const DISPOSAL_PURPOSES = Object.freeze(new Set(["Verkauf", "DeFi Swap"]));
const CONSUMPTION_PURPOSES = Object.freeze(new Set(["Gebühr", NETWORK_FEE_PURPOSE]));
const SWAP_PURPOSE = "DeFi Swap";
const EPSILON = 1e-12;
const FIAT_FEE_ASSETS = Object.freeze(new Set(["EUR"]));

function positiveNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function timeOf(transaction) {
  const milliseconds = Date.parse(transaction?.timestamp);
  return Number.isFinite(milliseconds) ? milliseconds : null;
}

const DIRECTION_RANK = { in: 0, self: 1, out: 2 };

/**
 * Chronologische Reihenfolge mit festem Tie-Breaker: Bei identischem
 * Zeitstempel kommen Zugänge vor Abgängen (ein Abgang kann nur bereits
 * vorhandene Einheiten verwenden), danach entscheidet die Journal-ID.
 */
function compareChronologically(left, right) {
  return (timeOf(left) - timeOf(right))
    || ((DIRECTION_RANK[left.direction] ?? 1) - (DIRECTION_RANK[right.direction] ?? 1))
    || (Number(left.id) || 0) - (Number(right.id) || 0);
}

function lotsForDisposal(lots, method) {
  if (method === "LIFO") return [...lots].reverse();
  if (method === "HIFO") return [...lots].sort((left, right) => (right.costPerAsset || -1) - (left.costPerAsset || -1));
  return lots;
}

function averageCostPerAsset(lots) {
  const totalAmount = lots.reduce((sum, lot) => sum + Number(lot.amount || 0), 0);
  if (totalAmount <= 0 || lots.some((lot) => !positiveNumber(lot.costPerAsset))) return null;
  return lots.reduce((sum, lot) => sum + lot.amount * lot.costPerAsset, 0) / totalAmount;
}

/**
 * Für Swap-Paare (gleiche Wallet, gleicher Hash, genau ein Abgang und ein
 * Zugang verschiedener Assets) ergibt sich der Wert einer Seite ohne Kurs aus
 * dem Marktwert der Gegenseite. Das entspricht dem Tauschwert und ist keine
 * freie Schätzung.
 */
function swapCounterValues(transactions) {
  const groups = new Map();
  for (const transaction of transactions) {
    if (transaction.purpose !== SWAP_PURPOSE || !transaction.hash || transaction.syntheticFee) continue;
    const key = `${transaction.wallet_id ?? ""}|${transaction.hash}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(transaction);
  }
  const values = new Map();
  for (const legs of groups.values()) {
    const incoming = legs.filter((leg) => leg.direction === "in");
    const outgoing = legs.filter((leg) => leg.direction === "out");
    if (incoming.length !== 1 || outgoing.length !== 1 || incoming[0].asset === outgoing[0].asset) continue;
    for (const [leg, counter] of [[incoming[0], outgoing[0]], [outgoing[0], incoming[0]]]) {
      const counterPrice = positiveNumber(counter.price_transaction_eur);
      const counterAmount = positiveNumber(counter.amount);
      if (!positiveNumber(leg.price_transaction_eur) && counterPrice && counterAmount) values.set(leg, counterAmount * counterPrice);
    }
  }
  return values;
}

function legValueEur(transaction, amount, fallbackValue) {
  const price = positiveNumber(transaction.price_transaction_eur);
  if (price) return amount * price;
  return Number.isFinite(fallbackValue) && fallbackValue > 0 ? fallbackValue : null;
}

/** In EUR bezahlte Gebühren lassen sich ohne Kurs exakt bewerten. */
function fiatFeeEur(transaction) {
  const fee = Number(transaction.fee || 0);
  if (!Number.isFinite(fee) || fee <= 0) return 0;
  return FIAT_FEE_ASSETS.has(String(transaction.fee_asset || transaction.feeAsset || "").toUpperCase()) ? fee : null;
}

function resolveProfile(options = {}) {
  if (options.profile) return options.profile;
  return normalizeTaxProfile(options.taxProfile || germanyProfile(options.personalTaxRatePercent || 0));
}

/**
 * Verarbeitet alle datierten Buchungen chronologisch und liefert offene
 * Posten, Veräußerungen und Verbräuche.
 */
function runCostBasis(transactions, options = {}) {
  const profile = resolveProfile(options);
  const method = profile.costBasisMethod;
  const incomePurposes = new Set(profile.incomePurposes || []);
  const source = (transactions || []).filter((transaction) => transaction && !transaction.syntheticFee);
  const feeRows = options.includeNetworkFees === false ? [] : networkFeeRows(source);
  const swapValues = swapCounterValues(source);
  const rows = [...source, ...feeRows].filter((transaction) => timeOf(transaction) !== null).sort(compareChronologically);
  const lotsByAsset = new Map();
  const acquisitions = [];
  const disposals = [];
  const consumptions = [];

  for (const transaction of rows) {
    const amount = Number(transaction.amount || 0);
    if (!Number.isFinite(amount) || amount <= 0 || !transaction.asset) continue;
    const asset = transaction.asset;
    if (!lotsByAsset.has(asset)) lotsByAsset.set(asset, []);

    if (transaction.direction === "in") {
      const origin = ACQUISITION_PURPOSES.has(transaction.purpose) ? "purchase"
        : incomePurposes.has(transaction.purpose) ? "income" : null;
      if (!origin) continue;
      const valueEur = legValueEur(transaction, amount, swapValues.get(transaction));
      // Kaufnebenkosten in EUR erhöhen die Anschaffungskosten.
      const feeEur = origin === "purchase" ? fiatFeeEur(transaction) : 0;
      const costPerAsset = valueEur !== null && feeEur !== null ? (valueEur + feeEur) / amount : null;
      const lot = {
        asset, amount, originalAmount: amount, costPerAsset, origin, purpose: transaction.purpose,
        acquiredAt: transaction.timestamp, transactionId: transaction.id ?? null,
      };
      lotsByAsset.get(asset).push(lot);
      acquisitions.push({ transaction, lot });
      continue;
    }

    if (transaction.direction !== "out") continue;
    const isDisposal = DISPOSAL_PURPOSES.has(transaction.purpose);
    if (!isDisposal && !CONSUMPTION_PURPOSES.has(transaction.purpose)) continue;

    const lots = lotsByAsset.get(asset);
    const averageCost = method === "AVERAGE" ? averageCostPerAsset(lots) : null;
    // Beim gleitenden Durchschnitt wird der gemeinsame Einstandswert nach
    // jedem Abgang fortgeschrieben. Die einzelnen Anschaffungsdaten bleiben
    // erhalten, damit die Haltefrist nachvollziehbar bleibt.
    if (averageCost !== null) for (const lot of lots) lot.costPerAsset = averageCost;
    let outstanding = amount;
    const segments = [];
    for (const lot of lotsForDisposal(lots, method)) {
      if (outstanding <= EPSILON) break;
      if (lot.amount <= EPSILON) continue;
      const consumed = Math.min(outstanding, lot.amount);
      lot.amount -= consumed;
      outstanding -= consumed;
      segments.push({
        amount: consumed,
        costPerAsset: method === "AVERAGE" ? averageCost : lot.costPerAsset,
        acquiredAt: lot.acquiredAt,
        acquisitionTransactionId: lot.transactionId,
        origin: lot.origin,
      });
    }
    lotsByAsset.set(asset, lots.filter((lot) => lot.amount > EPSILON));
    const record = {
      transaction, asset, amount, segments,
      outstanding: outstanding > EPSILON ? outstanding : 0,
    };
    if (isDisposal) {
      disposals.push({ ...record, proceedsEur: legValueEur(transaction, amount, swapValues.get(transaction)) });
    } else {
      consumptions.push(record);
    }
  }

  return { profile, lotsByAsset, acquisitions, disposals, consumptions, feeRows };
}

module.exports = {
  ACQUISITION_PURPOSES,
  CONSUMPTION_PURPOSES,
  DISPOSAL_PURPOSES,
  compareChronologically,
  fiatFeeEur,
  lotsForDisposal,
  positiveNumber,
  runCostBasis,
};
