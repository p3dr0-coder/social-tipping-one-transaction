import { teraToGas } from "near-api-js";
import { nearConfig } from "~~/near.config";
import { confirmTx, extractTxHash, type WalletConnection } from "./social";

/** FastFS accepts a single-transaction `Simple` payload of at most 1 MiB. */
const MAX_AVATAR_BYTES = 1024 * 1024;
/** One `Partial` chunk, and the largest `Simple` payload, is 1 MiB. */
const CHUNK_BYTES = 1024 * 1024;
/** `Partial` uploads reassemble at most 32 MiB. */
const MAX_MEDIA_BYTES = 32 * 1024 * 1024;
const MAX_RELATIVE_PATH_BYTES = 1024;
const MAX_MIME_BYTES = 256;

const GATEWAY_POLL_INTERVAL_MS = 1_500;
const GATEWAY_POLL_TIMEOUT_MS = 30_000;

function concatBytes(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((length, part) => length + part.length, 0);
  const output = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

/** Borsh string: u32 little-endian byte length followed by the bytes. */
function borshString(value: string | Uint8Array): Uint8Array {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  const output = new Uint8Array(4 + bytes.length);
  new DataView(output.buffer).setUint32(0, bytes.length, true);
  output.set(bytes, 4);
  return output;
}

/**
 * `FastfsData::Simple`: enum tag `0x00`, the relative path, then the `Some` content tag
 * `0x01` with the mime type and the file bytes.
 */
function simpleFastfsPayload(relativePath: string, mimeType: string, content: Uint8Array): Uint8Array {
  assertRelativePath(relativePath);
  assertMimeType(mimeType);
  return concatBytes([
    new Uint8Array([0x00]),
    borshString(relativePath),
    new Uint8Array([0x01]),
    borshString(mimeType),
    borshString(content),
  ]);
}

/** Borsh `u32`: four little-endian bytes. */
function borshU32(value: number, field: string): Uint8Array {
  if (!Number.isInteger(value) || value < 0 || value > 0xffff_ffff) {
    throw new Error(`${field} must be an unsigned 32-bit integer, received ${String(value)}`);
  }
  const output = new Uint8Array(4);
  new DataView(output.buffer).setUint32(0, value, true);
  return output;
}

function assertRelativePath(relativePath: string): void {
  const segments = relativePath.split("/");
  const invalid =
    relativePath.length === 0 ||
    !/^[A-Za-z0-9._\-/]+$/.test(relativePath) ||
    relativePath.startsWith("/") ||
    relativePath.endsWith("/") ||
    segments.some(segment => segment.length === 0 || segment === "." || segment === "..") ||
    new TextEncoder().encode(relativePath).byteLength > MAX_RELATIVE_PATH_BYTES;
  if (invalid) {
    throw new Error(
      `"${relativePath}" is not a valid FastFS relative path: ASCII segments separated by "/", no leading, ` +
        `trailing or empty segments, no "." or "..", at most ${MAX_RELATIVE_PATH_BYTES} bytes`,
    );
  }
}

function assertMimeType(mimeType: string): void {
  if (mimeType.length === 0 || mimeType.length > MAX_MIME_BYTES || !/^[\x20-\x7e]+$/.test(mimeType)) {
    throw new Error(`a FastFS mime type must be 1-${MAX_MIME_BYTES} printable ASCII characters`);
  }
}

/**
 * `FastfsData::Partial` for one 1 MiB chunk:
 * enum tag `0x01`, `s(relative_path)`, u32-LE `offset`, u32-LE `full_size`,
 * `s(mime_type)`, `s(content_chunk)`, u32-LE `nonce`, where `s(x)` is a u32-LE byte length
 * followed by the bytes. Every chunk of one upload repeats the same nonce.
 */
function partialFastfsPayload(
  relativePath: string,
  mimeType: string,
  chunk: Uint8Array,
  offset: number,
  fullSize: number,
  nonce: number,
): Uint8Array {
  assertRelativePath(relativePath);
  assertMimeType(mimeType);
  if (!Number.isInteger(fullSize) || fullSize < 1 || fullSize > MAX_MEDIA_BYTES) {
    throw new Error(`full_size must be 1-${MAX_MEDIA_BYTES} bytes, received ${String(fullSize)}`);
  }
  if (!Number.isInteger(offset) || offset < 0 || offset >= fullSize || offset % CHUNK_BYTES !== 0) {
    throw new Error(`offset must be a 1 MiB-aligned position below full_size, received ${String(offset)}`);
  }
  if (chunk.byteLength === 0 || chunk.byteLength > CHUNK_BYTES) {
    throw new Error(`a Partial chunk must carry 1-${CHUNK_BYTES} bytes, received ${chunk.byteLength}`);
  }
  if (offset + chunk.byteLength > fullSize) {
    throw new Error("the chunk extends past full_size");
  }
  if (!Number.isInteger(nonce) || nonce < 1 || nonce > 2_147_483_647) {
    throw new Error(`nonce must be in 1..=2147483647, received ${String(nonce)}`);
  }
  return concatBytes([
    new Uint8Array([0x01]),
    borshString(relativePath),
    borshU32(offset, "offset"),
    borshU32(fullSize, "full_size"),
    borshString(mimeType),
    borshString(chunk),
    borshU32(nonce, "nonce"),
  ]);
}

async function sha256Hex(content: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", content);
  return Array.from(new Uint8Array(digest))
    .map(byte => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function canonicalizeToWebp(file: File): Promise<Uint8Array> {
  const bitmap = await createImageBitmap(file);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("this browser cannot encode the avatar");
    context.drawImage(bitmap, 0, 0);

    const { promise, resolve } = Promise.withResolvers<Blob | null>();
    canvas.toBlob(resolve, "image/webp", 0.9);
    const blob = await promise;
    if (!blob) throw new Error("this browser could not encode the avatar as WebP");
    return new Uint8Array(await blob.arrayBuffer());
  } finally {
    bitmap.close();
  }
}

async function waitForGateway(accountId: string, path: string, timeoutMs = GATEWAY_POLL_TIMEOUT_MS): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    // The FastFS CDN caches 404s, so every probe gets a fresh cache-busting value.
    const version = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const url = `${nearConfig.fastfsGateway}/${accountId}/social/${path}?v=${version}`;
    const response = await fetch(url, { cache: "no-store" });
    if (response.ok) return;

    const { promise, resolve } = Promise.withResolvers<void>();
    setTimeout(resolve, GATEWAY_POLL_INTERVAL_MS);
    await promise;
  }
  throw new Error(`FastFS did not serve ${path} within ${Math.round(timeoutMs / 1_000)} s`);
}

