const { CHAIN_CONFIG } = require("./validation");

// Netzwerkgebühren verlassen die Wallet zusätzlich zum gebuchten Betrag. Die
// Adapter speichern sie im Feld `fee`, verbuchen sie aber nicht als eigene
// Bewegung. Diese Hilfsfunktion leitet daraus nachvollziehbare Abgangszeilen
// ab, damit Bestände und Kaufposten die bezahlten Gebühren berücksichtigen.
//
// Bei UTXO-Chains und Cardano berechnen die Adapter den Betrag als
// Netto-Saldoänderung (Inputs − eigene Outputs). Die Gebühr ist dort bereits im
// Betrag enthalten und darf nicht ein zweites Mal abgezogen werden.
const NETWORK_FEE_PURPOSE = "Netzwerkgebühr";
const FEE_INCLUDED_IN_AMOUNT_CHAINS = Object.freeze(new Set(["BTC", "BCH", "LTC", "DOGE", "ZEC", "ADA"]));

function isExchangeRow(transaction) {
  return transaction.source_type === "exchange" || transaction.sourceType === "exchange" || transaction.chain === "EXCHANGE";
}

function feeAssetOf(transaction, chainConfig) {
  const explicit = String(transaction.fee_asset || transaction.feeAsset || "").trim();
  if (explicit) return explicit;
  // Token- und NFT-Zeilen bezahlen Gas immer im nativen Asset der Chain.
  return chainConfig.asset;
}

/**
 * Erzeugt synthetische Abgangszeilen (`syntheticFee: true`) für separat
 * bezahlte On-Chain-Gebühren. Eine Transaktion mit mehreren Journalzeilen
 * (z. B. ETH-Überweisung plus mehrere ERC-20-Logs) trägt die Gebühr in jeder
 * Zeile; sie wird pro Wallet, Hash und Gebühren-Asset nur einmal gezählt.
 * Börsenkonten bleiben unberührt: Dort liefern die Importer Gebühren als eigene
 * Zeilen bzw. der Kontosaldo kommt aus einem Börsen-Snapshot.
 */
function networkFeeRows(transactions) {
  const byKey = new Map();
  for (const transaction of transactions || []) {
    if (!transaction || transaction.syntheticFee) continue;
    const chain = String(transaction.chain || "").toUpperCase();
    const chainConfig = CHAIN_CONFIG[chain];
    if (!chainConfig || FEE_INCLUDED_IN_AMOUNT_CHAINS.has(chain) || isExchangeRow(transaction)) continue;
    if (transaction.direction !== "out" && transaction.direction !== "self") continue;
    const fee = Number(transaction.fee);
    if (!Number.isFinite(fee) || fee <= 0) continue;
    const asset = feeAssetOf(transaction, chainConfig);
    const key = `${transaction.wallet_id ?? ""}|${transaction.hash || `id:${transaction.id}`}|${asset}`;
    const existing = byKey.get(key);
    if (existing && existing.amount >= fee) continue;
    byKey.set(key, {
      id: transaction.id ?? null,
      sourceTransactionId: transaction.id ?? null,
      wallet_id: transaction.wallet_id ?? null,
      chain,
      source_type: transaction.source_type,
      hash: transaction.hash || null,
      timestamp: transaction.timestamp || null,
      direction: "out",
      asset,
      amount: fee,
      fee: 0,
      fee_asset: asset,
      purpose: NETWORK_FEE_PURPOSE,
      // Nur wenn die Gebühr im selben Asset wie die Zeile anfällt, ist deren
      // historischer Kurs auch der Kurs der Gebühr.
      price_transaction_eur: asset === transaction.asset ? transaction.price_transaction_eur ?? null : null,
      syntheticFee: true,
    });
  }
  return [...byKey.values()];
}

module.exports = { FEE_INCLUDED_IN_AMOUNT_CHAINS, NETWORK_FEE_PURPOSE, networkFeeRows };
