const test = require("node:test");
const assert = require("node:assert/strict");
const { CHAIN_CONFIG, isValidAddress } = require("../lib/validation");
const {
  normalizeEvmNativeTransfer,
  normalizeSolscanTransfer,
  normalizeXrpPayment,
  normalizeStellarPayment,
  normalizeBlockchairUtxoTransaction,
} = require("../lib/additional-chains");

test("validiert die zusätzlichen Wallet-Adressformate", () => {
  assert.equal(isValidAddress("BNB", "0x52908400098527886E0F7030069857D2E4169EE7"), true);
  assert.equal(isValidAddress("SOL", "11111111111111111111111111111111"), true);
  assert.equal(isValidAddress("XRP", "rG1QQv2nh2gr7RCZ1P8YYcBUKCCN633jCn"), true);
  assert.equal(isValidAddress("XLM", "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF"), true);
  assert.equal(isValidAddress("TON", `EQ${"A".repeat(46)}`), true);
  assert.equal(isValidAddress("ZEC", "t1ZcashExampleAddressNotAValidBase58Value"), false);
});

test("normalisiert einen nativen BNB-Transfer", () => {
  const address = "0x1111111111111111111111111111111111111111";
  const transaction = normalizeEvmNativeTransfer({
    hash: "0xabc", timeStamp: "1700000000", from: address, to: "0x2222222222222222222222222222222222222222",
    value: "1250000000000000000", gasUsed: "21000", gasPrice: "1000000000", isError: "0",
  }, address, CHAIN_CONFIG.BNB);
  assert.equal(transaction.asset, "BNB");
  assert.equal(transaction.amount, 1.25);
  assert.equal(transaction.fee, 0.000021);
});

test("normalisiert native XRP- und Stellar-Zahlungen", () => {
  const xrp = normalizeXrpPayment({ tx: {
    hash: "XRP-HASH", TransactionType: "Payment", Account: "rSource", Destination: "rDestination", Amount: "2500000", Fee: "12", date: 700000000,
  } }, "rDestination");
  const xlm = normalizeStellarPayment({
    id: "42", transaction_hash: "XLM-HASH", type: "payment", asset_type: "native", from: "GSOURCE", to: "GDEST", amount: "12.5", created_at: "2024-01-01T00:00:00Z",
  }, "GDEST");
  assert.equal(xrp.direction, "in");
  assert.equal(xrp.amount, 2.5);
  assert.equal(xlm.asset, "XLM");
  assert.equal(xlm.amount, 12.5);
});

test("normalisiert native SOL-Transfers in Lamports", () => {
  const transaction = normalizeSolscanTransfer({
    trans_id: "SOL-HASH", block_time: 1700000000, from_address: "source", to_address: "destination",
    token_address: "So11111111111111111111111111111111111111111", token_decimals: 9, amount: "1250000000",
  }, "destination");
  assert.equal(transaction.asset, "SOL");
  assert.equal(transaction.amount, 1.25);
  assert.equal(transaction.direction, "in");
});

test("berechnet die Nettobewegung einer UTXO-Transaktion", () => {
  const transaction = normalizeBlockchairUtxoTransaction({
    transaction: { hash: "utxo-hash", time: "2024-01-01T00:00:00Z", fee: 1000 },
    inputs: [{ recipient: "other", value: 200000000 }],
    outputs: [{ recipient: "DWallet", value: 150000000 }, { recipient: "other", value: 49999000 }],
  }, "DWallet", CHAIN_CONFIG.DOGE);
  assert.equal(transaction.direction, "in");
  assert.equal(transaction.amount, 1.5);
});
