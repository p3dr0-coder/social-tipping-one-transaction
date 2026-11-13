/**
 * FastFS payload codec. This module has no runtime imports so the one-allocation encoder and
 * its validators can be tested with `node --test` on every supported Node version.
 */

/** FastFS accepts a single-transaction `Simple` payload of at most 1 MiB. */
export const MAX_AVATAR_BYTES = 1024 * 1024;
/** One `Partial` chunk, and the largest `Simple` payload, is 1 MiB. */
export const CHUNK_BYTES = 1024 * 1024;
/** `Partial` uploads reassemble at most 32 MiB. */
export const MAX_MEDIA_BYTES = 32 * 1024 * 1024;
const MAX_RELATIVE_PATH_BYTES = 1024;
const MAX_MIME_BYTES = 256;
const textEncoder = new TextEncoder();

/** Borsh string: u32 little-endian byte length followed by the bytes. */
function writeBorshString(output: Uint8Array, view: DataView, start: number, bytes: Uint8Array): number {
  view.setUint32(start, bytes.length, true);
  const offset = start + 4;
  output.set(bytes, offset);
  return offset + bytes.length;
}

export function assertRelativePath(relativePath: string): void {
  const segments = relativePath.split("/");
  const invalid =
    relativePath.length === 0 ||
    !/^[A-Za-z0-9._\-/]+$/.test(relativePath) ||
    relativePath.startsWith("/") ||
    relativePath.endsWith("/") ||
    segments.some(segment => segment.length === 0 || segment === "." || segment === "..") ||
    textEncoder.encode(relativePath).byteLength > MAX_RELATIVE_PATH_BYTES;
  if (invalid) {
    throw new Error(
      `"${relativePath}" is not a valid FastFS relative path: ASCII segments separated by "/", no leading, ` +
        `trailing or empty segments, no "." or "..", at most ${MAX_RELATIVE_PATH_BYTES} bytes`,
    );
  }
}

export function assertMimeType(mimeType: string): void {
  if (mimeType.length === 0 || mimeType.length > MAX_MIME_BYTES || !/^[\x20-\x7e]+$/.test(mimeType)) {
    throw new Error(`a FastFS mime type must be 1-${MAX_MIME_BYTES} printable ASCII characters`);
  }
}

/**
 * `FastfsData::Simple`: enum tag `0x00`, the relative path, then the `Some` content tag
 * `0x01` with the mime type and the file bytes.
 *
 * The encoder writes the whole Borsh value into one output allocation. The old form built
 * five intermediate arrays and copied the file bytes twice.
 */
export function encodeSimpleFastfsPayload(relativePath: string, mimeType: string, content: Uint8Array): Uint8Array {
  assertRelativePath(relativePath);
  assertMimeType(mimeType);

  const pathBytes = textEncoder.encode(relativePath);
  const mimeBytes = textEncoder.encode(mimeType);
  const total = 1 + 4 + pathBytes.length + 1 + 4 + mimeBytes.length + 4 + content.length;
  const output = new Uint8Array(total);
  const view = new DataView(output.buffer);
  let offset = 0;

  output[offset] = 0x00;
  offset += 1;
  offset = writeBorshString(output, view, offset, pathBytes);
  output[offset] = 0x01;
  offset += 1;
  offset = writeBorshString(output, view, offset, mimeBytes);
  writeBorshString(output, view, offset, content);
  return output;
}

/**
 * `FastfsData::Partial` for one 1 MiB chunk:
 * enum tag `0x01`, `s(relative_path)`, u32-LE `offset`, u32-LE `full_size`,
 * `s(mime_type)`, `s(content_chunk)`, u32-LE `nonce`, where `s(x)` is a u32-LE byte length
 * followed by the bytes.
 */
export function encodePartialFastfsPayload(
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

  const pathBytes = textEncoder.encode(relativePath);
  const mimeBytes = textEncoder.encode(mimeType);
  const total = 1 + 4 + pathBytes.length + 4 + 4 + 4 + mimeBytes.length + 4 + chunk.length + 4;
  const output = new Uint8Array(total);
  const view = new DataView(output.buffer);
  let cursor = 0;

  output[cursor] = 0x01;
  cursor += 1;
  cursor = writeBorshString(output, view, cursor, pathBytes);
  view.setUint32(cursor, offset, true);
  cursor += 4;
  view.setUint32(cursor, fullSize, true);
  cursor += 4;
  cursor = writeBorshString(output, view, cursor, mimeBytes);
  cursor = writeBorshString(output, view, cursor, chunk);
  view.setUint32(cursor, nonce, true);
  return output;
}
