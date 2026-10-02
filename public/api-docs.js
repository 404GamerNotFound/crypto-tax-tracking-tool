(() => {
  "use strict";
  const list = document.querySelector("#api-endpoints");
  const status = document.querySelector("#api-status");
  const search = document.querySelector("#api-search");
  const method = document.querySelector("#api-method");
  const retry = document.querySelector("#api-retry");
  let entries = [];
  const element = (tag, text, className) => {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (className) node.className = className;
    return node;
  };
  const codeBlock = (value) => {
    const pre = element("pre");
    pre.append(element("code", JSON.stringify(value, null, 2)));
    return pre;
  };
  function table(headers, rows) {
    const wrapper = element("div", undefined, "table-wrap");
    const table = element("table");
    const head = element("thead");
    const headRow = element("tr");
    headers.forEach((header) => headRow.append(element("th", header)));
    head.append(headRow);
    const body = element("tbody");
    for (const cells of rows) {
      const row = element("tr");
      cells.forEach((cell) => row.append(element("td", cell)));
      body.append(row);
    }
    table.append(head, body);
    wrapper.append(table);
    return wrapper;
  }
  function render() {
    const text = search.value.trim().toLocaleLowerCase("de");
    const filtered = entries.filter((entry) => (!method.value || entry.method === method.value) && `${entry.path} ${entry.operation.summary} ${entry.operation.description} ${entry.operation.tags.join(" ")}`.toLocaleLowerCase("de").includes(text));
    list.replaceChildren();
    status.textContent = `${filtered.length} von ${entries.length} Endpunkten`;
    for (const entry of filtered) {
      const { path, method, operation } = entry;
      const details = element("details", undefined, "api-endpoint");
      const summary = element("summary");
      summary.append(element("span", method, `api-method${method !== "GET" ? " api-method-write" : ""}`), element("code", path), element("span", operation.summary, "api-endpoint-title"));
      const body = element("div", undefined, "api-endpoint-body");
      body.append(element("p", operation.description));
      if (operation.deprecated) body.append(element("p", "Bestandsroute – Hinweise zur Integration beachten.", "api-legacy"));
      if (operation.parameters.length) {
        body.append(element("h3", "Parameter"), table(["Name", "Ort", "Pflicht", "Typ / Vorgaben"], operation.parameters.map((parameter) => [parameter.name, parameter.in, parameter.required ? "Ja" : "Nein", JSON.stringify(parameter.schema)])));
      }
      if (operation.requestBody) {
        body.append(element("h3", `Request-Body${operation.requestBody.required ? " (erforderlich)" : " (optional)"}`), codeBlock(operation.requestBody.content));
      }
      body.append(element("h3", "Antworten"));
      for (const [code, response] of Object.entries(operation.responses)) {
        const responseDetails = element("details");
        responseDetails.append(element("summary", `${code} · ${response.description}`));
        if (response.content) responseDetails.append(codeBlock(response.content));
        body.append(responseDetails);
      }
      if (operation["x-dependencies"]?.length) body.append(element("h3", "Benötigte / verknüpfte Daten"), element("p", operation["x-dependencies"].join(" · "), "api-dependencies"));
      details.append(summary, body);
      list.append(details);
    }
  }
  async function load() {
    status.textContent = "API-Vertrag wird geladen …";
    retry.hidden = true;
    try {
      const response = await fetch("/api/openapi.json");
      if (!response.ok) throw new Error("API-Vertrag konnte nicht geladen werden.");
      const contract = await response.json();
      entries = Object.entries(contract.paths).flatMap(([path, operations]) => Object.entries(operations).map(([method, operation]) => ({ path, method: method.toUpperCase(), operation })));
      const relations = document.querySelector("#api-relations");
      relations.replaceChildren();
      for (const relation of contract["x-relationships"]) {
        const row = element("tr");
        [relation.from, relation.field, `${relation.to}.${relation.targetField}`].forEach((cell) => row.append(element("td", cell)));
        relations.append(row);
      }
      const models = document.querySelector("#api-models");
      models.replaceChildren();
      for (const [name, schema] of Object.entries(contract.components.schemas)) {
        const details = element("details", undefined, "api-model");
        details.append(element("summary", name), codeBlock(schema));
        models.append(details);
      }
      render();
    } catch (error) {
      status.textContent = error.message || "API-Dokumentation konnte nicht geladen werden.";
      retry.hidden = false;
    }
  }
  search.addEventListener("input", render);
  method.addEventListener("change", render);
  retry.addEventListener("click", load);
  load();
})();
