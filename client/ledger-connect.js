import TransportWebHID from "@ledgerhq/hw-transport-webhid";
import TransportWebUSB from "@ledgerhq/hw-transport-webusb";
import Btc from "@ledgerhq/hw-app-btc";
import { Buffer } from "buffer";

async function openTransport(preferred = "hid") {
  const attempts = preferred === "usb"
    ? [TransportWebUSB, TransportWebHID]
    : [TransportWebHID, TransportWebUSB];
  let lastError;
  for (const Transport of attempts) {
    try { return await Transport.create(); } catch (error) { lastError = error; }
  }
  throw lastError || new Error("Ledger konnte nicht verbunden werden.");
}

function bip32Path(path) {
  const components = String(path).split("/");
  if (components.shift() !== "m" || !components.length) throw new Error("Ungültiger Ledger-Kontopfad.");
  return components.map((component) => {
    const hardened = component.endsWith("'");
    const value = Number(component.replace(/'$/, ""));
    if (!Number.isSafeInteger(value) || value < 0 || value >= 0x80000000) throw new Error("Ungültiger Ledger-Kontopfad.");
    return hardened ? value + 0x80000000 : value;
  });
}

async function readEthereumAddress(device, path) {
  const components = bip32Path(path);
  const payload = Buffer.alloc(1 + components.length * 4);
  payload[0] = components.length;
  components.forEach((value, index) => payload.writeUInt32BE(value, 1 + index * 4));
  // Ethereum-App APDU: GET_PUBLIC_KEY, mit Anzeige der Adresse auf dem Gerät.
  const response = await device.send(0xe0, 0x02, 0x01, 0x00, payload);
  const publicKeyLength = response[0];
  const addressLength = response[1 + publicKeyLength];
  const address = response
    .slice(2 + publicKeyLength, 2 + publicKeyLength + addressLength)
    .toString("ascii");
  if (!/^0x[a-fA-F0-9]{40}$/.test(address)) throw new Error("Ledger lieferte keine gültige Ethereum-Adresse.");
  return address;
}

const BITCOIN_XPUB_VERSIONS = {
  legacy: 0x0488b21e,
  p2sh: 0x049d7cb2,
  bech32: 0x04b24746,
};

function bitcoinFormatDetails(bitcoinFormat) {
  const purpose = bitcoinFormat === "legacy" ? 44 : bitcoinFormat === "p2sh" ? 49 : 84;
  const addressType = bitcoinFormat === "legacy" ? "p2pkh" : bitcoinFormat === "p2sh" ? "p2sh-p2wpkh" : "p2wpkh";
  const deviceFormat = bitcoinFormat === "legacy" ? "legacy" : bitcoinFormat === "p2sh" ? "p2sh" : "bech32";
  return { purpose, addressType, deviceFormat };
}

function friendlyLedgerError(error) {
  const message = String(error?.message || error || "");
  if (/denied|rejected|cancel/i.test(message)) return "Die Bestätigung wurde auf dem Ledger abgebrochen.";
  if (/locked|0x6982|security status/i.test(message)) return "Ledger ist gesperrt. Entsperre das Gerät und öffne die passende App.";
  if (/0x6d00|instruction not supported|app/i.test(message)) return "Die passende Ledger-App ist nicht geöffnet oder nicht aktuell.";
  if (/busy|exchange/i.test(message)) return "Ledger ist gerade belegt. Schließe Ledger Live oder versuche es erneut.";
  return message || "Ledger konnte nicht verbunden werden.";
}

export async function readPublicAccount({ chain, accountIndex = 0, bitcoinFormat = "bech32", transport = "hid", bitcoinSource = "address" }) {
  const index = Number(accountIndex);
  if (!Number.isSafeInteger(index) || index < 0 || index > 99) throw new Error("Der Kontoindex muss zwischen 0 und 99 liegen.");
  const device = await openTransport(transport);
  try {
    if (chain === "BTC") {
      const { purpose, addressType, deviceFormat } = bitcoinFormatDetails(bitcoinFormat);
      // Die Bibliothek wählt je nach Ledger-Bitcoin-App die alte oder die neue APDU-Schnittstelle.
      const app = new Btc({ transport: device });
      if (bitcoinSource === "xpub") {
        const derivationPath = `${purpose}'/0'/${index}'`;
        const xpub = await app.getWalletXpub({ derivationPath, path: derivationPath, xpubVersion: BITCOIN_XPUB_VERSIONS[bitcoinFormat] || BITCOIN_XPUB_VERSIONS.bech32 });
        if (!xpub || !/^(?:xpub|ypub|zpub)/i.test(xpub)) throw new Error("Ledger lieferte keinen Bitcoin-xPub.");
        return { chain: "BTC", address: xpub, derivationPath, sourceType: "xpub", xpubAddressType: addressType };
      }
      const result = await app.getWalletPublicKey(`${purpose}'/0'/${index}'/0/0`, {
        format: deviceFormat,
        verify: true,
      });
      if (!result.bitcoinAddress) throw new Error("Ledger lieferte keine Bitcoin-Adresse.");
      return { chain: "BTC", address: result.bitcoinAddress, derivationPath: `${purpose}'/0'/${index}'/0/0` };
    }
    if (["ETH", "BNB", "AVAX"].includes(chain)) {
      const path = `44'/60'/${index}'/0/0`;
      const address = await readEthereumAddress(device, path);
      return { chain: "ETH", address, derivationPath: path };
    }
    throw new Error("Diese Ledger-App wird in der ersten Version noch nicht unterstützt.");
  } catch (error) {
    throw new Error(friendlyLedgerError(error));
  } finally {
    await device.close().catch(() => {});
  }
}

window.CryptoBuchLedger = { readPublicAccount };
