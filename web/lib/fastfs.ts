import { teraToGas } from "near-api-js";
import { nearConfig } from "~~/near.config";
import type { WalletConnection } from "./social";

/** FastFS accepts a single-transaction Simple payload of at most 1 MiB. */
export const MAX_AVATAR_BYTES = 1024 * 1024;

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
export function simpleFastfsPayload(relativePath: string, mimeType: string, content: Uint8Array): Uint8Array {
  return concatBytes([
    new Uint8Array([0x00]),
    borshString(relativePath),
    new Uint8Array([0x01]),
    borshString(mimeType),
    borshString(content),
  ]);
}

export async function sha256Hex(content: Uint8Array): Promise<string> {
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

async function waitForGateway(accountId: string, path: string): Promise<void> {
  const url = `${nearConfig.fastfsGateway}/${accountId}/social/${path}?v=${Date.now()}`;
  const startedAt = Date.now();
  while (Date.now() - startedAt < GATEWAY_POLL_TIMEOUT_MS) {
    const response = await fetch(url, { cache: "no-store" });
    if (response.ok) return;

    const { promise, resolve } = Promise.withResolvers<void>();
    setTimeout(resolve, GATEWAY_POLL_INTERVAL_MS);
    await promise;
  }
  throw new Error(`FastFS did not serve ${path} within ${GATEWAY_POLL_TIMEOUT_MS / 1_000} s`);
}

/**
 * Uploads an avatar to FastFS and returns its `fastfs://` URI.
 *
 * The image is re-encoded as WebP in the browser, hashed, and uploaded as one Simple
 * payload to the FastData receiver. Multi-part `Partial` uploads for files above the 1 MiB
 * transaction limit are not implemented; such files are rejected instead of silently
 * degrading.
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

  const accountId = wallet.accountId;
  await wallet.signAndSendTransaction({
    receiverId: nearConfig.socialReceiver,
    actions: [
      {
        functionCall: {
          methodName: "__fastdata_fastfs",
          args: payload,
          gas: teraToGas("100"),
          deposit: 0n,
        },
      },
    ],
  });

  await waitForGateway(accountId, path);
  return `fastfs://${accountId}/social/${path}`;
}
