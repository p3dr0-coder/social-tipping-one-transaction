// `Uint8Array.prototype.toBase64/toHex` and the static `fromBase64/fromHex` are in the
// current lib but TS 5.8 ships without them, so declare the surface this module uses.
declare global {
  interface Uint8Array {
    toBase64(options?: { alphabet?: "base64" | "base64url"; omitPadding?: boolean }): string;
    toHex(): string;
  }
  interface Uint8ArrayConstructor {
    fromBase64(
      value: string,
      options?: { alphabet?: "base64" | "base64url"; lastChunkHandling?: "loose" | "strict" | "stop-before-partial" },
    ): Uint8Array;
    fromHex(value: string): Uint8Array;
  }
}

/**
 * Native byte codecs. `Uint8Array.prototype.toBase64`/`toHex` and the static
 * `fromBase64`/`fromHex` are Baseline (Chrome 140+, Firefox 133+, Safari 18.2+) and ship in
 * Node.js 25+; the project engines floor is Node 22.22.2, so every helper feature-detects
 * and falls back to `atob`/manual hex.
 */

function hexByte(value: number): string {
  return value.toString(16).padStart(2, "0");
}

/** Strict base64 → bytes. Throws on invalid input, like `Uint8Array.fromBase64`. */
export function decodeBase64(value: string): Uint8Array {
  if (typeof Uint8Array.fromBase64 === "function") return Uint8Array.fromBase64(value);
  let binary: string;
  try {
    binary = atob(value);
  } catch {
    throw new SyntaxError("the value is not valid base64");
  }
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

/** bytes → base64. */
export function encodeBase64(bytes: Uint8Array): string {
  if (typeof bytes.toBase64 === "function") return bytes.toBase64();
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** Strict lowercase hex → bytes. Throws on odd length or bad characters. */
export function decodeHex(value: string): Uint8Array {
  if (typeof Uint8Array.fromHex === "function") return Uint8Array.fromHex(value);
  if (value.length % 2 !== 0) throw new SyntaxError("the hex string must have an even length");
  const bytes = new Uint8Array(value.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    const parsed = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
    if (Number.isNaN(parsed)) throw new SyntaxError("the value is not valid hex");
    bytes[index] = parsed;
  }
  return bytes;
}

/** bytes → lowercase hex. */
export function encodeHex(bytes: Uint8Array): string {
  if (typeof bytes.toHex === "function") return bytes.toHex();
  let hex = "";
  for (const byte of bytes) hex += hexByte(byte);
  return hex;
}
