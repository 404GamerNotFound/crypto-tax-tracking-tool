const { api, el, node, toast } = window.CryptoBuchUI;
const date = new Intl.DateTimeFormat("de-DE", { dateStyle: "medium" });
const dateTime = new Intl.DateTimeFormat("de-DE", { dateStyle: "medium", timeStyle: "short" });
const amount = (value, asset) => new Intl.NumberFormat("de-DE", { maximumFractionDigits: 8 }).format(Number(value || 0)) + " " + asset;
const state = { data: null, transaction: null, portfolio: null, csvProfiles: [], exchange: { providers: [], connections: [] }, tradeRepublicWebLoginConnectionId: null, tradeRepublicWebLoginTimer: null };

function readableDateTime(value) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "Zeitpunkt unbekannt" : dateTime.format(parsed);
}

function timeDistance(start, end) {
  const milliseconds = Math.abs(new Date(end).getTime() - new Date(start).getTime());
  if (!Number.isFinite(milliseconds)) return "Zeitpunkt unbekannt";
  const minutes = Math.round(milliseconds / 60000);
  if (minutes < 60) return minutes + " Min. Abstand";
  const hours = Math.round(minutes / 60);
  return hours < 48 ? hours + " Std. Abstand" : Math.round(hours / 24) + " Tage Abstand";
}

function row(transaction, missingPrice) {
  const tr = node("tr");
  const values = [
    transaction.timestamp ? date.format(new Date(transaction.timestamp)) : "—",
    transaction.asset_symbol || transaction.asset,
    transaction.wallet_label || transaction.chain,
    (transaction.direction === "out" ? "−" : "+") + amount(transaction.amount, transaction.asset_symbol || transaction.asset),
  ];
  values.forEach((value) => tr.append(node("td", "", value)));
  const actions = node("td");
  const open = node("a", "text-button", "Coin öffnen");
  open.href = "/asset.html?chain=" + encodeURIComponent(transaction.chain) + "&asset=" + encodeURIComponent(transaction.asset);
  actions.append(open);
  const action = node("button", "text-button quality-action", missingPrice ? "Kurs setzen" : "Zweck zuordnen");
  action.addEventListener("click", () => missingPrice ? openPrice(transaction) : assignPurpose(transaction));
  const documents = node("button", "text-button quality-action", "Nachweise");
  documents.addEventListener("click", () => openDocuments(transaction));
  actions.append(action, documents);
  tr.append(actions);
  return tr;
}

function transferDetail(label, value) {
  const detail = node("div", "transfer-detail");
  detail.append(node("span", "", label), node("strong", "", value));
  return detail;
}

function transferCard(item) {
  const card = node("article", "transfer-suggestion-card" + (item.origin === "exchange" ? " is-exchange" : ""));
  const header = node("div", "transfer-card-head");
  header.append(
    node("span", "transfer-kind " + (item.origin === "exchange" ? "exchange" : "wallet"), item.origin === "exchange" ? "Börse ↔ Wallet" : "Wallet ↔ Wallet"),
    node("strong", "transfer-amount", amount(item.amount, item.asset)),
  );
  const route = node("div", "transfer-route");
  const source = node("div", "transfer-route-point");
  source.append(node("span", "transfer-route-label", "Ausgang"), node("strong", "", item.outgoing_wallet || "Unbekannte Quelle"), node("small", "", readableDateTime(item.outgoing_at)));
  const arrow = node("span", "transfer-route-arrow", "→");
  arrow.setAttribute("aria-hidden", "true");
  const target = node("div", "transfer-route-point");
  target.append(node("span", "transfer-route-label", "Eingang"), node("strong", "", item.incoming_wallet || "Unbekanntes Ziel"), node("small", "", readableDateTime(item.incoming_at)));
  route.append(source, arrow, target);
  const details = node("div", "transfer-details");
  details.append(
    transferDetail("Abgleich", timeDistance(item.outgoing_at, item.incoming_at)),
    transferDetail("Quelle", item.origin === "exchange" ? "Börsen-Synchronisierung" : "Wallet-Synchronisierung"),
  );
  if (item.fee_adjusted) details.append(transferDetail("Gebühr", "Im Betrag berücksichtigt"));
  const footer = node("div", "transfer-card-footer");
  footer.append(node("p", "", "Bestätigung markiert ausschließlich diese beiden Buchungen als Transfer."));
  const confirmTransfer = node("button", "button button-primary button-small", "Als Transfer bestätigen");
  confirmTransfer.type = "button";
  confirmTransfer.addEventListener("click", async () => {
    const prompt = "Diesen Abgleich als eigenen Transfer bestätigen?\n\n" + (item.outgoing_wallet || "Ausgang") + " → " + (item.incoming_wallet || "Eingang") + " · " + amount(item.amount, item.asset) + "\n\nDabei werden nur die beiden Zwecke auf „Transfer“ gesetzt.";
    if (!confirm(prompt)) return;
    confirmTransfer.disabled = true;
    confirmTransfer.textContent = "Wird verknüpft …";
    try {
      await api("/api/transfers/link", { method: "POST", body: JSON.stringify({ outgoingTransactionId: item.outgoing_id, incomingTransactionId: item.incoming_id }) });
      toast("Transfer verknüpft; beide Buchungen bleiben nachvollziehbar.");
      await load();
    } catch (error) {
      confirmTransfer.disabled = false;
      confirmTransfer.textContent = "Als Transfer bestätigen";
      toast(error.message, "error");
    }
  });
  footer.append(confirmTransfer);
  card.append(header, route, details, footer);
  return card;
}

