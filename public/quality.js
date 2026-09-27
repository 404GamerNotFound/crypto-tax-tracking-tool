const el = (id) => document.getElementById(id);
const date = new Intl.DateTimeFormat("de-DE", { dateStyle: "medium" });
const amount = (value, asset) => `${new Intl.NumberFormat("de-DE", { maximumFractionDigits: 8 }).format(Number(value || 0))} ${asset}`;
const state = { data: null, transaction: null, portfolio: null, csvProfiles: [], exchange: { providers: [], connections: [] } };
function toast(message, kind = "success") { const node = el("toast"); node.textContent = message; node.className = `toast ${kind}`; node.hidden = false; clearTimeout(toast.timer); toast.timer = setTimeout(() => { node.hidden = true; }, 4200); }
async function api(url, options = {}) { const response = await fetch(url, { headers: { "Content-Type": "application/json", ...(options.headers || {}) }, ...options }); const payload = await response.json().catch(() => ({})); if (!response.ok) throw new Error(payload.error || "Der Vorgang ist fehlgeschlagen."); return payload; }
function row(transaction, missingPrice) { const node = document.createElement("tr"); const values = [transaction.timestamp ? date.format(new Date(transaction.timestamp)) : "—", transaction.asset_symbol || transaction.asset, transaction.wallet_label || transaction.chain, `${transaction.direction === "out" ? "−" : "+"}${amount(transaction.amount, transaction.asset_symbol || transaction.asset)}`]; for (const value of values) { const cell = document.createElement("td"); cell.textContent = value; node.append(cell); } const actions = document.createElement("td"); const open = document.createElement("a"); open.className = "text-button"; open.href = `/asset.html?chain=${encodeURIComponent(transaction.chain)}&asset=${encodeURIComponent(transaction.asset)}`; open.textContent = "Coin öffnen"; actions.append(open); if (missingPrice) { const set = document.createElement("button"); set.className = "text-button quality-action"; set.textContent = "Kurs setzen"; set.addEventListener("click", () => openPrice(transaction)); actions.append(set); } else { const setPurpose = document.createElement("button"); setPurpose.className = "text-button quality-action"; setPurpose.textContent = "Zweck zuordnen"; setPurpose.addEventListener("click", () => assignPurpose(transaction)); actions.append(setPurpose); } const documents = document.createElement("button"); documents.className = "text-button quality-action"; documents.textContent = "Nachweise"; documents.addEventListener("click", () => openDocuments(transaction)); actions.append(documents); node.append(actions); return node; }
function transferRow(item) { const row = document.createElement("tr"); for (const value of [item.outgoing_wallet || "—", item.incoming_wallet || "—", item.asset, amount(item.amount, item.asset)]) { const cell = document.createElement("td"); cell.textContent = value; row.append(cell); } const action = document.createElement("td"); const button = document.createElement("button"); button.className = "text-button"; button.textContent = "Transfer verknüpfen"; button.addEventListener("click", async () => { try { await api("/api/transfers/link", { method: "POST", body: JSON.stringify({ outgoingTransactionId: item.outgoing_id, incomingTransactionId: item.incoming_id }) }); toast("Transfer verknüpft; beide Buchungen bleiben nachvollziehbar."); load(); } catch (error) { toast(error.message, "error"); } }); action.append(button); row.append(action); return row; }
function walletOptions(id) { const select = el(id); const current = select.value; select.replaceChildren(); for (const wallet of state.portfolio?.wallets || []) select.add(new Option(`${wallet.label || wallet.address} · ${wallet.chain}`, wallet.id)); select.value = current || select.options[0]?.value || ""; }
function updateExchangeProviderForm() {
  const isBinance = el("exchange-provider").value === "binance";
  el("exchange-symbols-field").hidden = !isBinance;
  el("exchange-label").placeholder = isBinance ? "z. B. Binance Spot" : "z. B. Bitvavo";
  el("exchange-provider-help").textContent = isBinance
    ? "Binance: API-Key nur mit Leserecht erstellen; Trading, Auszahlungen und Transfers deaktiviert lassen. Mapping: Spot-Käufe/-Verkäufe, Ein- und Auszahlungen, Ausschüttungen sowie Gebühren werden getrennt importiert. Leere Märkte werden aus aktuellen Beständen ermittelt; ergänze alte Märkte für bereits verkaufte Coins."
    : "Lege einen separaten API-Key mit minimalen Rechten an – insbesondere niemals Auszahlungen freigeben. CryptoBuch sendet ausschließlich lesende GET-Anfragen. Key und Secret werden nur lokal gespeichert und nie erneut angezeigt.";
}

