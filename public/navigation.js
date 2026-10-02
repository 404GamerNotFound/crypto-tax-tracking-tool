(() => {
  "use strict";

  // The complete navigation lives here rather than being copied into every
  // page. Detail pages deliberately map back to their parent section so the
  // active state stays meaningful while browsing a coin, an exchange, or a
  // data-quality subpage.
  const entries = Object.freeze([
    { href: "/", label: "Dashboard" },
    { href: "/wallets.html", label: "Crypto-Bestände" },
    { href: "/quality.html", label: "Datenqualität" },
    { href: "/tax.html", label: "Steuerzentrum" },
    { href: "/maintenance.html", label: "Betrieb" },
    { href: "/settings.html", label: "Einstellungen" },
    { href: "/api-docs.html", label: "API" },
  ]);

  const parentPage = Object.freeze({
    "/index.html": "/",
    "/asset.html": "/wallets.html",
    "/exchange.html": "/wallets.html",
    "/price-fetches.html": "/quality.html",
    "/tax-print.html": "/tax.html",
  });

  // Local navigation is intentionally kept beside the primary navigation.
  // This gives large work areas a stable structure without turning the
  // application-wide header into a multi-level menu.
  const sectionEntries = Object.freeze({
    wallets: Object.freeze([
      { href: "#wallets", label: "Wallets" },
      { href: "#boersen", label: "Börsenkonten" },
      { href: "/#coins", label: "Coins & Auswertung" },
    ]),
    quality: Object.freeze([
      { href: "#qualitaetsueberblick", label: "Überblick" },
      { href: "/price-fetches.html", label: "Kursdaten" },
      { href: "#transfers", label: "Transfers" },
      { href: "#pruefungen", label: "Prüfungen" },
      { href: "#importe", label: "Importe & Börsen" },
    ]),
    tax: Object.freeze([
      { href: "#profit-total", label: "Übersicht" },
      { href: "#sale-simulator", label: "Planung" },
      { href: "#sales-title", label: "Verkäufe" },
      { href: "#income-type-filter", label: "Erträge" },
      { href: "#snapshot-list", label: "Archiv & Exporte" },
    ]),
    maintenance: Object.freeze([
      { href: "#betriebsstatus", label: "Status & Backups" },
      { href: "#automatische-laeufe", label: "Automatische Läufe" },
      { href: "#daten-reset", label: "Daten zurücksetzen" },
    ]),
    settings: Object.freeze([
      { href: "#synchronisierung", label: "Synchronisierung" },
      { href: "#steuerprofil", label: "Steuerprofil" },
      { href: "#preisdaten", label: "Preis- & API-Daten" },
      { href: "#netzwerke", label: "Netzwerke" },
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
        link.setAttribute("aria-current", "location");
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