function renderTransfers(items) {
  const exchangeCount = items.filter((item) => item.origin === "exchange").length;
  el("transfer-suggestion-count").textContent = items.length.toLocaleString("de-DE");
  el("transfer-suggestion-count").setAttribute("aria-label", items.length.toLocaleString("de-DE") + " Transfer-Vorschläge");
  el("transfer-review-status").textContent = items.length
    ? items.length.toLocaleString("de-DE") + " Vorschläge" + (exchangeCount ? ", davon " + exchangeCount.toLocaleString("de-DE") + " aus Börsen-Synchronisierungen" : "") + ". Bitte nur echte Eigenüberträge bestätigen."
    : "Alle bekannten Börsen- und Wallet-Bewegungen sind aktuell ohne offene Transfer-Vorschläge.";
  el("transfer-suggestion-list").replaceChildren(...items.map(transferCard));
  el("transfer-suggestion-empty").hidden = items.length > 0;
}

function providerDefinition(providerId) {
  return state.exchange.providers.find((provider) => provider.id === providerId) || {};
}

function importTargetOptions() {
  const select = el("csv-target");
  const current = select.value;
  select.replaceChildren();
  const profile = state.csvProfiles.find((item) => item.id === el("csv-profile").value) || {};
  const wallets = state.portfolio?.wallets || [];
  const allowedProviders = new Set(profile.targetProviders || []);
  if (wallets.length && !allowedProviders.size) {
    const group = document.createElement("optgroup");
    group.label = "Eigene Wallets";
    wallets.forEach((wallet) => group.append(new Option((wallet.label || wallet.address) + " · " + wallet.chain, `wallet:${wallet.id}`)));
    select.append(group);
  }
  const exchanges = (state.exchange.connections || []).filter((connection) => allowedProviders.has(connection.provider));
  if (exchanges.length) {
    const group = document.createElement("optgroup");
    group.label = "Börsenkonten";
    exchanges.forEach((connection) => group.append(new Option((connection.label || connection.provider) + " · Börsenkonto", `exchange:${connection.id}`)));
    select.append(group);
  }
  if (!select.options.length) {
    const requiredProvider = [...allowedProviders].map((provider) => providerDefinition(provider).defaultLabel || provider).join(" oder ");
    select.add(new Option(`Zuerst ${requiredProvider || "eine Zielquelle"} verbinden`, ""));
  }
  select.value = current || select.options[0]?.value || "";
}

