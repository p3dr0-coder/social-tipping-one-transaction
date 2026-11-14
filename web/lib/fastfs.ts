import { teraToGas } from "near-api-js";
import { encodeHex } from "./bytes";
import { nearConfig } from "~~/near.config";
import { confirmTx, extractTxHash, type WalletConnection } from "./social";

import {
  CHUNK_BYTES,
  MAX_AVATAR_BYTES,
  MAX_MEDIA_BYTES,
  assertMimeType,
  assertRelativePath,
  encodePartialFastfsPayload as partialFastfsPayload,
  encodeSimpleFastfsPayload as simpleFastfsPayload,
} from "./fastfs-codec";
import { delay } from "./shared.ts";

const GATEWAY_POLL_INTERVAL_MS = 1_500;
const GATEWAY_POLL_TIMEOUT_MS = 30_000;

async function sha256Hex(content: Uint8Array): Promise<string> {
  // WebCrypto accepts any ArrayBufferView; TS 7 types the generic buffer as
  // ArrayBufferLike, which is not a BufferSource at the type level.
  const bytes: BufferSource = content as BufferSource;
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return encodeHex(new Uint8Array(digest));
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

    await delay(GATEWAY_POLL_INTERVAL_MS);
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
