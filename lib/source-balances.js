// Shares the portfolio's already resolved positions. Never add a journal to an
// exchange snapshot: they describe the same account, not separate holdings.
function buildSourceBalances(sources) {
  const result = Object.create(null);
  for (const source of sources) {
    for (const [asset, value] of source.positions) {
      const amount = Number(value);
      if (!Number.isFinite(amount) || Math.abs(amount) <= 1e-12) continue;
      const timestamp = source.observedAt && String(source.observedAt);
      const observed = timestamp && Date.parse(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(timestamp) ? timestamp.replace(" ", "T") + "Z" : timestamp);
      const entry = {
        walletId: source.walletId,
        label: source.label || `${source.sourceType === 'exchange' ? 'Börsenkonto' : 'Wallet'} #${source.walletId}`,
        sourceType: source.sourceType,
        amount,
        basis: source.basis,
        observedAt: Number.isFinite(observed) ? new Date(observed).toISOString() : null,
        incomplete: Boolean(source.incompleteReason) || (source.basis === 'journal' && amount < 0),
        incompleteReason: source.incompleteReason || (source.basis === 'journal' && amount < 0 ? 'negative_journal' : null),
      };
      (result[asset] ||= []).push(entry);
    }
  }
  for (const entries of Object.values(result)) {
    entries.sort((a, b) => b.amount - a.amount || a.label.localeCompare(b.label, 'de') || a.walletId - b.walletId);
  }
  return result;
}

module.exports = { buildSourceBalances };