function updateExchangeProviderForm() {
  const provider = providerDefinition(el("exchange-provider").value);
  const api = provider.importMode === "api";
  const tradeRepublic = Boolean(provider.requiresWebLogin);
  const liveUpdates = Boolean(provider.supportsLiveUpdates);
  el("exchange-symbols-field").hidden = !provider.supportsSymbols;
  el("exchange-live-updates-field").hidden = !liveUpdates;
  // Live data stays an explicit choice. The user can also enable or pause it
  // later on the connection card without recreating the API connection.
  el("exchange-live-updates").checked = false;
  el("exchange-label").placeholder = `z. B. ${provider.defaultLabel || "Börse"}`;
  el("exchange-api-key-field").hidden = !api;
  el("exchange-api-secret-field").hidden = !api;
  el("exchange-api-key").required = api;
  el("exchange-api-secret").required = api;
  el("exchange-api-key").minLength = tradeRepublic ? 7 : 8;
  el("exchange-api-secret").minLength = tradeRepublic ? 4 : 8;
  el("exchange-api-key").type = tradeRepublic ? "tel" : "text";
  el("exchange-api-key").autocomplete = tradeRepublic ? "tel" : "off";
  el("exchange-api-key").placeholder = tradeRepublic ? "+49 170 1234567" : "";
  el("exchange-api-secret").autocomplete = tradeRepublic ? "current-password" : "new-password";
  el("exchange-api-key-label").textContent = provider.apiKeyLabel || "Read-only API-Key";
  el("exchange-api-secret-label").textContent = provider.apiSecretLabel || "API-Secret";
  el("exchange-provider-help").textContent = provider.help || "Wähle eine unterstützte Börsenquelle.";
  el("exchange-trade-republic-consent-field").hidden = !tradeRepublic;
  el("exchange-trade-republic-consent").required = tradeRepublic;
  el("exchange-security-copy").textContent = api
    ? tradeRepublic
      ? "Inoffiziell & lokal: Die Web-Anmeldung wird in deiner Trade-Republic-App bestätigt. Deine PIN wird nicht gespeichert; nur die lokale Web-Sitzung wird verschlüsselt abgelegt. Es werden keine Handelsfunktionen aufgerufen."
      : "Read-only & lokal: Die Zugangsdaten dürfen nur Kontostände und Historie lesen. Sie werden nach dem Speichern nicht erneut angezeigt."
    : "Nur lokale Belege: Für diese Quelle werden keine API-, Login- oder Zugangsdaten benötigt oder gespeichert.";
  if (!api) {
    el("exchange-api-key").value = "";
    el("exchange-api-secret").value = "";
    el("exchange-symbols").value = "";
    el("exchange-live-updates").checked = false;
    el("exchange-trade-republic-consent").checked = false;
  }
  el("exchange-connection-form").querySelector('button[type="submit"]').textContent = tradeRepublic ? "Web-Anmeldung starten" : api ? "Börse speichern & abgleichen" : "Börsenkonto anlegen";
}

function clearTradeRepublicWebLoginPoll() {
  if (state.tradeRepublicWebLoginTimer) window.clearTimeout(state.tradeRepublicWebLoginTimer);
  state.tradeRepublicWebLoginTimer = null;
}

function openTradeRepublicWebLogin(connection) {
  clearTradeRepublicWebLoginPoll();
  state.tradeRepublicWebLoginConnectionId = Number(connection.id);
  const pending = connection.tradeRepublic?.status === "approval_pending";
  el("trade-republic-web-login-form").reset();
  el("trade-republic-web-login-error").hidden = true;
  el("trade-republic-web-login-pin-field").hidden = pending;
  el("trade-republic-web-login-submit").textContent = pending ? "Warte auf App-Bestätigung …" : "App-Bestätigung anfordern";
  el("trade-republic-web-login-submit").disabled = pending;
  el("trade-republic-web-login-copy").textContent = pending ? "Bestätige die Anmeldung jetzt in deiner Trade-Republic-App. CryptoBuch prüft die Freigabe lokal; die App bleibt als Gerät angemeldet." : "Für eine neue Web-Sitzung benötigst du einmalig deine PIN. Sie wird nicht gespeichert. Bestätige anschließend die Anmeldung in der Trade-Republic-App.";
  el("trade-republic-web-login-modal").showModal();
  if (pending) pollTradeRepublicWebLogin(); else window.setTimeout(() => el("trade-republic-web-login-pin").focus(), 0);
}

async function pollTradeRepublicWebLogin() {
  try {
    const id = state.tradeRepublicWebLoginConnectionId;
    if (!Number.isSafeInteger(id)) return;
    const result = await api(`/api/exchange-connections/${id}/trade-republic/web-login/poll`, { method: "POST" });
    if (result.tradeRepublic?.status === "connected") {
      clearTradeRepublicWebLoginPoll();
      el("trade-republic-web-login-modal").close();
      state.tradeRepublicWebLoginConnectionId = null;
      toast("Trade-Republic-Websitzung bestätigt. Der nur lesende Krypto-Import wurde gestartet.");
      await load();
      return;
    }
    if (result.tradeRepublic?.status !== "approval_pending") {
      clearTradeRepublicWebLoginPoll();
      el("trade-republic-web-login-error").textContent = result.tradeRepublic?.lastError || "Die App-Bestätigung wurde nicht abgeschlossen.";
      el("trade-republic-web-login-error").hidden = false;
      el("trade-republic-web-login-pin-field").hidden = false;
      el("trade-republic-web-login-submit").disabled = false;
      el("trade-republic-web-login-submit").textContent = "Erneut anmelden";
      await load();
      return;
    }
    state.tradeRepublicWebLoginTimer = window.setTimeout(pollTradeRepublicWebLogin, 2500);
  } catch (error) {
    clearTradeRepublicWebLoginPoll();
    el("trade-republic-web-login-error").textContent = error.message;
    el("trade-republic-web-login-error").hidden = false;
    el("trade-republic-web-login-pin-field").hidden = false;
    el("trade-republic-web-login-submit").disabled = false;
    el("trade-republic-web-login-submit").textContent = "Erneut anmelden";
  }
}

