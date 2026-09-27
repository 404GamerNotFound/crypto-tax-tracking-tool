const EXCHANGE_CSV_PROFILES = Object.freeze({
  generic: { id: "generic", label: "Standard-CryptoBuch CSV", detail: "timestamp, direction, asset, amount; optional fee, purpose, price_eur, hash, counterparty" },
  coinbase: { id: "coinbase", label: "Coinbase Transaktionshistorie", detail: "Coinbase CSV mit Transaction Type, Asset ID und Quantity Transacted" },
  bitvavo: { id: "bitvavo", label: "Bitvavo Handelshistorie", detail: "Bitvavo CSV mit Date, Type, Amount und Price" },
  binance: { id: "binance", label: "Binance Transaktionshistorie", detail: "Binance CSV mit Date(UTC), Operation, Coin und Change – Ein-/Auszahlungen, Käufe/Verkäufe, Binance Earn, Rewards, Gebühren und Convert-Zeilen werden zugeordnet" },
  kraken: { id: "kraken", label: "Kraken Ledger", detail: "Kraken Ledger-CSV mit time, type, asset und amount" },
  etoro: { id: "etoro", label: "eToro Kontoauszug (CSV)", detail: "Für eToro-Exportzeilen mit Date/Type/Asset/Units/Price; ausschließlich in ein eToro-Börsenkonto importierbar", targetProviders: ["etoro"] },
  trade_republic: { id: "trade_republic", label: "Trade Republic Crypto-Beleg (CSV)", detail: "Übertrage die Crypto-Buchungen aus Trade-Republic-Abrechnungen in eine CSV mit Datum/Typ/Asset/Stück/Preis/Gebühr/Referenz; ausschließlich in ein Trade-Republic-Börsenkonto importierbar", targetProviders: ["trade_republic"] },
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

function normalizedAsset(value) {
  const asset = String(value || "").trim();
  const aliases = { bitcoin: "BTC", ethereum: "ETH", cardano: "ADA", solana: "SOL", ripple: "XRP", dogecoin: "DOGE", litecoin: "LTC", "bitcoin cash": "BCH" };
  return aliases[asset.toLowerCase()] || asset;
}

function normalizedTimestamp(value) {
  const text = String(value || "").trim();
  const match = text.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})(?:[ ,]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (!match) return text;
  const [, day, month, year, hour = "00", minute = "00", second = "00"] = match;
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}T${hour.padStart(2, "0")}:${minute}:${second}Z`;
}

function statementRow(row) {
  return {
    ...row,
    timestamp: normalizedTimestamp(row.timestamp || row.date || row.datum || row.trade_date || row.executed_at),
    transaction_type: row.transaction_type || row.type || row.typ || row.operation || row.transaction || row.action,
    asset: normalizedAsset(row.asset || row.instrument || row.instrument_name || row.wertpapier || row.coin || row.currency),
    quantity: row.quantity || row.units || row.stuck || row.stueck || row.st_ck || row.amount || row.change,
    price: row.price || row.execution_price || row.ausfuhrungspreis || row.ausfuehrungspreis || row.ausf_hrungspreis || row.rate,
    fee: row.fee || row.fees || row.gebuhr || row.gebuehr || row.geb_hr || row.commission,
    transaction_id: row.transaction_id || row.reference || row.referenz || row.order_id || row.id,
  };
}

function common(row) {
  const rawType = String(row.transaction_type || row.type || row.operation || row.ledger_type || row.action || "").toLowerCase();
  const rawAmount = row.quantity_transacted || row.amount || row.change || row.quantity || row.volume;
  const parsedAmount = numberValue(rawAmount);
  const rawAsset = row.asset || row.asset_id || row.coin || row.currency || row.instrument || row.market?.split("-")[0];
  const asset = String(rawAsset || "").trim().toUpperCase() === "XBT" ? "BTC" : rawAsset;
  const direction = /sell|withdraw|send|trade_sell|spend|fee|\bout\b/.test(rawType) ? "out"
    : /buy|deposit|receive|reward|staking|earn|trade_buy|distribution|cash.?voucher|airdrop|\bin\b/.test(rawType) ? "in"
      : Number(parsedAmount) < 0 ? "out" : Number(parsedAmount) > 0 ? "in" : "self";
  const purpose = /fee|commission/.test(rawType) ? "Gebühr"
    : /buy|trade_buy/.test(rawType) ? "Kauf"
      : /sell|trade_sell|spend/.test(rawType) ? "Verkauf"
        : /staking|earn|launchpool/.test(rawType) ? "Staking Rewards"
          : /cash.?voucher|airdrop/.test(rawType) ? "Airdrop"
            : /reward|distribution/.test(rawType) ? "Sonstiges"
          : /deposit|withdraw|send|receive/.test(rawType) ? "Transfer"
            : /convert|swap|small.?asset/.test(rawType) ? "DeFi Swap" : null;
  const sourceId = row.id || row.transaction_id || row.order_id || row.txid || "";
  return {
    timestamp: row.timestamp || row.date || row.date_utc || row.time || row.utc_time || row.datum,
    direction,
    asset,
    amount: parsedAmount === null ? rawAmount : Math.abs(parsedAmount),
    fee: Math.abs(numberValue(row.fee || row.fees_and_or_spread || row.gebuhr || row.gebuehr || row.geb_hr || "0") || 0),
    price_eur: numberValue(row.price_eur || row.spot_price_at_transaction || row.price || row.ausfuhrungspreis || row.ausfuehrungspreis || row.ausf_hrungspreis || "") || "",
    hash: row.hash || row.transaction_id || row.txid || row.id || "",
    // Binance reports one operation as multiple asset legs. Preserve every
    // leg under a stable external id instead of dropping later lines through
    // the wallet/external-id uniqueness constraint.
    external_id: sourceId ? `${sourceId}:${rawType}:${String(asset || "").toUpperCase()}` : "",
    counterparty: row.counterparty || row.notes || row.remark || "",
    purpose,
  };
}

function normalizeExchangeRows(csv, profileId = "generic") {
  const profile = EXCHANGE_CSV_PROFILES[profileId] || EXCHANGE_CSV_PROFILES.generic;
  const parsed = parseCsv(csv);
  const rows = parsed.map((row, index) => {
    if (profile.id === "generic") return row;
    const normalized = common(["etoro", "trade_republic"].includes(profile.id) ? statementRow(row) : row);
    if (!normalized.timestamp || !normalized.asset || numberValue(normalized.amount) === null) throw new Error(`Die ${profile.label}-CSV enthält in Zeile ${index + 2} keine unterstützte Buchung.`);
    return normalized;
  });
  return { profile, rows };
}

module.exports = { EXCHANGE_CSV_PROFILES, normalizeExchangeRows, numberValue, parseCsv };
