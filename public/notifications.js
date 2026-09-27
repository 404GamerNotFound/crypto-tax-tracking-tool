(() => {
  const topbar = document.querySelector(".topbar");
  if (!topbar) return;
  const menu = document.createElement("div");
  menu.className = "notification-menu";
  menu.innerHTML = `<button class="notification-bell" type="button" aria-label="Benachrichtigungen öffnen" aria-expanded="false" aria-controls="notification-popover"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/><path d="M10 21h4"/></svg><i hidden>0</i></button><section class="notification-popover" id="notification-popover" aria-label="Benachrichtigungen" hidden><div class="notification-popover-head"><div><p class="eyebrow">HINWEISE</p><strong>Benachrichtigungen</strong></div><button class="text-button" type="button" data-mark-read>Alle gelesen</button></div><div class="notification-popover-list"></div><p class="data-note" data-empty hidden>Keine offenen Hinweise.</p></section>`;
  const bell = menu.querySelector(".notification-bell");
  const badge = menu.querySelector("i");
  const popover = menu.querySelector(".notification-popover");
  const list = menu.querySelector(".notification-popover-list");
  const empty = menu.querySelector("[data-empty]");
  topbar.insertBefore(menu, topbar.querySelector(".topbar-status") || null);

  async function request(url, options = {}) {
    const response = await fetch(url, { headers: { "Content-Type": "application/json", ...(options.headers || {}) }, ...options });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "Benachrichtigungen konnten nicht geladen werden.");
    return payload;
  }
  function positionPopover() {
    const rect = bell.getBoundingClientRect();
    popover.style.setProperty("--notification-popover-top", `${Math.min(window.innerHeight - 16, rect.bottom + 10)}px`);
  }
  function close() { popover.hidden = true; bell.setAttribute("aria-expanded", "false"); }
  function render(items) {
    list.replaceChildren();
    const unread = items.filter((item) => !item.is_read).length;
    badge.textContent = unread > 99 ? "99+" : String(unread);
    badge.hidden = unread === 0;
    bell.classList.toggle("has-unread", unread > 0);
    for (const item of items.slice(0, 10)) {
      const row = document.createElement("article");
      row.className = `notification-item ${item.level}${item.is_read ? " is-read" : ""}`;
      const title = document.createElement("strong"); title.textContent = item.title;
      const message = document.createElement("p"); message.textContent = item.message;
      row.append(title, message); list.append(row);
    }
    empty.hidden = items.length > 0;
  }
  async function load() { try { const data = await request("/api/notifications"); render(data.notifications || []); } catch (_) { /* Die Seite funktioniert auch ohne Benachrichtigungsdienst. */ } }
  bell.addEventListener("click", () => { const open = popover.hidden; positionPopover(); popover.hidden = !open; bell.setAttribute("aria-expanded", String(open)); if (open) load(); });
  menu.querySelector("[data-mark-read]").addEventListener("click", async () => { await request("/api/notifications/read", { method: "PATCH", body: JSON.stringify({}) }); await load(); });
  document.addEventListener("click", (event) => { if (!menu.contains(event.target)) close(); });
  document.addEventListener("keydown", (event) => { if (event.key === "Escape") { close(); bell.focus(); } });
  window.addEventListener("resize", () => { if (!popover.hidden) positionPopover(); });
  load();
  window.setInterval(load, 90000);
})();