function openExchangeCsvImport(connection) {
  const profileId = connection.csvProfile || providerDefinition(connection.provider).csvProfile;
  const profile = el("csv-profile");
  if (!profileId || ![...profile.options].some((option) => option.value === profileId)) {
    toast("Für diese Börse ist noch kein passendes CSV-Profil eingerichtet.", "error");
    return;
  }
  profile.value = profileId;
  el("csv-profile-help").textContent = state.csvProfiles.find((item) => item.id === profileId)?.detail || "CSV-Profil wählen.";
  importTargetOptions();
  el("csv-target").value = `exchange:${connection.id}`;
  document.getElementById("csv-import-form").scrollIntoView({ behavior: "smooth", block: "center" });
  window.setTimeout(() => el("csv-file").focus(), 350);
}

function providerMark(provider) {
  return provider === "binance" ? "BN" : provider === "bitvavo" ? "BV" : provider === "etoro" ? "eT" : provider === "bsdex" ? "BS" : provider === "trade_republic" ? "TR" : "EX";
}

function historyCopy(history) {
  if (!history) return null;
  if (history.status === "complete") return "Vollständig automatisch importiert";
  if (history.status === "attention") {
    const markets = (history.unresolvedMarkets || []).join(", ");
    return `Unvollständig${markets ? ` · CSV für ${markets} ergänzen` : " · historische Märkte ergänzen"}`;
  }
  if (history.lastError) return `Angehalten: ${history.lastError}`;
  if (history.status === "running") {
    const percent = history.progressTotal ? Math.min(100, Math.round((history.progressCurrent / history.progressTotal) * 100)) : 0;
    return `${history.phaseLabel} werden automatisch nachgeladen · ${percent} %`;
  }
  return "Startet automatisch beim nächsten Sync";
}

