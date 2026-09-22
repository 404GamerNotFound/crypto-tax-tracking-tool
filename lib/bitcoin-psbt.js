const bitcoin = require("bitcoinjs-lib");

function btc(value) {
  return Number((Number(value || 0) / 100000000).toFixed(8));
}

function addressForScript(script) {
  try {
    return bitcoin.address.fromOutputScript(script, bitcoin.networks.bitcoin);
  } catch (_) {
    return null;
  }
}

function previewPsbt(base64) {
  const value = String(base64 || "").trim();
  if (!value || value.length > 1_000_000) throw new Error("Bitte eine gültige, maximal 1 MB große PSBT im Base64-Format einfügen.");
  const psbt = bitcoin.Psbt.fromBase64(value, { network: bitcoin.networks.bitcoin });
  const inputs = psbt.txInputs.map((input, index) => {
    const data = psbt.data.inputs[index];
    const witness = data.witnessUtxo;
    return {
      index,
      transactionId: Buffer.from(input.hash).reverse().toString("hex"),
      vout: input.index,
      amountBtc: witness ? btc(witness.value) : null,
      address: witness ? addressForScript(witness.script) : null,
      hasSignature: Boolean(data.partialSig?.length || data.tapKeySig || data.tapScriptSig?.length),
    };
  });
  const outputs = psbt.txOutputs.map((output, index) => ({ index, amountBtc: btc(output.value), address: addressForScript(output.script) }));
  const knownInputs = inputs.reduce((sum, input) => sum + (input.amountBtc || 0), 0);
  const outputTotal = outputs.reduce((sum, output) => sum + output.amountBtc, 0);
  return { inputs, outputs, outputTotalBtc: outputTotal, feeBtc: inputs.every((input) => input.amountBtc !== null) ? Number((knownInputs - outputTotal).toFixed(8)) : null };
}

module.exports = { previewPsbt };