async function sendFastfsPayload(
  wallet: WalletConnection,
  payload: Uint8Array,
  confirmation?: { accountId: string; path: string; gatewayFallback: boolean },
): Promise<void> {
  const settled = await wallet.signAndSendTransaction({
    receiverId: nearConfig.socialReceiver,
    actions: [
      {
        functionCall: {
          methodName: "__fastdata_fastfs",
          args: payload,
          // FastFS performs no work; gas 1 keeps each chunk's key-allowance cost tiny.
          gas: teraToGas("1"),
          deposit: 0n,
        },
      },
    ],
  });

  // `/v1/tx` is mainnet-only. Confirming it surfaces `invalid_borsh`, `value_too_large`
  // and `rate_limited` per key instead of hiding them behind a gateway timeout.
  if (!confirmation || nearConfig.network !== "mainnet") return;
  const hash = extractTxHash(settled);
  if (!hash) throw new Error("the FastFS transaction returned no hash");
  await confirmTx(hash, {
    timeoutMs: 15_000,
    ...(confirmation.gatewayFallback
      ? {
          fallback: async () => {
            try {
              await waitForGateway(confirmation.accountId, confirmation.path, 5_000);
              return true;
            } catch {
              return false;
            }
          },
        }
      : {}),
  });
}

async function readBytes(file: Blob | Uint8Array): Promise<Uint8Array> {
  if (file instanceof Uint8Array) return file;
  return new Uint8Array(await file.arrayBuffer());
}

