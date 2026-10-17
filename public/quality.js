const { api, el, node, toast } = window.CryptoBuchUI;
const date = new Intl.DateTimeFormat(window.CryptoBuchI18n.locale, { dateStyle: "medium" });
const dateTime = new Intl.DateTimeFormat(window.CryptoBuchI18n.locale, { dateStyle: "medium", timeStyle: "short" });
const amount = (value, asset) => new Intl.NumberFormat(window.CryptoBuchI18n.locale, { maximumFractionDigits: 8 }).format(Number(value || 0)) + " " + asset;
const state = { data: null, transaction: null, portfolio: null, csvProfiles: [], exchange: { providers: [], connections: [] }, tradeRepublicWebLoginConnectionId: null, tradeRepublicWebLoginTimer: null };

function readableDateTime(value) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? window.CryptoBuchI18n.t("Zeitpunkt unbekannt") : dateTime.format(parsed);
}

function timeDistance(start, end) {
  const milliseconds = Math.abs(new Date(end).getTime() - new Date(start).getTime());
  if (!Number.isFinite(milliseconds)) return window.CryptoBuchI18n.t("Zeitpunkt unbekannt");
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
  const open = node("a", "text-button", window.CryptoBuchI18n.t("Coin öffnen"));
  open.href = "/asset.html?chain=" + encodeURIComponent(transaction.chain) + "&asset=" + encodeURIComponent(transaction.asset);
  actions.append(open);
  const action = node("button", window.CryptoBuchI18n.t("text-button quality-action"), missingPrice ? window.CryptoBuchI18n.t("Kurs setzen") : window.CryptoBuchI18n.t("Zweck zuordnen"));
  action.addEventListener("click", () => missingPrice ? openPrice(transaction) : assignPurpose(transaction));
  const documents = node("button", window.CryptoBuchI18n.t("text-button quality-action"), window.CryptoBuchI18n.t("Nachweise"));
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
    node("span", "transfer-kind " + (item.origin === "exchange" ? "exchange" : "wallet"), item.transfer_kind === "exchange_exchange" ? window.CryptoBuchI18n.t("Börse ↔ Börse") : item.origin === "exchange" ? window.CryptoBuchI18n.t("Börse ↔ Wallet") : window.CryptoBuchI18n.t("Wallet ↔ Wallet")),
    node("strong", "transfer-amount", amount(item.amount, item.asset)),
  );
  const route = node("div", "transfer-route");
  const source = node("div", "transfer-route-point");
  source.append(node("span", "transfer-route-label", window.CryptoBuchI18n.t("Ausgang")), node("strong", "", item.outgoing_wallet || window.CryptoBuchI18n.t("Unbekannte Quelle")), node("small", "", readableDateTime(item.outgoing_at)));
  const arrow = node("span", "transfer-route-arrow", "→");
  arrow.setAttribute("aria-hidden", "true");
  const target = node("div", "transfer-route-point");
  target.append(node("span", "transfer-route-label", window.CryptoBuchI18n.t("Eingang")), node("strong", "", item.incoming_wallet || window.CryptoBuchI18n.t("Unbekanntes Ziel")), node("small", "", readableDateTime(item.incoming_at)));
  route.append(source, arrow, target);
  const details = node("div", "transfer-details");
  details.append(
    transferDetail(window.CryptoBuchI18n.t("Abgleich"), timeDistance(item.outgoing_at, item.incoming_at)),
    transferDetail(window.CryptoBuchI18n.t("Quelle"), item.origin === "exchange" ? window.CryptoBuchI18n.t("Börsen-Synchronisierung") : window.CryptoBuchI18n.t("Wallet-Synchronisierung")),
  );
  if (item.hash_matched) details.append(transferDetail(window.CryptoBuchI18n.t("Transaktions-ID"), window.CryptoBuchI18n.t("Vollständig übereinstimmend")));
  else details.append(transferDetail(window.CryptoBuchI18n.t("Transaktions-ID"), window.CryptoBuchI18n.t("Nicht vollständig abgleichbar – Betrag und Zeit prüfen")));
  if (item.fee > 0) details.append(transferDetail(window.CryptoBuchI18n.t("Auszahlungsgebühr"), amount(item.fee, item.fee_asset || item.asset)));
  if (item.fee_adjusted) details.append(transferDetail(window.CryptoBuchI18n.t("Gebühr"), window.CryptoBuchI18n.t("Im Betrag berücksichtigt")));
  const footer = node("div", "transfer-card-footer");
  footer.append(node("p", "", window.CryptoBuchI18n.t("Bestätigung verknüpft diese beiden Buchungen als eigenen Transfer. Beträge, Kurse und Gebühren bleiben erhalten.")));
  const confirmTransfer = node("button", "button button-primary button-small", window.CryptoBuchI18n.t("Als Transfer bestätigen"));
  confirmTransfer.type = "button";
  confirmTransfer.addEventListener("click", async () => {
    const prompt = window.CryptoBuchI18n.t("Diesen Abgleich als eigenen Transfer bestätigen?\n\n{from} → {to} · {amount}\n\nBeide Buchungen werden als Transfer verknüpft. Beträge, Kurse und Gebühren bleiben erhalten.", { from: item.outgoing_wallet || window.CryptoBuchI18n.t("Ausgang"), to: item.incoming_wallet || window.CryptoBuchI18n.t("Eingang"), amount: amount(item.amount, item.asset) });
    if (!confirm(prompt)) return;
    confirmTransfer.disabled = true;
    confirmTransfer.textContent = window.CryptoBuchI18n.t("Wird verknüpft …");
    try {
      await api("/api/transfers/link", { method: "POST", body: JSON.stringify({ outgoingTransactionId: item.outgoing_id, incomingTransactionId: item.incoming_id }) });
      toast(window.CryptoBuchI18n.t("Transfer verknüpft; beide Buchungen bleiben nachvollziehbar."));
      await load();
    } catch (error) {
      confirmTransfer.disabled = false;
      confirmTransfer.textContent = window.CryptoBuchI18n.t("Als Transfer bestätigen");
      toast(error.message, "error");
    }
  });
  footer.append(confirmTransfer);
  card.append(header, route, details, footer);
  return card;
}

