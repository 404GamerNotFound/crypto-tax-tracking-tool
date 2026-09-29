function satoshis(value) {
  const amount = Number(value);
  return Number.isFinite(amount) ? Math.round(amount * 100000000) : 0;
}

function detailsOf(entry) {
  return entry?.details || entry || {};
}

function outputAt(transaction, index) {
  const outputs = Array.isArray(transaction?.vout) ? transaction.vout : [];
  return outputs.find((output) => Number(output?.n) === Number(index)) || outputs[Number(index)] || null;
}

function outputEntry(output) {
  return {
    recipient: Array.isArray(output?.scriptPubKey?.addresses) ? output.scriptPubKey.addresses[0] || null : null,
    value: satoshis(output?.value),
  };
}

/**
 * Converts FullStack/Fulcrum transaction details into the neutral UTXO shape
 * used by the wallet journal. Fulcrum exposes prevout references in `vin`,
 * so their parent transactions must be supplied to determine outgoing values.
 */
function toBitcoinCashUtxoPayload(entry, referencedTransactions = new Map()) {
  const transaction = detailsOf(entry);
  const lookup = referencedTransactions instanceof Map
    ? referencedTransactions
    : new Map(Object.entries(referencedTransactions || {}));
  const outputs = (transaction.vout || []).map(outputEntry);
  let allInputsResolved = true;
  const inputs = (transaction.vin || []).map((input) => {
    const parent = detailsOf(lookup.get(input?.txid));
    const previousOutput = outputAt(parent, input?.vout);
    if (!previousOutput) allInputsResolved = false;
    return outputEntry(previousOutput);
  });
  const totalInputs = inputs.reduce((sum, input) => sum + input.value, 0);
  const totalOutputs = outputs.reduce((sum, output) => sum + output.value, 0);
  const fee = allInputsResolved && totalInputs >= totalOutputs ? totalInputs - totalOutputs : 0;
  const seconds = Number(transaction.blocktime ?? transaction.time);

  return {
    transaction: {
      hash: transaction.txid || transaction.hash || entry?.txid || null,
      time: Number.isFinite(seconds) ? new Date(seconds * 1000).toISOString() : null,
      fee,
    },
    inputs,
    outputs,
  };
}

module.exports = { toBitcoinCashUtxoPayload };