function connectionCard(connection) {
  const item = node("li", "exchange-connection-card");
  const head = node("div", "exchange-connection-card-head");
  const mark = node("span", "exchange-provider-mark " + connection.provider, providerMark(connection.provider));
  const name = node("div", "exchange-connection-name");
  const provider = providerDefinition(connection.provider);
  const csv = connection.importMode === "csv";
  const tradeRepublic = connection.tradeRepublic;
  const activationPending = tradeRepublic?.status === "approval_pending";
  const activationNeeded = tradeRepublic && tradeRepublic.status !== "connected";
  name.append(node("strong", "", connection.label || provider.defaultLabel || connection.provider), node("span", "", `${provider.label || connection.provider} · ${csv ? "lokaler CSV-Import" : "Read-only"}`));
  const historyStatus = activationPending ? "App-Freigabe offen" : tradeRepublic?.status === "login_error" ? "Anmeldung prüfen" : connection.history?.lastError || connection.history?.status === "attention" ? "Historie prüfen" : connection.history?.status === "running" ? "Historie läuft" : connection.history?.status === "pending" ? "Historie bereit" : connection.lastSyncedAt ? (csv ? "Importiert" : "Synchronisiert") : "Bereit";
  const status = node("span", "sync-status" + (connection.lastSyncedAt ? " is-synced" : ""), historyStatus);
  head.append(mark, name, status);
  const details = node("dl", "exchange-connection-details");
  const account = node("div");
  account.append(node("dt", "", "Börsenkonto"), node("dd", "", connection.accountLabel || connection.label || "Separates Börsenkonto"));
  const synced = node("div");
  synced.append(node("dt", "", "Letzter Import"), node("dd", "", connection.lastSyncedAt ? readableDateTime(connection.lastSyncedAt) : "Noch nicht synchronisiert"));
  details.append(account, synced);
  if (connection.history) {
    const history = node("div");
    history.append(node("dt", "", "Historienimport"), node("dd", connection.history.lastError ? "history-error" : "", historyCopy(connection.history)));
    details.append(history);
  }
  if (connection.provider === "binance" && (connection.symbols || connection.history?.markets?.length)) {
    const markets = node("div");
    markets.append(node("dt", "", "Märkte"), node("dd", "", connection.symbols || connection.history.markets.join(", ")));
    details.append(markets);
  }
  if (connection.balance) {
    const balance = node("div");
    const copy = connection.balance.status === "confirmed"
      ? `Kontostand bestätigt${connection.balance.observedAt ? ` · ${readableDateTime(connection.balance.observedAt)}` : ""}`
      : `Kontostand wird beim nächsten ${connection.provider === "bsdex" ? "BSDEX" : "Binance"}-Sync bestätigt`;
    balance.append(node("dt", "", "Kontostand"), node("dd", connection.balance.status === "pending" ? "history-error" : "", copy));
    details.append(balance);
  }
  if (connection.live) {
    const live = node("div");
    const copy = !connection.live.enabled ? "Deaktiviert"
      : connection.live.status === "connected" ? `Verbunden${connection.live.lastEventAt ? ` · letztes Ereignis ${readableDateTime(connection.live.lastEventAt)}` : ""}`
        : connection.live.status === "reconnecting" ? "Verbindung wird wiederhergestellt"
          : connection.live.status === "error" ? `Prüfen: ${connection.live.lastError || "Verbindung fehlgeschlagen"}`
            : "Wird verbunden";
    live.append(node("dt", "", "Live-Updates"), node("dd", connection.live.status === "error" ? "history-error" : "", copy));
    details.append(live);
  }
  if (tradeRepublic) {
    const activation = node("div");
    const copy = tradeRepublic.status === "connected" ? `Web-Sitzung bestätigt${tradeRepublic.connectedAt ? ` · ${readableDateTime(tradeRepublic.connectedAt)}` : ""}`
      : activationPending ? "App-Bestätigung steht aus"
        : tradeRepublic.lastError ? `Anmeldung fehlgeschlagen: ${tradeRepublic.lastError}` : "Web-Anmeldung noch nicht gestartet";
    activation.append(node("dt", "", "Web-Anmeldung"), node("dd", tradeRepublic.lastError ? "history-error" : "", copy));
    details.append(activation);
  }
  const footer = node("div", "exchange-connection-card-footer");
  footer.append(node("p", "", csv ? "CSV-Buchungen bleiben lokal und werden nach dem Import mit allen lokalen Wallets abgeglichen." : activationNeeded ? "Vor dem ersten Import muss die inoffizielle Trade-Republic-Webanmeldung in der App bestätigt werden. Der Import ruft ausschließlich Timeline und Details ab." : connection.provider === "bsdex" && connection.live?.enabled ? `BSDEX-Live-Updates laufen nur lesend lokal. Krypto-Ein- und Auszahlungen kommen im seriellen REST-Abgleich alle ${connection.live.reconcileIntervalMinutes} Minuten mit und werden danach als Transfer-Vorschläge mit lokalen Wallets verglichen.` : connection.provider === "bsdex" ? "Abgeschlossene Krypto-Ein- und Auszahlungen werden read-only importiert und danach als Transfer-Vorschläge mit lokalen Wallets verglichen." : connection.history?.status === "attention" ? "Die API kann nicht alle historischen Märkte liefern. Ergänze die genannten Märkte oder den vollständigen Binance-CSV-Export; fehlende Buchungen werden nie als Kauf oder Verkauf erfunden." : connection.history && connection.history.status !== "complete" ? "Die Binance-Historie wird automatisch in kleinen, seriellen Schritten nachgeladen. Der Transfer-Abgleich folgt nach Abschluss." : "Nach dem Sync wird automatisch mit allen lokalen Wallets abgeglichen."));
  const actions = node("div", "exchange-connection-actions");
  const sync = node("button", "button button-secondary button-small", csv ? "CSV importieren" : activationPending ? "App-Bestätigung öffnen" : activationNeeded ? "Web-Anmeldung starten" : "Jetzt synchronisieren");
  sync.type = "button";
  sync.addEventListener("click", async () => {
    if (csv) return openExchangeCsvImport(connection);
    if (activationPending) return openTradeRepublicWebLogin(connection);
    if (activationNeeded) {
      return openTradeRepublicWebLogin(connection);
    }
    sync.disabled = true;
    sync.textContent = "Sync gestartet …";
    try {
      const queued = await api("/api/exchange-connections/" + connection.id + "/sync", { method: "POST" });
      toast(connection.history && connection.history.status !== "complete" ? "Aktuelle Daten und historische Binance-Buchungen werden automatisch nachgeladen." : "Börsen-Sync als Job #" + queued.job.id + " gestartet. Der Abgleich folgt automatisch.");
      window.setTimeout(load, 800);
    } catch (error) {
      sync.disabled = false;
      sync.textContent = "Jetzt synchronisieren";
      toast(error.message, "error");
    }
  });
  if (connection.provider === "binance" && !csv) {
    const markets = node("button", "text-button", "Historische Märkte ergänzen");
    markets.type = "button";
    markets.addEventListener("click", async () => {
      const value = prompt("Historische Binance-Spot-Märkte (durch Komma getrennt). Leer lassen, um nur automatisch erkannte Märkte erneut zu prüfen.", connection.symbols || "");
      if (value === null) return;
      markets.disabled = true;
      try {
        const result = await api("/api/exchange-connections/" + connection.id + "/binance-markets", { method: "PATCH", body: JSON.stringify({ symbols: value }) });
        toast(result.job ? "Historische Spot-Märkte werden erneut geprüft." : "Märkte gespeichert.");
        await load();
      } catch (error) {
        toast(error.message, "error");
      } finally {
        markets.disabled = false;
      }
    });
    actions.append(markets);
  }
  if (connection.live) {
    const liveToggle = node("button", "text-button", connection.live.enabled ? "Live-Updates pausieren" : "Live-Updates aktivieren");
    liveToggle.type = "button";
    liveToggle.addEventListener("click", async () => {
      liveToggle.disabled = true;
      try {
        const result = await api("/api/exchange-connections/" + connection.id + "/live-updates", { method: "PATCH", body: JSON.stringify({ enabled: !connection.live.enabled }) });
        toast(result.job ? "Live-Updates werden nach dem aktuellen Read-only-Abgleich aktiviert." : "BSDEX-Live-Updates pausiert.");
        await load();
      } catch (error) {
        toast(error.message, "error");
      } finally { liveToggle.disabled = false; }
    });
    actions.append(liveToggle);
  }
  const remove = node("button", "text-button exchange-remove", "Verbindung entfernen");
  remove.type = "button";
  remove.addEventListener("click", async () => {
    if (!confirm("Verbindung „" + (connection.label || connection.provider) + "“ entfernen?\n\nBereits importierte Buchungen bleiben erhalten.")) return;
    try {
      await api("/api/exchange-connections/" + connection.id, { method: "DELETE" });
      toast("Börsenverbindung entfernt.");
      await load();
    } catch (error) { toast(error.message, "error"); }
  });
  actions.append(sync, remove);
  footer.append(actions);
  item.append(head, details, footer);
  return item;
}

