const EXCHANGE_CSV_PROFILES = Object.freeze({
  generic: { id: "generic", label: "Standard-CryptoBuch CSV", detail: "timestamp, direction, asset, amount; optional fee, purpose, price_eur, hash, counterparty" },
  coinbase: { id: "coinbase", label: "Coinbase Transaktionshistorie", detail: "Coinbase CSV mit Transaction Type, Asset ID und Quantity Transacted" },
  bitvavo: { id: "bitvavo", label: "Bitvavo Handelshistorie", detail: "Bitvavo CSV mit Date, Type, Amount und Price" },
  binance: { id: "binance", label: "Binance Transaktionshistorie", detail: "Binance CSV mit Date(UTC), Operation, Coin und Change" },
  kraken: { id: "kraken", label: "Kraken Ledger", detail: "Kraken Ledger-CSV mit time, type, asset und amount" },
});

function normalizeHeader(value) {
  return String(value || "").trim().toLowerCase().replace(/^\uFEFF/, "").replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

function parseCsv(text) {
  const records = [];
  let row = []; let value = ""; let quoted = false;
  const input = String(text || "").replace(/^\uFEFF/, "");
  const firstLine = input.split(/\r?\n/, 1)[0] || "";
  const delimiter = firstLine.includes(";") ? ";" : ",";
  for (let index = 0; index <= input.length; index += 1) {
    const char = input[index] || "\n";
    if (char === '"') {
      if (quoted && input[index + 1] === '"') { value += '"'; index += 1; } else quoted = !quoted;
    } else if (!quoted && char === delimiter) { row.push(value.trim()); value = ""; }
    else if (!quoted && (char === "\n" || char === "\r")) {
      if (char === "\r" && input[index + 1] === "\n") index += 1;
      row.push(value.trim()); value = "";
      if (row.some(Boolean)) records.push(row);
      row = [];
    } else value += char;
  }
  if (records.length < 2) throw new Error("Die CSV benötigt eine Kopfzeile und mindestens eine Transaktion.");
  const headers = records.shift().map(normalizeHeader);
  return records.map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] || ""])));
}

function numberValue(value) {
  const normalized = String(value ?? "").trim().replace(/\.(?=\d{3}(?:\D|$))/g, "").replace(",", ".");
  const number = Number(normalized);
  return Number.isFinite(number) ? number : null;
}

function common(row) {
  const rawType = String(row.transaction_type || row.type || row.operation || row.ledger_type || "").toLowerCase();
  const direction = /sell|withdraw|send|trade_sell|spend|out/.test(rawType) ? "out" : /buy|deposit|receive|reward|staking|earn|trade_buy|in/.test(rawType) ? "in" : "self";
  const purpose = /buy|trade_buy/.test(rawType) ? "Kauf" : /sell|trade_sell|spend/.test(rawType) ? "Verkauf" : /staking|reward|earn/.test(rawType) ? "Staking Rewards" : /deposit|withdraw|send|receive/.test(rawType) ? "Transfer" : null;
  const rawAmount = row.quantity_transacted || row.amount || row.change || row.quantity || row.volume;
  const parsedAmount = numberValue(rawAmount);
  const rawAsset = row.asset || row.asset_id || row.coin || row.currency || row.market?.split("-")[0];
  const asset = String(rawAsset || "").trim().toUpperCase() === "XBT" ? "BTC" : rawAsset;
  return {
    timestamp: row.timestamp || row.date || row.date_utc || row.time || row.utc_time,
    direction,
    asset,
    amount: parsedAmount === null ? rawAmount : Math.abs(parsedAmount),
    fee: Math.abs(numberValue(row.fee || row.fees_and_or_spread || "0") || 0),
    price_eur: numberValue(row.price_eur || row.spot_price_at_transaction || row.price || "") || "",
    hash: row.hash || row.transaction_id || row.txid || row.id || "",
    external_id: row.id || row.transaction_id || row.order_id || row.txid || "",
    counterparty: row.counterparty || row.notes || row.remark || "",
    purpose,
  };
}

function normalizeExchangeRows(csv, profileId = "generic") {
  const profile = EXCHANGE_CSV_PROFILES[profileId] || EXCHANGE_CSV_PROFILES.generic;
  const parsed = parseCsv(csv);
  const rows = parsed.map((row, index) => {
    if (profile.id === "generic") return row;
    const normalized = common(row);
    if (!normalized.timestamp || !normalized.asset || numberValue(normalized.amount) === null) throw new Error(`Die ${profile.label}-CSV enthält in Zeile ${index + 2} keine unterstützte Buchung.`);
    return normalized;
  });
  return { profile, rows };
}

module.exports = { EXCHANGE_CSV_PROFILES, normalizeExchangeRows, numberValue, parseCsv };
