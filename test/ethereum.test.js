const test = require("node:test");
const assert = require("node:assert/strict");
const { amountFromUnits, normalizeEthereumTransaction, normalizeErc20Transfer } = require("../lib/ethereum");

const wallet = "0x1111111111111111111111111111111111111111";
const other = "0x2222222222222222222222222222222222222222";

test("wandelt Wei und ERC-20-Einheiten in dezimale Mengen um", () => {
  assert.equal(amountFromUnits("1250000000000000000", 18), 1.25);
  assert.equal(amountFromUnits("4250000", 6), 4.25);
});

test("normalisiert native ETH-Transfers samt Gasgebühr", () => {
  const transaction = normalizeEthereumTransaction({
    hash: `0x${"a".repeat(64)}`, timeStamp: "1700000000", from: wallet, to: other,
    value: "1500000000000000000", gasUsed: "21000", gasPrice: "20000000000",
  }, wallet);
  assert.equal(transaction.direction, "out");
  assert.equal(transaction.asset, "ETH");
  assert.equal(transaction.amount, 1.5);
  assert.equal(transaction.fee, 0.00042);
});

test("normalisiert ERC-20-Transfers mit Token-Metadaten", () => {
  const transfer = normalizeErc20Transfer({
    hash: `0x${"b".repeat(64)}`, transactionIndex: "7", timeStamp: "1700000000", from: other, to: wallet,
    contractAddress: "0xA0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", value: "5000000", tokenDecimal: "6", tokenName: "USD Coin", tokenSymbol: "USDC",
    gasUsed: "60000", gasPrice: "20000000000",
  }, wallet);
  assert.equal(transfer.direction, "in");
  assert.equal(transfer.asset, "ERC20:0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48");
  assert.equal(transfer.assetSymbol, "USDC");
  assert.equal(transfer.amount, 5);
  assert.equal(transfer.fee, 0);
  assert.equal(transfer.feeAsset, "ETH");
});
