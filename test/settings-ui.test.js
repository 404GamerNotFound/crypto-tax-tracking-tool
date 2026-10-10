const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const publicDir = path.join(__dirname, "..", "public");
const settingsSource = fs.readFileSync(path.join(publicDir, "settings.js"), "utf8");
const profile = {
  label: "Testprofil", countryCode: "DE", incomeTaxRatePercent: 30, disposalTaxRatePercent: 25,
  costBasisMethod: "FIFO", holdingPeriodDays: 365, exemptionThresholdEur: 1000,
  disposalTaxEnabled: true, holdingPeriodEnabled: true, exemptionThresholdEnabled: true,
  lossOffsetEnabled: true, incomeTaxEnabled: true, incomePurposes: ["Staking Rewards"], ruleNote: "Test",
};

for (const page of ["settings-sync.html", "settings-tax.html", "settings-prices.html", "settings-networks.html"]) {
  test(`${page}: lädt und speichert ausschließlich den eigenen Bereich`, async () => {
    const html = fs.readFileSync(path.join(publicDir, page), "utf8");
    const elements = new Map();
    for (const [tag] of html.matchAll(/<[^>]+\bid="[^"]+"[^>]*>/g)) {
      const id = tag.match(/\bid="([^"]+)"/)[1];
      elements.set(id, {
        formControl: /^<(?:input|textarea|select)\b/.test(tag),
        name: tag.match(/\bname="([^"]+)"/)?.[1], type: tag.match(/\btype="([^"]+)"/)?.[1],
        value: "", checked: false, hidden: true,
        addEventListener(event, listener) { this[event] = listener; },
      });
    }
    const controls = [...elements.values()].filter(field => field.formControl);
    const form = elements.get("settings-form");
    form.querySelectorAll = selector => controls.filter(field => {
      if (selector.includes('type="password"')) return field.type === "password";
      return field.type === "checkbox" && field.name && (!selector.includes('name^="clear"') || field.name.startsWith("clear"));
    });
    class FormData {
      *[Symbol.iterator]() {
        for (const field of controls) {
          if (field.name && (field.type !== "checkbox" || field.checked)) {
            yield [field.name, field.type === "checkbox" ? "on" : field.value];
          }
        }
      }
    }
    const settings = {
      ...Object.fromEntries(controls.filter(field => field.name && !["password", "checkbox"].includes(field.type)).map(field => [field.name, field.type === "number" ? 15 : "https://example.com"])),
      taxProfile: profile, bulkPurposeLimit: 250, maxTransactionsPerSync: 0,
    };
    const requests = [];
    const messages = [];
    const context = vm.createContext({
      FormData,
      window: { CryptoBuchUI: {
        el: id => elements.get(id) || null,
        toast: text => messages.push(text),
        api: async (url, options) => {
          assert.equal(url, "/api/settings");
          if (options) requests.push(JSON.parse(options.body));
          return settings;
        },
      } },
    });
    vm.runInContext(settingsSource, context);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(elements.get("settings-error").hidden, true, "Teilformular lädt ohne fehlende DOM-Felder");
    if (page === "settings-tax.html") {
      elements.get("tax-income-rate").value = "19.5";
      elements.get("tax-holding-enabled").checked = false;
    }
    const event = { currentTarget: form, preventDefault() {} };
    const saving = form.submit(event);
    // The browser clears currentTarget as soon as event dispatch returns.
    event.currentTarget = null;
    await saving;
    assert.equal(requests.length, 1);
    const sent = requests[0];
    const expectedKeys = page === "settings-tax.html" ? ["personalTaxRatePercent", "taxProfile"] : controls.filter(field => field.name).map(field => field.name);
    assert.deepEqual(Object.keys(sent).sort(), expectedKeys.sort());
    assert.equal(elements.get("settings-error").hidden, true);
    assert.equal(elements.get("save-settings").disabled, false);
    assert.match(messages[0], /gespeichert/);
    if (page === "settings-tax.html") {
      assert.equal(sent.personalTaxRatePercent, "19.5");
      assert.equal(sent.taxProfile.incomeTaxRatePercent, "19.5");
      assert.equal(sent.taxProfile.holdingPeriodEnabled, false);
      assert.deepEqual(sent.taxProfile.incomePurposes, ["Staking Rewards"]);
    }
    for (const field of controls.filter(field => field.type === "checkbox" && field.name)) assert.equal(sent[field.name], false);
  });
}