function renderExchangeConnections() {
  const provider = el("exchange-provider");
  const previous = provider.value;
  provider.replaceChildren(...state.exchange.providers.map((item) => new Option(item.label, item.id)));
  provider.value = previous || state.exchange.providers[0]?.id || "";
  updateExchangeProviderForm();
  const connections = state.exchange.connections || [];
  if (!connections.length) {
    const empty = node("li", "exchange-connection-empty");
    empty.append(node("span", "", "⌁"), node("strong", "", "Noch keine Börse verbunden"), node("p", "", "Lege eine Read-only-Verbindung oder ein Börsenkonto für lokale Beleg-CSV an."));
    el("exchange-connection-list").replaceChildren(empty);
    return;
  }
  el("exchange-connection-list").replaceChildren(...connections.map(connectionCard));
}

function render() {
  const data = state.data;
  el("missing-price-count").textContent = data.counts.missingHistoricPrices.toLocaleString("de-DE");
  el("unassigned-count").textContent = data.counts.unassignedPurposes.toLocaleString("de-DE");
  el("manual-price-count").textContent = data.counts.manualHistoricPrices.toLocaleString("de-DE");
  [["missing-price-list", data.missingHistoricPrices, true], ["unassigned-list", data.unassignedPurposes, false]].forEach(([id, rows, missing]) => {
    el(id).replaceChildren(...rows.map((entry) => row(entry, missing)));
    el(id === "missing-price-list" ? "missing-price-empty" : "unassigned-empty").hidden = rows.length > 0;
  });
  renderTransfers(data.possibleTransfers || []);
  el("duplicate-list").replaceChildren(...(data.possibleDuplicates || []).map((entry) => {
    const tr = node("tr");
    [String(entry.hash).slice(0, 16) + "…", entry.asset, amount(entry.amount, entry.asset), entry.occurrences].forEach((value) => tr.append(node("td", "", value)));
    return tr;
  }));
  el("duplicate-empty").hidden = (data.possibleDuplicates || []).length > 0;
  const profile = el("csv-profile");
  const previous = profile.value;
  profile.replaceChildren(...state.csvProfiles.map((item) => new Option(item.label, item.id)));
  profile.value = previous || "generic";
  el("csv-profile-help").textContent = state.csvProfiles.find((item) => item.id === profile.value)?.detail || "CSV-Profil wählen.";
  importTargetOptions();
  renderExchangeConnections();
}

