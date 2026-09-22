import { Buffer } from "buffer";

// Einige Hardware-Wallet-Bibliotheken erwarten die Node-Globals auch im Browser.
globalThis.Buffer ||= Buffer;
globalThis.global ||= globalThis;