function renderTransfers(items) {
  const exchangeCount = items.filter((item) => item.origin === "exchange").length;
  el("transfer-suggestion-count").textContent = items.length.toLocaleString(window.CryptoBuchI18n.locale);
  el("transfer-suggestion-count").setAttribute("aria-label", window.CryptoBuchI18n.t("Transfer-Vorschläge: {count}", { count: items.length.toLocaleString(window.CryptoBuchI18n.locale) }));
  el("transfer-review-status").textContent = items.length
    ? window.CryptoBuchI18n.t("Vorschläge: {count}, davon {exchange} aus Börsen-Synchronisierungen. Bitte nur echte Eigenüberträge bestätigen.", { count: items.length.toLocaleString(window.CryptoBuchI18n.locale), exchange: exchangeCount.toLocaleString(window.CryptoBuchI18n.locale) })
    : window.CryptoBuchI18n.t("Alle bekannten Börsen- und Wallet-Bewegungen sind aktuell ohne offene Transfer-Vorschläge.");
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
    group.label = window.CryptoBuchI18n.t("Eigene Wallets");
    wallets.forEach((wallet) => group.append(new Option((wallet.label || wallet.address) + " · " + wallet.chain, `wallet:${wallet.id}`)));
    select.append(group);
  }
  const exchanges = (state.exchange.connections || []).filter((connection) => allowedProviders.has(connection.provider) && (profile.id !== "bsdex" || connection.accessMode === "web"));
  if (exchanges.length) {
    const group = document.createElement("optgroup");
    group.label = window.CryptoBuchI18n.t("Börsenkonten");
    exchanges.forEach((connection) => group.append(new Option(window.CryptoBuchI18n.t("{name} · Börsenkonto", { name: connection.label || connection.provider }), `exchange:${connection.id}`)));
    select.append(group);
  }
  if (!select.options.length) {
    const requiredProvider = [...allowedProviders].map((provider) => providerDefinition(provider).defaultLabel || provider).join(window.CryptoBuchI18n.t(" oder "));
    select.add(new Option(window.CryptoBuchI18n.t("Zuerst {p0} verbinden", { p0: requiredProvider || window.CryptoBuchI18n.t("eine Zielquelle") }), ""));
  }
  select.value = current || select.options[0]?.value || "";
}

