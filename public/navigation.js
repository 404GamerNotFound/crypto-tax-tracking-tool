(() => {
  "use strict";

  // The complete navigation lives here rather than being copied into every
  // page. Detail pages deliberately map back to their parent section so the
  // active state stays meaningful while browsing a coin, an exchange, or a
  // data-quality subpage.
  const entries = Object.freeze([
    { href: "/", label: window.CryptoBuchI18n.t("Dashboard") },
    { href: "/wallets.html", label: window.CryptoBuchI18n.t("Crypto-Bestände") },
    { href: "/quality.html", label: window.CryptoBuchI18n.t("Datenqualität") },
    { href: "/tax.html", label: window.CryptoBuchI18n.t("Steuerzentrum") },
    { href: "/maintenance.html", label: window.CryptoBuchI18n.t("Betrieb") },
    { href: "/settings.html", label: window.CryptoBuchI18n.t("Einstellungen") },
    { href: "/api-docs.html", label: window.CryptoBuchI18n.t("API") },
  ]);

  const parentPage = Object.freeze({
    "/index.html": "/",
    "/asset.html": "/wallets.html",
    "/exchange.html": "/wallets.html",
    "/price-fetches.html": "/quality.html",
    "/tax-print.html": "/tax.html",
    "/settings-sync.html": "/settings.html",
    "/settings-tax.html": "/settings.html",
    "/settings-prices.html": "/settings.html",
    "/settings-networks.html": "/settings.html",
  });

  // Local navigation is intentionally kept beside the primary navigation.
  // This gives large work areas a stable structure without turning the
  // application-wide header into a multi-level menu.
  const sectionEntries = Object.freeze({
    wallets: Object.freeze([
      { href: "#wallets", label: window.CryptoBuchI18n.t("Wallets") },
      { href: "#boersen", label: window.CryptoBuchI18n.t("Börsenkonten") },
      { href: "/#coins", label: window.CryptoBuchI18n.t("Coins & Auswertung") },
    ]),
    quality: Object.freeze([
      { href: "#qualitaetsueberblick", label: window.CryptoBuchI18n.t("Überblick") },
      { href: "/price-fetches.html", label: window.CryptoBuchI18n.t("Kursdaten") },
      { href: "#transfers", label: window.CryptoBuchI18n.t("Transfers") },
      { href: "#pruefungen", label: window.CryptoBuchI18n.t("Prüfungen") },
      { href: "#importe", label: window.CryptoBuchI18n.t("Importe & Börsen") },
    ]),
    tax: Object.freeze([
      { href: "#profit-total", label: window.CryptoBuchI18n.t("Übersicht") },
      { href: "#sale-simulator", label: window.CryptoBuchI18n.t("Planung") },
      { href: "#sales-title", label: window.CryptoBuchI18n.t("Verkäufe") },
      { href: "#income-type-filter", label: window.CryptoBuchI18n.t("Erträge") },
      { href: "#snapshot-list", label: window.CryptoBuchI18n.t("Archiv & Exporte") },
    ]),
    maintenance: Object.freeze([
      { href: "#betriebsstatus", label: window.CryptoBuchI18n.t("Status & Backups") },
      { href: "#updates", label: window.CryptoBuchI18n.t("Docker-Updates") },
      { href: "#automatische-laeufe", label: window.CryptoBuchI18n.t("Automatische Läufe") },
      { href: "#daten-reset", label: window.CryptoBuchI18n.t("Daten zurücksetzen") },
    ]),
    settings: Object.freeze([
      { href: "/settings.html", label: window.CryptoBuchI18n.t("Passwortschutz") },
      { href: "/settings-sync.html", label: window.CryptoBuchI18n.t("Synchronisierung") },
      { href: "/settings-tax.html", label: window.CryptoBuchI18n.t("Steuerprofil") },
      { href: "/settings-prices.html", label: window.CryptoBuchI18n.t("Preis- & API-Daten") },
      { href: "/settings-networks.html", label: window.CryptoBuchI18n.t("Netzwerke") },
    ]),
  });

  function currentSection(pathname = window.location.pathname) {
    return parentPage[pathname] || pathname || "/";
  }

  function renderNavigation(navigation) {
    const activeHref = currentSection();
    navigation.replaceChildren();
    for (const entry of entries) {
      const link = document.createElement("a");
      link.className = "topbar-link";
      link.href = entry.href;
      link.textContent = entry.label;
      if (entry.href === activeHref) {
        link.classList.add("is-active");
        link.setAttribute("aria-current", "page");
      }
      navigation.append(link);
    }
  }

  function renderSectionNavigation(navigation) {
    const entriesForPage = sectionEntries[navigation.dataset.sectionNavigation] || [];
    const activeHref = entriesForPage.some((entry) => entry.href === window.location.pathname)
      ? window.location.pathname
      : entriesForPage.some((entry) => entry.href === window.location.hash)
        ? window.location.hash
        : entriesForPage.find((entry) => entry.href.startsWith("#"))?.href;
    navigation.replaceChildren();
    for (const entry of entriesForPage) {
      const link = document.createElement("a");
      link.className = "section-subnav-link";
      link.href = entry.href;
      link.textContent = entry.label;
      if (entry.href === activeHref) {
        link.classList.add("is-active");
        link.setAttribute("aria-current", entry.href.startsWith("#") ? "location" : "page");
      }
      navigation.append(link);
    }
  }

  function mountNavigation() {
    document.querySelectorAll("[data-primary-navigation]").forEach(renderNavigation);
    document.querySelectorAll("[data-section-navigation]").forEach(renderSectionNavigation);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mountNavigation, { once: true });
  else mountNavigation();
  window.addEventListener("hashchange", mountNavigation);
})();

// Sessions use an HttpOnly cookie; no credentials are kept in browser storage.
fetch("/api/auth/status", { cache: "no-store" }).then(response => response.json()).then(status => {
  if (!status.enabled) return;
  const navigation = document.querySelector("[data-primary-navigation]");
  if (!navigation) return;
  const button = document.createElement("button");
  button.className = "button button-secondary"; button.textContent = window.CryptoBuchI18n.t("Abmelden");
  button.addEventListener("click", async () => {
    button.disabled = true;
    try {
      const response = await fetch("/api/auth/logout", { method: "POST", headers: { "X-CryptoBuch-Request": "1" } });
      if (!response.ok) throw new Error();
      location.replace("/login.html");
    } catch { button.disabled = false; button.textContent = window.CryptoBuchI18n.t("Abmelden erneut versuchen"); }
  });
  navigation.append(button);
}).catch(() => {});
window.addEventListener("pageshow", event => { if (event.persisted) location.reload(); });
