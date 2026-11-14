/**
 * FastFS payload codec. No runtime imports, so `node --test` runs it directly.
 */

/** FastFS accepts a single-transaction `Simple` payload of at most 1 MiB. */
export const MAX_AVATAR_BYTES = 1024 * 1024;
/** One `Partial` chunk, and the largest `Simple` payload, is 1 MiB. */
export const CHUNK_BYTES = 1024 * 1024;
/** `Partial` uploads reassemble at most 32 MiB. */
export const MAX_MEDIA_BYTES = 32 * 1024 * 1024;
const MAX_RELATIVE_PATH_BYTES = 1024;
const MAX_MIME_BYTES = 256;

function writeU32LE(output: Uint8Array, offset: number, value: number): number {
  output[offset] = value & 0xff;
  output[offset + 1] = (value >>> 8) & 0xff;
  output[offset + 2] = (value >>> 16) & 0xff;
  output[offset + 3] = (value >>> 24) & 0xff;
  return offset + 4;
}

/** Writes a validated ASCII Borsh string directly into `output` with zero allocations or DataView. */
function writeBorshAscii(output: Uint8Array, start: number, value: string): number {
  const len = value.length;
  const offset = writeU32LE(output, start, len);
  for (let index = 0; index < len; index += 1) output[offset + index] = value.charCodeAt(index);
  return offset + len;
}

function writeBorshBytes(output: Uint8Array, start: number, bytes: Uint8Array): number {
  const offset = writeU32LE(output, start, bytes.length);
  output.set(bytes, offset);
  return offset + bytes.length;
}

export function assertRelativePath(relativePath: string): void {
  const segments = relativePath.split("/");
  const invalid =
    relativePath.length === 0 ||
    relativePath.length > MAX_RELATIVE_PATH_BYTES ||
    !/^[A-Za-z0-9._\-/]+$/.test(relativePath) ||
    relativePath.startsWith("/") ||
    relativePath.endsWith("/") ||
    segments.some(segment => segment.length === 0 || segment === "." || segment === "..");
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
 * `FastfsData::Simple`: enum tag `0x00`, relative path, `Some` tag `0x01`, mime type, content.
 * Single output allocation; ASCII strings and u32 lengths write inline with zero extra buffers.
 */
export function encodeSimpleFastfs(relativePath: string, mimeType: string, content: Uint8Array): Uint8Array {
  assertRelativePath(relativePath);
  assertMimeType(mimeType);

  const total = 1 + 4 + relativePath.length + 1 + 4 + mimeType.length + 4 + content.length;
  const output = new Uint8Array(total);
  let offset = 0;

  output[offset] = 0x00;
  offset += 1;
  offset = writeBorshAscii(output, offset, relativePath);
  output[offset] = 0x01;
  offset += 1;
  offset = writeBorshAscii(output, offset, mimeType);
  writeBorshBytes(output, offset, content);
  return output;
}

/**
 * `FastfsData::Partial` for one 1 MiB chunk:
 * enum tag `0x01`, `s(relative_path)`, u32-LE `offset`, u32-LE `full_size`,
 * `s(mime_type)`, `s(content_chunk)`, u32-LE `nonce`.
 */
export function encodePartialFastfs(
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

  const total = 1 + 4 + relativePath.length + 4 + 4 + 4 + mimeType.length + 4 + chunk.length + 4;
  const output = new Uint8Array(total);
  let cursor = 0;

  output[cursor] = 0x01;
  cursor += 1;
  cursor = writeBorshAscii(output, cursor, relativePath);
  cursor = writeU32LE(output, cursor, offset);
  cursor = writeU32LE(output, cursor, fullSize);
  cursor = writeBorshAscii(output, cursor, mimeType);
  cursor = writeBorshBytes(output, cursor, chunk);
  writeU32LE(output, cursor, nonce);
  return output;
}