function updateExchangeProviderForm() {
  const provider = providerDefinition(el("exchange-provider").value);
  const bsdexWeb = Boolean(provider.requiresBsdexWebLogin);
  const api = provider.importMode === "api" && !bsdexWeb;
  const tradeRepublic = Boolean(provider.requiresWebLogin);
  const liveUpdates = Boolean(provider.supportsLiveUpdates);
  const etoro = Boolean(provider.supportsEnvironment);
  const coinbase = Boolean(provider.requiresPassphrase);
  const advanced = provider.id === "coinbase_advanced";
  el("exchange-symbols-field").hidden = !provider.supportsSymbols;
  el("exchange-live-updates-field").hidden = !liveUpdates;
  el("exchange-etoro-environment-field").hidden = !etoro;
  el("exchange-coinbase-passphrase-field").hidden = !coinbase;
  if (!etoro) el("exchange-etoro-environment").value = "real";
  // Live data stays an explicit choice. The user can also enable or pause it
  // later on the connection card without recreating the API connection.
  el("exchange-live-updates").checked = false;
  el("exchange-label").placeholder = window.CryptoBuchI18n.t("z. B. {p0}", { p0: window.CryptoBuchI18n.message(provider.defaultLabel) || window.CryptoBuchI18n.t("Börse") });
  el("exchange-api-key-field").hidden = !api;
  el("exchange-api-secret-field").hidden = !api || advanced;
  el("exchange-advanced-secret-field").hidden = !advanced;
  el("exchange-advanced-secret").required = advanced;
  el("exchange-api-key").required = api;
  el("exchange-api-secret").required = api && !advanced;
  el("exchange-coinbase-passphrase").required = coinbase;
  el("exchange-api-key").minLength = tradeRepublic ? 7 : 8;
  el("exchange-api-secret").minLength = tradeRepublic ? 4 : 8;
  el("exchange-api-key").type = tradeRepublic ? "tel" : "text";
  el("exchange-api-key").autocomplete = tradeRepublic ? "tel" : "off";
  el("exchange-api-key").placeholder = tradeRepublic ? "+49 170 1234567" : "";
  el("exchange-api-secret").autocomplete = tradeRepublic ? "current-password" : "new-password";
  el("exchange-api-key-label").textContent = window.CryptoBuchI18n.message(provider.apiKeyLabel) || window.CryptoBuchI18n.t("Read-only API-Key");
  el("exchange-api-secret-label").textContent = window.CryptoBuchI18n.message(provider.apiSecretLabel) || window.CryptoBuchI18n.t("API-Secret");
  el("exchange-provider-help").textContent = window.CryptoBuchI18n.message(provider.help) || window.CryptoBuchI18n.t("Wähle eine unterstützte Börsenquelle.");
  el("exchange-bsdex-web-consent-field").hidden = !bsdexWeb;
  el("exchange-bsdex-web-consent").required = bsdexWeb;
  el("exchange-trade-republic-consent-field").hidden = !tradeRepublic;
  el("exchange-trade-republic-consent").required = tradeRepublic;
  el("exchange-security-copy").textContent = bsdexWeb ? window.CryptoBuchI18n.t("Web-Import: Deine Anmeldung erfolgt über einen getrennten lokalen Browser. Die Sitzung wird verschlüsselt gespeichert und besitzt Kontorechte; der Adapter ruft nur Historien ab. Bestände werden aus Buchungen berechnet und sind kein bestätigter Börsensaldo.") : api
    ? tradeRepublic
      ? window.CryptoBuchI18n.t("Inoffiziell & lokal: Die Web-Anmeldung wird in deiner Trade-Republic-App bestätigt. Deine PIN wird nicht gespeichert; nur die lokale Web-Sitzung wird verschlüsselt abgelegt. Es werden keine Handelsfunktionen aufgerufen.")
      : etoro
        ? window.CryptoBuchI18n.t("Read-only & lokal: Der User-Key muss zur gewählten eToro-Kontoart (Real oder Demo) gehören und nur Leserechte besitzen. Er wird nach dem Speichern nicht erneut angezeigt.")
        : advanced
          ? window.CryptoBuchI18n.t("Read-only & lokal: Nur View aktivieren. Vollständigen API-Schlüsselnamen und den privaten API-Signaturschlüssel eingeben; keine Passphrase nötig. Der Signaturschlüssel wird lokal verschlüsselt gespeichert und nie zurückgegeben. Konten, Spot-Trades und die Kontohistorie mit Käufen, Transfers und Rewards werden ausschließlich lesend abgerufen.")
        : coinbase
          ? window.CryptoBuchI18n.t("Read-only & lokal: Erstelle den Coinbase-Exchange-Key ausschließlich mit dem Recht „View“. API-Key, Secret und Passphrase werden nur für signierte GET-Anfragen zu Konten, Ledger und Fills genutzt und danach nicht erneut angezeigt. Coinbase Advanced Trade/CDP nutzt andere Zugangsdaten und ist mit diesem Exchange-Adapter nicht kompatibel.")
      : window.CryptoBuchI18n.t("Read-only & lokal: Die Zugangsdaten dürfen nur Kontostände und Historie lesen. Sie werden nach dem Speichern nicht erneut angezeigt.")
    : window.CryptoBuchI18n.t("Nur lokale Belege: Für diese Quelle werden keine API-, Login- oder Zugangsdaten benötigt oder gespeichert.");
  if (!api) {
    el("exchange-api-key").value = "";
    el("exchange-api-secret").value = "";
    el("exchange-coinbase-passphrase").value = "";
    el("exchange-symbols").value = "";
    el("exchange-live-updates").checked = false;
    el("exchange-trade-republic-consent").checked = false;
  }
  el("exchange-connection-form").querySelector('button[type="submit"]').textContent = tradeRepublic || bsdexWeb ? window.CryptoBuchI18n.t("Web-Anmeldung einrichten") : api ? window.CryptoBuchI18n.t("Börse speichern & abgleichen") : window.CryptoBuchI18n.t("Börsenkonto anlegen");
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
  el("trade-republic-web-login-submit").textContent = pending ? window.CryptoBuchI18n.t("Warte auf App-Bestätigung …") : window.CryptoBuchI18n.t("App-Bestätigung anfordern");
  el("trade-republic-web-login-submit").disabled = pending;
  el("trade-republic-web-login-copy").textContent = pending ? window.CryptoBuchI18n.t("Bestätige die Anmeldung jetzt in deiner Trade-Republic-App. CryptoBuch prüft die Freigabe lokal; die App bleibt als Gerät angemeldet.") : window.CryptoBuchI18n.t("Für eine neue Web-Sitzung benötigst du einmalig deine PIN. Sie wird nicht gespeichert. Bestätige anschließend die Anmeldung in der Trade-Republic-App.");
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
      toast(window.CryptoBuchI18n.t("Trade-Republic-Websitzung bestätigt. Der nur lesende Krypto-Import wurde gestartet."));
      await load();
      return;
    }
    if (result.tradeRepublic?.status !== "approval_pending") {
      clearTradeRepublicWebLoginPoll();
      el("trade-republic-web-login-error").textContent = window.CryptoBuchI18n.message(result.tradeRepublic?.lastError) || window.CryptoBuchI18n.t("Die App-Bestätigung wurde nicht abgeschlossen.");
      el("trade-republic-web-login-error").hidden = false;
      el("trade-republic-web-login-pin-field").hidden = false;
      el("trade-republic-web-login-submit").disabled = false;
      el("trade-republic-web-login-submit").textContent = window.CryptoBuchI18n.t("Erneut anmelden");
      await load();
      return;
    }
    state.tradeRepublicWebLoginTimer = window.setTimeout(pollTradeRepublicWebLogin, 2500);
  } catch (error) {
    clearTradeRepublicWebLoginPoll();
    el("trade-republic-web-login-error").textContent = window.CryptoBuchI18n.message(error.message);
    el("trade-republic-web-login-error").hidden = false;
    el("trade-republic-web-login-pin-field").hidden = false;
    el("trade-republic-web-login-submit").disabled = false;
    el("trade-republic-web-login-submit").textContent = window.CryptoBuchI18n.t("Erneut anmelden");
  }
}

