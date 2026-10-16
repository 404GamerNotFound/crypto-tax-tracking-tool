"use strict";

const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const https = require("node:https");
const { httpsEnabled, tlsPaths } = require("../lib/local-https");

function checkHealth({ env = process.env } = {}) {
  const secure = httpsEnabled(env);
  const dataDir = env.DATA_DIR || path.join(__dirname, "..", "data");
  const options = { hostname: "127.0.0.1", port: Number(env.PORT || 3000), path: "/healthz", timeout: 4000,
    ...(secure ? { ca: fs.readFileSync(tlsPaths(dataDir).certificate) } : {}) };
  return new Promise((resolve, reject) => {
    const request = (secure ? https : http).get(options, response => {
      response.resume();
      response.on("end", () => response.statusCode === 200 ? resolve() : reject(new Error("Healthcheck fehlgeschlagen.")));
      response.on("error", reject);
    });
    request.on("timeout", () => request.destroy(new Error("Healthcheck-Zeitlimit überschritten.")));
    request.on("error", reject);
  });
}

if (require.main === module) {
  Promise.resolve().then(() => checkHealth()).catch(() => { console.error("CryptoBuch-Healthcheck fehlgeschlagen."); process.exitCode = 1; });
}
module.exports = { checkHealth };