async function load() {
  try {
    const [data, portfolio, profiles, exchange] = await Promise.all([api("/api/data-quality"), api("/api/portfolio"), api("/api/import/csv-profiles"), api("/api/exchange-connections")]);
    state.data = data;
    state.portfolio = portfolio;
    state.csvProfiles = profiles.profiles || [];
    state.exchange = exchange;
    render();
  } catch (error) { toast(error.message, "error"); }
}

function openPrice(transaction) {
  state.transaction = transaction;
  el("quality-price-copy").textContent = (transaction.asset_symbol || transaction.asset) + " · " + (transaction.timestamp ? date.format(new Date(transaction.timestamp)) : "ohne Zeitstempel");
  el("quality-price-input").value = "";
  el("quality-price-error").hidden = true;
  el("quality-price-modal").showModal();
}

function formatBytes(value) {
  return value < 1024 * 1024 ? Math.ceil(value / 1024) + " KB" : (value / (1024 * 1024)).toFixed(1) + " MB";
}

function renderDocuments(documents) {
  if (!documents.length) {
    el("quality-document-list").replaceChildren(Object.assign(node("li", "muted"), { textContent: "Noch kein lokaler Nachweis angehängt." }));
    return;
  }
  el("quality-document-list").replaceChildren(...documents.map((entry) => {
    const item = node("li");
    const link = node("a", "", entry.originalName);
    link.href = "/api/transaction-documents/" + encodeURIComponent(entry.id) + "/download";
    link.target = "_blank";
    link.rel = "noopener";
    item.append(link, " · " + formatBytes(entry.byteSize) + " · SHA-256 " + entry.sha256.slice(0, 12) + "… · ");
    const remove = node("button", "text-button", "Entfernen");
    remove.type = "button";
    remove.addEventListener("click", async () => {
      if (!confirm("Nachweis „" + entry.originalName + "“ wirklich lokal löschen?")) return;
      try { await api("/api/transaction-documents/" + entry.id, { method: "DELETE" }); await loadDocuments(); } catch (error) { toast(error.message, "error"); }
    });
    item.append(remove);
    return item;
  }));
}

async function loadDocuments() {
  if (!state.transaction) return;
  const data = await api("/api/transactions/" + state.transaction.id + "/documents");
  renderDocuments(data.documents || []);
}

async function openDocuments(transaction) {
  state.transaction = transaction;
  el("quality-document-copy").textContent = (transaction.asset_symbol || transaction.asset) + " · " + (transaction.timestamp ? date.format(new Date(transaction.timestamp)) : "ohne Zeitstempel");
  el("quality-document-form").reset();
  el("quality-document-error").hidden = true;
  el("quality-document-modal").showModal();
  try { await loadDocuments(); } catch (error) { toast(error.message, "error"); }
}

async function savePrice(auto = false) {
  try {
    const result = await api("/api/transactions/" + state.transaction.id + "/historical-price", { method: "PATCH", body: JSON.stringify({ priceTransactionEur: auto ? null : el("quality-price-input").value }) });
    el("quality-price-modal").close();
    toast(result.price_source === "manual" ? "Kurs gespeichert." : "Automatik aktiviert.");
    await load();
  } catch (error) {
    el("quality-price-error").textContent = error.message;
    el("quality-price-error").hidden = false;
  }
}

async function assignPurpose(transaction) {
  const purpose = prompt("Zweck für diese Transaktion:", transaction.purpose || "Kauf");
  if (purpose === null) return;
  try {
    await api("/api/transactions/" + transaction.id, { method: "PATCH", body: JSON.stringify({ purpose: purpose.trim() }) });
    toast("Zweck gespeichert.");
    await load();
  } catch (error) { toast(error.message, "error"); }
}