function openExchangeCsvImport(connection) {
  const profileId = connection.csvProfile || providerDefinition(connection.provider).csvProfile;
  const profile = el("csv-profile");
  if (!profileId || ![...profile.options].some((option) => option.value === profileId)) {
    toast(window.CryptoBuchI18n.t("Für diese Börse ist noch kein passendes CSV-Profil eingerichtet."), "error");
    return;
  }
  profile.value = profileId;
  el("csv-profile-help").textContent = window.CryptoBuchI18n.message(state.csvProfiles.find((item) => item.id === profileId)?.detail) || window.CryptoBuchI18n.t("CSV-Profil wählen.");
  importTargetOptions();
  el("csv-target").value = `exchange:${connection.id}`;
  document.getElementById("csv-import-form").scrollIntoView({ behavior: "smooth", block: "center" });
  window.setTimeout(() => el("csv-file").focus(), 350);
}

function providerMark(provider) {
  return provider === "binance" ? window.CryptoBuchI18n.t("BN") : ["coinbase", "coinbase_advanced"].includes(provider) ? window.CryptoBuchI18n.t("CB") : provider === "bitvavo" ? window.CryptoBuchI18n.t("BV") : provider === "etoro" ? "eT" : provider === "bsdex" ? window.CryptoBuchI18n.t("BS") : provider === "trade_republic" ? window.CryptoBuchI18n.t("TR") : window.CryptoBuchI18n.t("EX");
}

function historyCopy(history) {
  if (!history) return null;
  if (history.status === "complete") return window.CryptoBuchI18n.t("Vollständig automatisch importiert");
  if (history.status === "attention") {
    const markets = (history.unresolvedMarkets || []).join(", ");
    return window.CryptoBuchI18n.t("Unvollständig{p0}", { p0: markets ? window.CryptoBuchI18n.t(" · CSV für {p0} ergänzen", { p0: markets }) : history.warnings?.length ? ` · ${window.CryptoBuchI18n.message(history.warnings[0])}` : window.CryptoBuchI18n.t(" · historische Märkte ergänzen") });
  }
  if (history.lastError) return window.CryptoBuchI18n.t("Angehalten: {p0}", { p0: history.lastError });
  if (history.status === "running") {
    const percent = history.progressTotal ? Math.min(100, Math.round((history.progressCurrent / history.progressTotal) * 100)) : 0;
    return window.CryptoBuchI18n.t("{p0} werden automatisch nachgeladen · {p1} %", { p0: history.phaseLabel, p1: percent });
  }
  return window.CryptoBuchI18n.t("Startet automatisch beim nächsten Sync");
}

