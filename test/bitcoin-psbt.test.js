const test = require("node:test");
const assert = require("node:assert/strict");
const bitcoin = require("bitcoinjs-lib");
const { previewPsbt } = require("../lib/bitcoin-psbt");

test("liest eine PSBT ausschließlich als Vorschau", () => {
  const script = Buffer.from("00140000000000000000000000000000000000000000", "hex");
  const psbt = new bitcoin.Psbt({ network: bitcoin.networks.bitcoin });
  psbt.addInput({ hash: "00".repeat(32), index: 0, witnessUtxo: { script, value: 100000n } });
  psbt.addOutput({ script, value: 90000n });
  const preview = previewPsbt(psbt.toBase64());
  assert.equal(preview.inputs.length, 1);
  assert.equal(preview.outputs.length, 1);
  assert.equal(preview.feeBtc, 0.0001);
});
