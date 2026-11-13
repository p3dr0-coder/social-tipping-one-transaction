import test from "node:test";
import assert from "node:assert/strict";
import {
  CHUNK_BYTES,
  MAX_MEDIA_BYTES,
  encodePartialFastfsPayload,
  encodeSimpleFastfsPayload,
} from "../lib/fastfs-codec.ts";

function reference(parts) {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const output = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

function u32(value) {
  const output = new Uint8Array(4);
  new DataView(output.buffer).setUint32(0, value, true);
  return output;
}

function text(value) {
  return new TextEncoder().encode(value);
}

function simpleReference(path, mime, content) {
  const pathBytes = text(path);
  const mimeBytes = text(mime);
  return reference([
    new Uint8Array([0x00]),
    u32(pathBytes.length),
    pathBytes,
    new Uint8Array([0x01]),
    u32(mimeBytes.length),
    mimeBytes,
    u32(content.length),
    content,
  ]);
}

function partialReference(path, mime, chunk, offset, fullSize, nonce) {
  const pathBytes = text(path);
  const mimeBytes = text(mime);
  return reference([
    new Uint8Array([0x01]),
    u32(pathBytes.length),
    pathBytes,
    u32(offset),
    u32(fullSize),
    u32(mimeBytes.length),
    mimeBytes,
    u32(chunk.length),
    chunk,
    u32(nonce),
  ]);
}

test("Simple codec is byte-equal to the reference encoder", () => {
  const content = new Uint8Array(4096);
  for (let index = 0; index < content.length; index += 1) content[index] = index & 0xff;
  assert.deepEqual(
    encodeSimpleFastfsPayload("media/avatar.webp", "image/webp", content),
    simpleReference("media/avatar.webp", "image/webp", content),
  );
});

test("Simple codec handles empty and 1 MiB content", () => {
  assert.deepEqual(
    encodeSimpleFastfsPayload("a", "text/plain", new Uint8Array()),
    simpleReference("a", "text/plain", new Uint8Array()),
  );
  const content = new Uint8Array(1024 * 1024);
  content[0] = 0xaa;
  content[content.length - 1] = 0x55;
  assert.deepEqual(
    encodeSimpleFastfsPayload("media/video.mp4", "video/mp4", content),
    simpleReference("media/video.mp4", "video/mp4", content),
  );
});

test("Partial codec is byte-equal to the reference encoder", () => {
  const chunk = new Uint8Array(CHUNK_BYTES);
  chunk[0] = 1;
  chunk[chunk.length - 1] = 2;
  assert.deepEqual(
    encodePartialFastfsPayload("media/video.mp4", "video/mp4", chunk, CHUNK_BYTES, MAX_MEDIA_BYTES, 42),
    partialReference("media/video.mp4", "video/mp4", chunk, CHUNK_BYTES, MAX_MEDIA_BYTES, 42),
  );
});

test("codec preserves the existing validation errors", () => {
  assert.throws(
    () => encodeSimpleFastfsPayload("../x", "text/plain", new Uint8Array()),
    /not a valid FastFS relative path/,
  );
  assert.throws(() => encodeSimpleFastfsPayload("x", "", new Uint8Array()), /mime type/);
  assert.throws(() => encodePartialFastfsPayload("x", "text/plain", new Uint8Array(1), 1, 2, 1), /1 MiB-aligned/);
  assert.throws(() => encodePartialFastfsPayload("x", "text/plain", new Uint8Array(1), 0, 10, 0), /nonce must be/);
});