function connectionCard(connection) {
  const item = node("li", "exchange-connection-card");
  const head = node("div", "exchange-connection-card-head");
  const mark = node("span", "exchange-provider-mark " + connection.provider, providerMark(connection.provider));
  const name = node("div", "exchange-connection-name");
  const bsdexWeb = connection.bsdexWeb;
  const provider = providerDefinition(bsdexWeb ? "bsdex_web" : connection.provider);
  const csv = connection.importMode === "csv";
  const tradeRepublic = connection.tradeRepublic;
  const activationPending = tradeRepublic?.status === "approval_pending";
  const activationNeeded = tradeRepublic && tradeRepublic.status !== "connected";
  name.append(node("strong", "", connection.label || window.CryptoBuchI18n.message(provider.defaultLabel) || connection.provider), node("span", "", `${window.CryptoBuchI18n.message(provider.label) || connection.provider} · ${csv ? window.CryptoBuchI18n.t("lokaler CSV-Import") : "Read-only"}`));
  const historyStatus = bsdexWeb && bsdexWeb.status !== "connected" ? window.CryptoBuchI18n.t("Web-Anmeldung erforderlich") : bsdexWeb?.lastError ? window.CryptoBuchI18n.t("Web-Import prüfen") : activationPending ? window.CryptoBuchI18n.t("App-Freigabe offen") : tradeRepublic?.status === "login_error" ? window.CryptoBuchI18n.t("Anmeldung prüfen") : connection.history?.lastError || connection.history?.status === "attention" ? window.CryptoBuchI18n.t("Historie prüfen") : connection.history?.status === "running" ? window.CryptoBuchI18n.t("Historie läuft") : connection.history?.status === "pending" ? window.CryptoBuchI18n.t("Historie bereit") : connection.lastSyncedAt ? (csv ? window.CryptoBuchI18n.t("Importiert") : window.CryptoBuchI18n.t("Synchronisiert")) : window.CryptoBuchI18n.t("Bereit");
  const status = node("span", "sync-status" + (connection.lastSyncedAt ? " is-synced" : ""), historyStatus);
  head.append(mark, name, status);
  const details = node("dl", "exchange-connection-details");
  const account = node("div");
  account.append(node("dt", "", window.CryptoBuchI18n.t("Börsenkonto")), node("dd", "", connection.accountLabel || connection.label || window.CryptoBuchI18n.t("Separates Börsenkonto")));
  const synced = node("div");
  synced.append(node("dt", "", window.CryptoBuchI18n.t("Letzter Import")), node("dd", "", connection.lastSyncedAt ? readableDateTime(connection.lastSyncedAt) : window.CryptoBuchI18n.t("Noch nicht synchronisiert")));
  details.append(account, synced);
  if (connection.provider === "etoro") {
    const environment = node("div");
    environment.append(node("dt", "", "eToro-Konto"), node("dd", "", connection.etoroEnvironment === "demo" ? window.CryptoBuchI18n.t("Demokonto") : window.CryptoBuchI18n.t("Realkonto")));
    details.append(environment);
  }
  if (connection.history) {
    const history = node("div");
    history.append(node("dt", "", window.CryptoBuchI18n.t("Historienimport")), node("dd", connection.history.lastError ? "history-error" : "", historyCopy(connection.history)));
    details.append(history);
  }
  if (connection.provider === "binance" && (connection.symbols || connection.history?.markets?.length)) {
    const markets = node("div");
    markets.append(node("dt", "", window.CryptoBuchI18n.t("Märkte")), node("dd", "", connection.symbols || connection.history.markets.join(", ")));
    details.append(markets);
  }
  if (connection.balance) {
    const balance = node("div");
    const copy = connection.balance.status === "confirmed"
      ? window.CryptoBuchI18n.t("Kontostand bestätigt{p0}", { p0: connection.balance.observedAt ? ` · ${readableDateTime(connection.balance.observedAt)}` : "" })
      : window.CryptoBuchI18n.t("Kontostand wird beim nächsten {p0}-Sync bestätigt", { p0: providerDefinition(connection.provider).defaultLabel || connection.provider });
    balance.append(node("dt", "", window.CryptoBuchI18n.t("Kontostand")), node("dd", connection.balance.status === "pending" ? "history-error" : "", copy));
    details.append(balance);
  }
  if (connection.live) {
    const live = node("div");
    const copy = !connection.live.enabled ? window.CryptoBuchI18n.t("Deaktiviert")
      : connection.live.status === "connected" ? window.CryptoBuchI18n.t("Verbunden{p0}", { p0: connection.live.lastEventAt ? window.CryptoBuchI18n.t(" · letztes Ereignis {p0}", { p0: readableDateTime(connection.live.lastEventAt) }) : "" })
        : connection.live.status === "reconnecting" ? window.CryptoBuchI18n.t("Verbindung wird wiederhergestellt")
          : connection.live.status === "error" ? window.CryptoBuchI18n.t("Prüfen: {p0}", { p0: connection.live.lastError || window.CryptoBuchI18n.t("Verbindung fehlgeschlagen") })
            : window.CryptoBuchI18n.t("Wird verbunden");
    live.append(node("dt", "", window.CryptoBuchI18n.t("Live-Updates")), node("dd", connection.live.status === "error" ? "history-error" : "", copy));
    details.append(live);
  }
  if (tradeRepublic) {
    const activation = node("div");
    const copy = tradeRepublic.status === "connected" ? window.CryptoBuchI18n.t("Web-Sitzung bestätigt{p0}", { p0: tradeRepublic.connectedAt ? ` · ${readableDateTime(tradeRepublic.connectedAt)}` : "" })
      : activationPending ? window.CryptoBuchI18n.t("App-Bestätigung steht aus")
        : tradeRepublic.lastError ? window.CryptoBuchI18n.t("Anmeldung fehlgeschlagen: {p0}", { p0: tradeRepublic.lastError }) : window.CryptoBuchI18n.t("Web-Anmeldung noch nicht gestartet");
    activation.append(node("dt", "", window.CryptoBuchI18n.t("Web-Anmeldung")), node("dd", tradeRepublic.lastError ? "history-error" : "", copy));
    details.append(activation);
  }
  if (bsdexWeb) {
    const login = node("div");
    login.append(node("dt", "", window.CryptoBuchI18n.t("Web-Sitzung")), node("dd", bsdexWeb.lastError ? "history-error" : "", bsdexWeb.lastError || (bsdexWeb.status === "connected" ? window.CryptoBuchI18n.t("Lokal verschlüsselt gespeichert") : window.CryptoBuchI18n.t("Anmeldung erforderlich"))));
    details.append(login);
  }
  const footer = node("div", "exchange-connection-card-footer");
  footer.append(node("p", "", bsdexWeb ? window.CryptoBuchI18n.t("Experimenteller Web-Import der offiziellen Jahres-CSV. Erneute Abrufe werden anhand stabiler Buchungsmerkmale abgeglichen. Der Bestand wird aus der Historie berechnet; fehlende Buchungen bleiben eine Einschränkung. Bei abgelaufener Sitzung bitte erneut anmelden.") : csv ? window.CryptoBuchI18n.t("CSV-Buchungen bleiben lokal und werden nach dem Import mit allen lokalen Wallets abgeglichen.") : activationNeeded ? window.CryptoBuchI18n.t("Vor dem ersten Import muss die inoffizielle Trade-Republic-Webanmeldung in der App bestätigt werden. Der Import ruft ausschließlich Timeline und Details ab.") : connection.provider === "coinbase_advanced" ? window.CryptoBuchI18n.t("Coinbase liest Kontostände, Spot-Trades und die normale Kontohistorie mit Käufen, Transfers und Rewards seriell. Unklare Buchungsarten bleiben sichtbar und müssen geprüft werden.") : connection.provider === "coinbase" ? window.CryptoBuchI18n.t("Coinbase Exchange wird ausschließlich mit dem API-Recht „View“ abgefragt. Konten, Ledgerbewegungen und Fills werden seriell importiert; Ein- und Auszahlungen werden danach als Transfer-Vorschläge mit lokalen Wallets verglichen.") : connection.provider === "etoro" ? window.CryptoBuchI18n.t("eToro importiert auch offene und geschlossene CFDs sowie Short-Positionen. In der Börsenansicht stehen dafür eigene Positionsnachweise mit Hebel und Ergebnis. Eindeutig bestätigte Krypto-Spot-Käufe bleiben im Coin-Journal; unklare Produktarten werden zur Prüfung separat erfasst. Alle Abrufe bleiben read-only und seriell.") : connection.provider === "bsdex" && connection.live?.enabled ? window.CryptoBuchI18n.t("BSDEX-Live-Updates laufen nur lesend lokal. Krypto-Ein- und Auszahlungen kommen im seriellen REST-Abgleich alle {p0} Minuten mit und werden danach als Transfer-Vorschläge mit lokalen Wallets verglichen.", { p0: connection.live.reconcileIntervalMinutes }) : connection.provider === "bsdex" ? window.CryptoBuchI18n.t("Abgeschlossene Krypto-Ein- und Auszahlungen werden read-only importiert und danach als Transfer-Vorschläge mit lokalen Wallets verglichen.") : connection.history?.status === "attention" ? window.CryptoBuchI18n.t("Die API kann nicht alle historischen Märkte liefern. Ergänze die genannten Märkte oder den vollständigen Binance-CSV-Export; fehlende Buchungen werden nie als Kauf oder Verkauf erfunden.") : connection.history && connection.history.status !== "complete" ? window.CryptoBuchI18n.t("Die Börsenhistorie wird automatisch in kleinen, seriellen Schritten nachgeladen. Der Transfer-Abgleich folgt nach Abschluss.") : window.CryptoBuchI18n.t("Nach dem Sync wird automatisch mit allen lokalen Wallets abgeglichen.")));
  const actions = node("div", "exchange-connection-actions");
  if (bsdexWeb) {
    const csvImport = node("button", "text-button", window.CryptoBuchI18n.t("BSDEX-CSV importieren"));
    csvImport.type = "button";
    csvImport.addEventListener("click", () => openExchangeCsvImport(connection));
    actions.append(csvImport);
  }
  const sync = node("button", "button button-secondary button-small", bsdexWeb && bsdexWeb.status !== "connected" ? window.CryptoBuchI18n.t("Bei BSDEX anmelden") : csv ? window.CryptoBuchI18n.t("CSV importieren") : activationPending ? window.CryptoBuchI18n.t("App-Bestätigung öffnen") : activationNeeded ? window.CryptoBuchI18n.t("Web-Anmeldung starten") : window.CryptoBuchI18n.t("Jetzt synchronisieren"));
  sync.type = "button";
  sync.addEventListener("click", async () => {
    if (bsdexWeb && bsdexWeb.status !== "connected") return window.BsdexWeb.open(connection, load).catch(error => toast(error.message, "error"));
    if (csv) return openExchangeCsvImport(connection);
    if (activationPending) return openTradeRepublicWebLogin(connection);
    if (activationNeeded) {
      return openTradeRepublicWebLogin(connection);
    }
    sync.disabled = true;
    sync.textContent = window.CryptoBuchI18n.t("Sync gestartet …");
    try {
      const queued = await api("/api/exchange-connections/" + connection.id + "/sync", { method: "POST" });
      toast(connection.history && connection.history.status !== "complete" ? window.CryptoBuchI18n.t("Aktuelle Daten und die Börsenhistorie werden automatisch nachgeladen.") : "Börsen-Sync als Job #" + queued.job.id + " gestartet. Der Abgleich folgt automatisch.");
      window.setTimeout(load, 800);
    } catch (error) {
      sync.disabled = false;
      sync.textContent = window.CryptoBuchI18n.t("Jetzt synchronisieren");
      toast(error.message, "error");
    }
  });
  if (bsdexWeb?.status === "connected") {
    const disconnect = node("button", "text-button", window.CryptoBuchI18n.t("Web-Sitzung löschen"));
    disconnect.type = "button";
    disconnect.addEventListener("click", async () => {
      try { await api(`/api/exchange-connections/${connection.id}/bsdex/web-login/disconnect`, { method: "POST" }); await load(); }
      catch (error) { toast(error.message, "error"); }
    });
    actions.append(disconnect);
  }
  if (connection.provider === "binance" && !csv) {
    const markets = node("button", "text-button", window.CryptoBuchI18n.t("Historische Märkte ergänzen"));
    markets.type = "button";
    markets.addEventListener("click", async () => {
      const value = prompt(window.CryptoBuchI18n.t("Historische Binance-Spot-Märkte (durch Komma getrennt). Leer lassen, um nur automatisch erkannte Märkte erneut zu prüfen."), connection.symbols || "");
      if (value === null) return;
      markets.disabled = true;
      try {
        const result = await api("/api/exchange-connections/" + connection.id + "/binance-markets", { method: "PATCH", body: JSON.stringify({ symbols: value }) });
        toast(result.job ? window.CryptoBuchI18n.t("Historische Spot-Märkte werden erneut geprüft.") : window.CryptoBuchI18n.t("Märkte gespeichert."));
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
    const liveToggle = node("button", "text-button", connection.live.enabled ? window.CryptoBuchI18n.t("Live-Updates pausieren") : window.CryptoBuchI18n.t("Live-Updates aktivieren"));
    liveToggle.type = "button";
    liveToggle.addEventListener("click", async () => {
      liveToggle.disabled = true;
      try {
        const result = await api("/api/exchange-connections/" + connection.id + "/live-updates", { method: "PATCH", body: JSON.stringify({ enabled: !connection.live.enabled }) });
        toast(result.job ? window.CryptoBuchI18n.t("Live-Updates werden nach dem aktuellen Read-only-Abgleich aktiviert.") : window.CryptoBuchI18n.t("BSDEX-Live-Updates pausiert."));
        await load();
      } catch (error) {
        toast(error.message, "error");
      } finally { liveToggle.disabled = false; }
    });
    actions.append(liveToggle);
  }
  const remove = node("button", window.CryptoBuchI18n.t("text-button exchange-remove"), window.CryptoBuchI18n.t("Verbindung entfernen"));
  remove.type = "button";
  remove.addEventListener("click", async () => {
    if (!confirm("Verbindung „" + (connection.label || connection.provider) + "“ entfernen?\n\nBereits importierte Buchungen bleiben erhalten.")) return;
    try {
      await api("/api/exchange-connections/" + connection.id, { method: "DELETE" });
      toast(window.CryptoBuchI18n.t("Börsenverbindung entfernt."));
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
  provider.replaceChildren(...state.exchange.providers.map((item) => new Option(window.CryptoBuchI18n.message(item.label), item.id)));
  provider.value = previous || state.exchange.providers[0]?.id || "";
  updateExchangeProviderForm();
  const connections = state.exchange.connections || [];
  if (!connections.length) {
    const empty = node("li", "exchange-connection-empty");
    empty.append(node("span", "", "⌁"), node("strong", "", window.CryptoBuchI18n.t("Noch keine Börse verbunden")), node("p", "", window.CryptoBuchI18n.t("Lege eine Read-only-Verbindung oder ein Börsenkonto für lokale Beleg-CSV an.")));
    el("exchange-connection-list").replaceChildren(empty);
    return;
  }
  el("exchange-connection-list").replaceChildren(...connections.map(connectionCard));
}

function render() {
  const data = state.data;
  el("missing-price-count").textContent = data.counts.missingHistoricPrices.toLocaleString(window.CryptoBuchI18n.locale);
  el("unassigned-count").textContent = data.counts.unassignedPurposes.toLocaleString(window.CryptoBuchI18n.locale);
  el("manual-price-count").textContent = data.counts.manualHistoricPrices.toLocaleString(window.CryptoBuchI18n.locale);
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
  profile.replaceChildren(...state.csvProfiles.map((item) => new Option(window.CryptoBuchI18n.message(item.label), item.id)));
  profile.value = previous || "generic";
  el("csv-profile-help").textContent = window.CryptoBuchI18n.message(state.csvProfiles.find((item) => item.id === profile.value)?.detail) || window.CryptoBuchI18n.t("CSV-Profil wählen.");
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
  el("quality-price-copy").textContent = (transaction.asset_symbol || transaction.asset) + " · " + (transaction.timestamp ? date.format(new Date(transaction.timestamp)) : window.CryptoBuchI18n.t("ohne Zeitstempel"));
  el("quality-price-input").value = "";
  el("quality-price-error").hidden = true;
  el("quality-price-modal").showModal();
}

function formatBytes(value) {
  return value < 1024 * 1024 ? Math.ceil(value / 1024) + " KB" : (value / (1024 * 1024)).toFixed(1) + " MB";
}

function renderDocuments(documents) {
  if (!documents.length) {
    el("quality-document-list").replaceChildren(Object.assign(node("li", "muted"), { textContent: window.CryptoBuchI18n.t("Noch kein lokaler Nachweis angehängt.") }));
    return;
  }
  el("quality-document-list").replaceChildren(...documents.map((entry) => {
    const item = node("li");
    const link = node("a", "", entry.originalName);
    link.href = "/api/transaction-documents/" + encodeURIComponent(entry.id) + "/download";
    link.target = "_blank";
    link.rel = "noopener";
    item.append(link, " · " + formatBytes(entry.byteSize) + " · SHA-256 " + entry.sha256.slice(0, 12) + "… · ");
    const remove = node("button", "text-button", window.CryptoBuchI18n.t("Entfernen"));
    remove.type = "button";
    remove.addEventListener("click", async () => {
      if (!confirm(window.CryptoBuchI18n.t("Nachweis „{name}“ wirklich lokal löschen?", { name: entry.originalName }))) return;
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
  el("quality-document-copy").textContent = (transaction.asset_symbol || transaction.asset) + " · " + (transaction.timestamp ? date.format(new Date(transaction.timestamp)) : window.CryptoBuchI18n.t("ohne Zeitstempel"));
  el("quality-document-form").reset();
  el("quality-document-error").hidden = true;
  el("quality-document-modal").showModal();
  try { await loadDocuments(); } catch (error) { toast(error.message, "error"); }
}

async function savePrice(auto = false) {
  try {
    const result = await api("/api/transactions/" + state.transaction.id + "/historical-price", { method: "PATCH", body: JSON.stringify({ priceTransactionEur: auto ? null : el("quality-price-input").value }) });
    el("quality-price-modal").close();
    toast(result.price_source === "manual" ? window.CryptoBuchI18n.t("Kurs gespeichert.") : result.priceJob ? window.CryptoBuchI18n.t("Automatik aktiviert. Kursabruf #{p0} eingeplant.", { p0: result.priceJob.id }) : result.priceHint || window.CryptoBuchI18n.t("Automatik aktiviert."));
    await load();
  } catch (error) {
    el("quality-price-error").textContent = window.CryptoBuchI18n.message(error.message);
    el("quality-price-error").hidden = false;
  }
}

async function assignPurpose(transaction) {
  const purpose = prompt(window.CryptoBuchI18n.t("Zweck für diese Transaktion:"), transaction.purpose || "Kauf");
  if (purpose === null) return;
  try {
    await api("/api/transactions/" + transaction.id, { method: "PATCH", body: JSON.stringify({ purpose: purpose.trim() }) });
    toast(window.CryptoBuchI18n.t("Zweck gespeichert."));
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
  el("csv-profile-help").textContent = window.CryptoBuchI18n.message(state.csvProfiles.find((item) => item.id === el("csv-profile").value)?.detail) || window.CryptoBuchI18n.t("CSV-Profil wählen.");
  importTargetOptions();
});
el("exchange-provider").addEventListener("change", updateExchangeProviderForm);
el("csv-import-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  try {
    const file = el("csv-file").files[0];
    if (!file) throw new Error(window.CryptoBuchI18n.t("Bitte zuerst eine CSV-Datei auswählen."));
    const [targetKind, targetId] = String(el("csv-target").value || "").split(":");
    if (!targetId) throw new Error(window.CryptoBuchI18n.t("Bitte eine Zielquelle auswählen."));
    const result = await api("/api/import/csv", { method: "POST", body: JSON.stringify({
      ...(targetKind === "exchange" ? { exchangeConnectionId: targetId } : { walletId: targetId }),
      profile: el("csv-profile").value, csv: await file.text(),
    }) });
    toast(result.imported.toLocaleString(window.CryptoBuchI18n.locale) + " CSV-Transaktionen importiert.");
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
    submit.textContent = window.CryptoBuchI18n.t("Verbindung wird eingerichtet …");
    const result = await api("/api/exchange-connections", { method: "POST", body: JSON.stringify({
      provider: el("exchange-provider").value, label: el("exchange-label").value,
      apiKey: el("exchange-api-key").value, apiSecret: providerId === "coinbase_advanced" ? el("exchange-advanced-secret").value : el("exchange-api-secret").value, coinbasePassphrase: el("exchange-coinbase-passphrase").value, symbols: el("exchange-symbols").value,
      etoroEnvironment: el("exchange-etoro-environment").value,
      tradeRepublicConsent: el("exchange-trade-republic-consent").checked,
      bsdexWebConsent: el("exchange-bsdex-web-consent").checked,
      liveUpdatesEnabled: el("exchange-live-updates").checked,
    }) });
    form.reset();
    if (result.bsdexWeb) {
      await window.BsdexWeb.open(result, load);
    } else if (result.tradeRepublic?.status === "approval_pending") {
      toast(window.CryptoBuchI18n.t("Trade-Republic-Webanmeldung gestartet. Bitte in der App bestätigen."));
      openTradeRepublicWebLogin(result);
    } else if (result.tradeRepublic?.status === "login_error") {
      toast(result.tradeRepublic.lastError || window.CryptoBuchI18n.t("Die Trade-Republic-Webanmeldung konnte nicht gestartet werden."), "error");
    } else toast(result.job ? window.CryptoBuchI18n.t("Read-only-Börsenverbindung gespeichert; aktuelle Daten und verfügbare Historie werden automatisch importiert.") : window.CryptoBuchI18n.t("Börsenkonto für lokale CSV-Belege gespeichert."));
    await load();
  } catch (error) { toast(error.message, "error"); }
  finally {
    submit.disabled = false;
    const provider = providerDefinition(providerId);
    submit.textContent = provider.requiresWebLogin ? window.CryptoBuchI18n.t("Web-Anmeldung starten") : provider.importMode === "api" ? window.CryptoBuchI18n.t("Börse speichern & abgleichen") : window.CryptoBuchI18n.t("Börsenkonto anlegen");
  }
});
el("trade-republic-web-login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const errorNode = el("trade-republic-web-login-error");
  const submit = event.currentTarget.querySelector('button[type="submit"]');
  try {
    if (!Number.isSafeInteger(state.tradeRepublicWebLoginConnectionId)) throw new Error(window.CryptoBuchI18n.t("Die Trade-Republic-Verbindung fehlt."));
    submit.disabled = true;
    submit.textContent = window.CryptoBuchI18n.t("Anmeldung wird gestartet …");
    const result = await api("/api/exchange-connections/" + state.tradeRepublicWebLoginConnectionId + "/trade-republic/web-login/start", {
      method: "POST", body: JSON.stringify({ pin: el("trade-republic-web-login-pin").value }),
    });
    if (result.tradeRepublic?.status !== "approval_pending") throw new Error(window.CryptoBuchI18n.message(result.tradeRepublic?.lastError) || window.CryptoBuchI18n.t("Die Trade-Republic-Webanmeldung konnte nicht gestartet werden."));
    openTradeRepublicWebLogin(result);
  } catch (error) {
    errorNode.textContent = window.CryptoBuchI18n.message(error.message);
    errorNode.hidden = false;
  } finally {
    submit.disabled = false;
    if (!state.tradeRepublicWebLoginTimer) submit.textContent = window.CryptoBuchI18n.t("App-Bestätigung anfordern");
  }
});
el("quality-document-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const file = el("quality-document-file").files[0];
  const errorNode = el("quality-document-error");
  try {
    if (!state.transaction || !file) throw new Error(window.CryptoBuchI18n.t("Bitte zuerst einen Nachweis auswählen."));
    if (file.size > 5 * 1024 * 1024) throw new Error(window.CryptoBuchI18n.t("Ein Nachweis darf maximal 5 MB groß sein."));
    const response = await fetch("/api/transactions/" + state.transaction.id + "/documents", { method: "POST", headers: { "Content-Type": file.type || "application/octet-stream", "X-Document-Name": encodeURIComponent(file.name) }, body: file });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || window.CryptoBuchI18n.t("Nachweis konnte nicht gespeichert werden."));
    form.reset();
    await loadDocuments();
    toast(window.CryptoBuchI18n.t("Nachweis lokal gespeichert."));
  } catch (error) { errorNode.textContent = window.CryptoBuchI18n.message(error.message); errorNode.hidden = false; }
});
el("reload-quality").addEventListener("click", load);
el("close-quality-price").addEventListener("click", () => el("quality-price-modal").close());
el("close-trade-republic-web-login").addEventListener("click", () => { clearTradeRepublicWebLoginPoll(); el("trade-republic-web-login-modal").close(); });
el("close-quality-document").addEventListener("click", () => el("quality-document-modal").close());
el("quality-price-form").addEventListener("submit", (event) => { event.preventDefault(); savePrice(); });
el("quality-price-auto").addEventListener("click", () => savePrice(true));
load();