// One nonce identifies every chunk of one upload (standard.md §4), so it must not change
// between the chunks of a multi-part file. Re-uploading the same path needs a fresh nonce;
// the counter starts at a random point and increments so a reload never repeats a nonce.
let partialNonce = Math.floor(Math.random() * 2_147_483_647) + 1;

function nextPartialNonce(): number {
  const nonce = partialNonce;
  partialNonce = nonce >= 2_147_483_647 ? 1 : nonce + 1;
  return nonce;
}

export type UploadMediaOptions = {
  mime: string;
  relativePath: string;
};

/**
 * Uploads arbitrary media to FastFS and returns its `fastfs://` URI.
 *
 * Payloads that fit one `Simple` transaction stay in one transaction. Larger files (up to
 * 32 MiB) go out as sequential 1 MiB `Partial` transactions that share one nonce, then the
 * gateway is polled once after the whole file is on chain.
 */
export async function uploadMedia(
  file: Blob | Uint8Array,
  wallet: WalletConnection,
  options: UploadMediaOptions,
): Promise<string> {
  const accountId = wallet.accountId;
  if (!accountId) throw new Error("connect a wallet before uploading media");
  assertRelativePath(options.relativePath);
  assertMimeType(options.mime);
  if (!(file instanceof Uint8Array) && file.size > MAX_MEDIA_BYTES) {
    throw new Error(`media must be ${MAX_MEDIA_BYTES / (1024 * 1024)} MiB or smaller`);
  }

  const content = await readBytes(file);
  if (content.byteLength === 0) throw new Error("cannot upload an empty file to FastFS");
  if (content.byteLength > MAX_MEDIA_BYTES) {
    throw new Error(`media must be ${MAX_MEDIA_BYTES / (1024 * 1024)} MiB or smaller`);
  }

  const simplePayload = simpleFastfsPayload(options.relativePath, options.mime, content);
  if (simplePayload.byteLength <= CHUNK_BYTES) {
    await sendFastfsPayload(wallet, simplePayload, {
      accountId,
      path: options.relativePath,
      gatewayFallback: true,
    });
  } else {
    const nonce = nextPartialNonce();
    const fullSize = content.byteLength;
    for (let offset = 0; offset < fullSize; offset += CHUNK_BYTES) {
      const chunk = content.subarray(offset, Math.min(offset + CHUNK_BYTES, fullSize));
      const payload = partialFastfsPayload(options.relativePath, options.mime, chunk, offset, fullSize, nonce);
      await sendFastfsPayload(wallet, payload, {
        accountId,
        path: options.relativePath,
        gatewayFallback: false,
      });
    }
  }

  if (nearConfig.network === "mainnet") {
    // `main.fastfs.io` serves mainnet `social` writes only; testnet writes have no public
    // gateway equivalent, so polling it there would report a false failure.
    const chunks = Math.ceil(content.byteLength / CHUNK_BYTES);
    await waitForGateway(accountId, options.relativePath, GATEWAY_POLL_TIMEOUT_MS + chunks * 2_000);
  }
  return `fastfs://${accountId}/social/${options.relativePath}`;
}

/**
 * Uploads an avatar to FastFS and returns its `fastfs://` URI.
 *
 * The image is re-encoded as WebP in the browser, hashed, and uploaded as one Simple
 * payload to the FastData receiver. Avatars stay within the single-transaction limit, so a
 * file whose encoded payload exceeds 1 MiB is rejected instead of silently degrading.
 */
export async function uploadAvatar(file: File, wallet: WalletConnection): Promise<string> {
  if (!wallet.accountId) throw new Error("connect a wallet before uploading an avatar");
  if (file.size > MAX_AVATAR_BYTES) {
    throw new Error("avatar must be 1 MiB or smaller before upload");
  }

  const content = await canonicalizeToWebp(file);
  const path = `media/${await sha256Hex(content)}.webp`;
  const payload = simpleFastfsPayload(path, "image/webp", content);
  if (payload.byteLength > MAX_AVATAR_BYTES) {
    throw new Error("the encoded avatar payload must be 1 MiB or smaller; choose a smaller image");
  }

  return uploadMedia(content, wallet, { mime: "image/webp", relativePath: path });
}