function renderExchangeConnections() {
  const provider = el("exchange-provider");
  const currentProvider = provider.value;
  provider.replaceChildren(...state.exchange.providers.map((item) => new Option(item.label, item.id)));
  provider.value = currentProvider || state.exchange.providers[0]?.id || "";
  updateExchangeProviderForm();
  walletOptions("exchange-wallet");
  const list = el("exchange-connection-list");
  const connections = state.exchange.connections || [];
  if (!connections.length) {
    list.replaceChildren(Object.assign(document.createElement("li"), { className: "muted", textContent: "Noch keine Read-only-Börsenverbindung eingerichtet." }));
    return;
  }
  list.replaceChildren(...connections.map((connection) => {
    const item = document.createElement("li");
    const title = document.createElement("strong");
    title.textContent = `${connection.label || connection.provider} · ${connection.walletLabel || connection.walletAddress}`;
    const detail = document.createElement("span");
    detail.className = "muted";
    const markets = connection.provider === "binance" && connection.symbols ? ` · Märkte: ${connection.symbols}` : "";
    detail.textContent = ` · ${connection.walletChain}${markets} · zuletzt ${connection.lastSyncedAt ? date.format(new Date(connection.lastSyncedAt)) : "noch nicht synchronisiert"}`;
    const sync = document.createElement("button");
    sync.type = "button";
    sync.className = "text-button quality-action";
    sync.textContent = "Synchronisieren";
    sync.addEventListener("click", async () => {
      try {
        const queued = await api(`/api/exchange-connections/${connection.id}/sync`, { method: "POST" });
        toast(`Börsen-Sync als Job #${queued.job.id} gestartet.`);
      } catch (error) { toast(error.message, "error"); }
    });
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "text-button quality-action";
    remove.textContent = "Verbindung entfernen";
    remove.addEventListener("click", async () => {
      if (!confirm(`Verbindung „${connection.label || connection.provider}“ entfernen? Bereits importierte Buchungen bleiben erhalten.`)) return;
      try {
        await api(`/api/exchange-connections/${connection.id}`, { method: "DELETE" });
        toast("Börsenverbindung entfernt.");
        load();
      } catch (error) { toast(error.message, "error"); }
    });
    item.append(title, detail, " · ", sync, " · ", remove);
    return item;
  }));
}
function render() { const data = state.data; el("missing-price-count").textContent = data.counts.missingHistoricPrices.toLocaleString("de-DE"); el("unassigned-count").textContent = data.counts.unassignedPurposes.toLocaleString("de-DE"); el("manual-price-count").textContent = data.counts.manualHistoricPrices.toLocaleString("de-DE"); for (const [id, rows, missing] of [["missing-price-list", data.missingHistoricPrices, true], ["unassigned-list", data.unassignedPurposes, false]]) { const body = el(id); body.replaceChildren(...rows.map((entry) => row(entry, missing))); el(id === "missing-price-list" ? "missing-price-empty" : "unassigned-empty").hidden = rows.length > 0; } const transfers = data.possibleTransfers || []; el("transfer-suggestion-list").replaceChildren(...transfers.map(transferRow)); el("transfer-suggestion-empty").hidden = transfers.length > 0; const duplicates = data.possibleDuplicates || []; const duplicateBody = el("duplicate-list"); duplicateBody.replaceChildren(...duplicates.map((entry) => { const node = document.createElement("tr"); for (const value of [`${String(entry.hash).slice(0, 16)}…`, entry.asset, amount(entry.amount, entry.asset), entry.occurrences]) { const cell = document.createElement("td"); cell.textContent = value; node.append(cell); } return node; })); el("duplicate-empty").hidden = duplicates.length > 0; walletOptions("csv-wallet"); const profile = el("csv-profile"); const previous = profile.value; profile.replaceChildren(...state.csvProfiles.map((item) => new Option(item.label, item.id))); profile.value = previous || "generic"; const selected = state.csvProfiles.find((item) => item.id === profile.value); el("csv-profile-help").textContent = selected?.detail || "CSV-Profil wählen."; renderExchangeConnections(); }
async function load() { try { const [data, portfolio, profiles, exchange] = await Promise.all([api("/api/data-quality"), api("/api/portfolio"), api("/api/import/csv-profiles"), api("/api/exchange-connections")]); state.data = data; state.portfolio = portfolio; state.csvProfiles = profiles.profiles || []; state.exchange = exchange; render(); } catch (error) { toast(error.message, "error"); } }
function openPrice(transaction) { state.transaction = transaction; el("quality-price-copy").textContent = `${transaction.asset_symbol || transaction.asset} · ${transaction.timestamp ? date.format(new Date(transaction.timestamp)) : "ohne Zeitstempel"}`; el("quality-price-input").value = ""; el("quality-price-error").hidden = true; el("quality-price-modal").showModal(); }
function formatBytes(value) { return value < 1024 * 1024 ? `${Math.ceil(value / 1024)} KB` : `${(value / (1024 * 1024)).toFixed(1)} MB`; }
function renderDocuments(documents) { const list = el("quality-document-list"); if (!documents.length) { list.replaceChildren(Object.assign(document.createElement("li"), { className: "muted", textContent: "Noch kein lokaler Nachweis angehängt." })); return; } list.replaceChildren(...documents.map((entry) => { const item = document.createElement("li"); const link = document.createElement("a"); link.href = `/api/transaction-documents/${encodeURIComponent(entry.id)}/download`; link.textContent = entry.originalName; link.target = "_blank"; link.rel = "noopener"; item.append(link, ` · ${formatBytes(entry.byteSize)} · SHA-256 ${entry.sha256.slice(0, 12)}… · `); const remove = document.createElement("button"); remove.type = "button"; remove.className = "text-button"; remove.textContent = "Entfernen"; remove.addEventListener("click", async () => { if (!confirm(`Nachweis „${entry.originalName}“ wirklich lokal löschen?`)) return; try { await api(`/api/transaction-documents/${entry.id}`, { method: "DELETE" }); await loadDocuments(); } catch (error) { toast(error.message, "error"); } }); item.append(remove); return item; })); }
async function loadDocuments() { if (!state.transaction) return; const data = await api(`/api/transactions/${state.transaction.id}/documents`); renderDocuments(data.documents || []); }
async function openDocuments(transaction) { state.transaction = transaction; el("quality-document-copy").textContent = `${transaction.asset_symbol || transaction.asset} · ${transaction.timestamp ? date.format(new Date(transaction.timestamp)) : "ohne Zeitstempel"}`; el("quality-document-form").reset(); el("quality-document-error").hidden = true; el("quality-document-modal").showModal(); try { await loadDocuments(); } catch (error) { toast(error.message, "error"); } }
async function savePrice(auto = false) { try { const result = await api(`/api/transactions/${state.transaction.id}/historical-price`, { method: "PATCH", body: JSON.stringify({ priceTransactionEur: auto ? null : el("quality-price-input").value }) }); el("quality-price-modal").close(); toast(result.price_source === "manual" ? "Kurs gespeichert." : "Automatik aktiviert."); await load(); } catch (error) { el("quality-price-error").textContent = error.message; el("quality-price-error").hidden = false; } }
async function assignPurpose(transaction) { const purpose = prompt("Zweck für diese Transaktion:", transaction.purpose || "Kauf"); if (purpose === null) return; try { await api(`/api/transactions/${transaction.id}`, { method: "PATCH", body: JSON.stringify({ purpose: purpose.trim() }) }); toast("Zweck gespeichert."); await load(); } catch (error) { toast(error.message, "error"); } }
el("retry-prices").addEventListener("click", async () => { try { const queued = await api("/api/jobs/price-backfill", { method: "POST", body: JSON.stringify({ force: true }) }); toast(`Kurs-Job #${queued.job.id} wurde gestartet.`); } catch (error) { toast(error.message, "error"); } });
el("csv-profile").addEventListener("change", () => { const selected = state.csvProfiles.find((item) => item.id === el("csv-profile").value); el("csv-profile-help").textContent = selected?.detail || "CSV-Profil wählen."; });
el("exchange-provider").addEventListener("change", updateExchangeProviderForm);
el("csv-import-form").addEventListener("submit", async (event) => { event.preventDefault(); const form = event.currentTarget; try { const file = el("csv-file").files[0]; const csv = await file.text(); const result = await api("/api/import/csv", { method: "POST", body: JSON.stringify({ walletId: el("csv-wallet").value, profile: el("csv-profile").value, csv }) }); toast(`${result.imported.toLocaleString("de-DE")} CSV-Transaktionen importiert.`); form.reset(); load(); } catch (error) { toast(error.message, "error"); } });
el("exchange-connection-form").addEventListener("submit", async (event) => { event.preventDefault(); const form = event.currentTarget; try { await api("/api/exchange-connections", { method: "POST", body: JSON.stringify({ provider: el("exchange-provider").value, walletId: el("exchange-wallet").value, label: el("exchange-label").value, apiKey: el("exchange-api-key").value, apiSecret: el("exchange-api-secret").value, symbols: el("exchange-symbols").value }) }); form.reset(); toast("Read-only-Börsenverbindung gespeichert."); load(); } catch (error) { toast(error.message, "error"); } });
el("quality-document-form").addEventListener("submit", async (event) => { event.preventDefault(); const form = event.currentTarget; const file = el("quality-document-file").files[0]; const errorNode = el("quality-document-error"); try { if (!state.transaction || !file) throw new Error("Bitte zuerst einen Nachweis auswählen."); if (file.size > 5 * 1024 * 1024) throw new Error("Ein Nachweis darf maximal 5 MB groß sein."); const response = await fetch(`/api/transactions/${state.transaction.id}/documents`, { method: "POST", headers: { "Content-Type": file.type || "application/octet-stream", "X-Document-Name": encodeURIComponent(file.name) }, body: file }); const payload = await response.json().catch(() => ({})); if (!response.ok) throw new Error(payload.error || "Nachweis konnte nicht gespeichert werden."); form.reset(); await loadDocuments(); toast("Nachweis lokal gespeichert."); } catch (error) { errorNode.textContent = error.message; errorNode.hidden = false; } });
el("reload-quality").addEventListener("click", load); el("close-quality-price").addEventListener("click", () => el("quality-price-modal").close()); el("close-quality-document").addEventListener("click", () => el("quality-document-modal").close()); el("quality-price-form").addEventListener("submit", (event) => { event.preventDefault(); savePrice(); }); el("quality-price-auto").addEventListener("click", () => savePrice(true)); load();