el("retry-prices").addEventListener("click", async () => {
  try {
    const queued = await api("/api/jobs/price-backfill", { method: "POST", body: JSON.stringify({ force: true }) });
    toast("Kurs-Job #" + queued.job.id + " wurde gestartet.");
  } catch (error) { toast(error.message, "error"); }
});
el("csv-profile").addEventListener("change", () => {
  el("csv-profile-help").textContent = state.csvProfiles.find((item) => item.id === el("csv-profile").value)?.detail || "CSV-Profil wählen.";
  importTargetOptions();
});
el("exchange-provider").addEventListener("change", updateExchangeProviderForm);
el("csv-import-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  try {
    const file = el("csv-file").files[0];
    if (!file) throw new Error("Bitte zuerst eine CSV-Datei auswählen.");
    const [targetKind, targetId] = String(el("csv-target").value || "").split(":");
    if (!targetId) throw new Error("Bitte eine Zielquelle auswählen.");
    const result = await api("/api/import/csv", { method: "POST", body: JSON.stringify({
      ...(targetKind === "exchange" ? { exchangeConnectionId: targetId } : { walletId: targetId }),
      profile: el("csv-profile").value, csv: await file.text(),
    }) });
    toast(result.imported.toLocaleString("de-DE") + " CSV-Transaktionen importiert.");
    form.reset();
    await load();
  } catch (error) { toast(error.message, "error"); }
});
el("exchange-connection-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const submit = form.querySelector('button[type="submit"]');
  const providerId = el("exchange-provider").value;
  try {
    submit.disabled = true;
    submit.textContent = "Verbindung wird eingerichtet …";
    const result = await api("/api/exchange-connections", { method: "POST", body: JSON.stringify({
      provider: el("exchange-provider").value, label: el("exchange-label").value,
      apiKey: el("exchange-api-key").value, apiSecret: el("exchange-api-secret").value, symbols: el("exchange-symbols").value,
      tradeRepublicConsent: el("exchange-trade-republic-consent").checked,
      liveUpdatesEnabled: el("exchange-live-updates").checked,
    }) });
    form.reset();
    if (result.tradeRepublic?.status === "approval_pending") {
      toast("Trade-Republic-Webanmeldung gestartet. Bitte in der App bestätigen.");
      openTradeRepublicWebLogin(result);
    } else if (result.tradeRepublic?.status === "login_error") {
      toast(result.tradeRepublic.lastError || "Die Trade-Republic-Webanmeldung konnte nicht gestartet werden.", "error");
    } else toast(result.job ? "Read-only-Börsenverbindung gespeichert; aktuelle Daten und verfügbare Historie werden automatisch importiert." : "Börsenkonto für lokale CSV-Belege gespeichert.");
    await load();
  } catch (error) { toast(error.message, "error"); }
  finally {
    submit.disabled = false;
    const provider = providerDefinition(providerId);
    submit.textContent = provider.requiresWebLogin ? "Web-Anmeldung starten" : provider.importMode === "api" ? "Börse speichern & abgleichen" : "Börsenkonto anlegen";
  }
});
el("trade-republic-web-login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const errorNode = el("trade-republic-web-login-error");
  const submit = event.currentTarget.querySelector('button[type="submit"]');
  try {
    if (!Number.isSafeInteger(state.tradeRepublicWebLoginConnectionId)) throw new Error("Die Trade-Republic-Verbindung fehlt.");
    submit.disabled = true;
    submit.textContent = "Anmeldung wird gestartet …";
    const result = await api("/api/exchange-connections/" + state.tradeRepublicWebLoginConnectionId + "/trade-republic/web-login/start", {
      method: "POST", body: JSON.stringify({ pin: el("trade-republic-web-login-pin").value }),
    });
    if (result.tradeRepublic?.status !== "approval_pending") throw new Error(result.tradeRepublic?.lastError || "Die Trade-Republic-Webanmeldung konnte nicht gestartet werden.");
    openTradeRepublicWebLogin(result);
  } catch (error) {
    errorNode.textContent = error.message;
    errorNode.hidden = false;
  } finally {
    submit.disabled = false;
    if (!state.tradeRepublicWebLoginTimer) submit.textContent = "App-Bestätigung anfordern";
  }
});
el("quality-document-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const file = el("quality-document-file").files[0];
  const errorNode = el("quality-document-error");
  try {
    if (!state.transaction || !file) throw new Error("Bitte zuerst einen Nachweis auswählen.");
    if (file.size > 5 * 1024 * 1024) throw new Error("Ein Nachweis darf maximal 5 MB groß sein.");
    const response = await fetch("/api/transactions/" + state.transaction.id + "/documents", { method: "POST", headers: { "Content-Type": file.type || "application/octet-stream", "X-Document-Name": encodeURIComponent(file.name) }, body: file });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "Nachweis konnte nicht gespeichert werden.");
    form.reset();
    await loadDocuments();
    toast("Nachweis lokal gespeichert.");
  } catch (error) { errorNode.textContent = error.message; errorNode.hidden = false; }
});
el("reload-quality").addEventListener("click", load);
el("close-quality-price").addEventListener("click", () => el("quality-price-modal").close());
el("close-trade-republic-web-login").addEventListener("click", () => { clearTradeRepublicWebLoginPoll(); el("trade-republic-web-login-modal").close(); });
el("close-quality-document").addEventListener("click", () => el("quality-document-modal").close());
el("quality-price-form").addEventListener("submit", (event) => { event.preventDefault(); savePrice(); });
el("quality-price-auto").addEventListener("click", () => savePrice(true));
load();
