// Single consolidated web suite: one node --test process instead of four.
// Same bug-class coverage as the four original files (14 tests) + native timeAgo scenarios.
import test from "node:test";
import assert from "node:assert/strict";
import { decodeBase64, decodeHex, encodeBase64, encodeHex } from "../lib/bytes.ts";
import { createAuthPayload, createAuthNonce, AUTH_NONCE_BYTES } from "../lib/auth.ts";
import {
  FASTDATA_MAX_MULTI_KEYS,
  fastDataKey,
  fastDataLatestUrl,
  fastDataMultiBody,
  fastDataPrefixBody,
  fastDataPrefixUrl,
} from "../lib/fastdata-core.ts";
import {
  CHUNK_BYTES,
  MAX_MEDIA_BYTES,
  encodePartialFastfsPayload,
  encodeSimpleFastfsPayload,
} from "../lib/fastfs-codec.ts";
import { mainPostKey, parseMainPost, collectMainPosts } from "../lib/main-posts.ts";
import { timeAgo } from "../lib/time.ts";

test("base64 round-trips and rejects bad input", () => {
  const bytes = new Uint8Array([0, 1, 2, 250, 251, 255]);
  assert.equal(encodeBase64(bytes), Buffer.from(bytes).toString("base64"));
  assert.deepEqual(decodeBase64(encodeBase64(bytes)), bytes);
  assert.throws(() => decodeBase64("not!!valid"), SyntaxError);
});

test("hex round-trips, lowercases, and rejects odd or bad input", () => {
  const bytes = new Uint8Array([0x00, 0x0f, 0xaa, 0xff]);
  assert.equal(encodeHex(bytes), "000faaff");
  assert.deepEqual(decodeHex("000FAAFF"), bytes);
  assert.throws(() => decodeHex("abc"), SyntaxError);
  assert.throws(() => decodeHex("zz"), SyntaxError);
});

test("auth nonce and payload keep the 32-byte guarantee and fail-fast validation", () => {
  const nonce = createAuthNonce();
  assert.equal(nonce.byteLength, AUTH_NONCE_BYTES);
  const payload = createAuthPayload({ message: "sign in", recipient: "philia.example" });
  assert.equal(payload.nonce.byteLength, AUTH_NONCE_BYTES);
  assert.equal(payload.message, "sign in");
  assert.throws(() => createAuthPayload({ message: "", recipient: "philia.example" }), /must not be empty/);
  assert.throws(() => createAuthPayload({ message: "x", recipient: "" }), /must not be empty/);
});

test("latest URL encodes the full key and metadata query", () => {
  assert.equal(
    fastDataLatestUrl("https://kv.example/", {
      currentAccountId: "social",
      predecessorId: "alice.testnet",
      key: "graph/follow/bob.testnet",
      includeMetadata: true,
    }),
    "https://kv.example/v0/latest/social/alice.testnet/graph%2Ffollow%2Fbob.testnet?include_metadata=true",
  );
});

test("prefix URL supports a predecessor and validates the body", () => {
  assert.equal(
    fastDataPrefixUrl("https://kv.example", {
      currentAccountId: "social",
      predecessorId: "alice.testnet",
      keyPrefix: "post/",
    }),
    "https://kv.example/v0/latest/social/alice.testnet",
  );
  assert.deepEqual(fastDataPrefixBody({ currentAccountId: "social", keyPrefix: "post/", limit: 100 }), {
    key_prefix: "post/",
    limit: 100,
  });
  assert.throws(
    () => fastDataPrefixBody({ currentAccountId: "social", keyPrefix: "post/", limit: 201 }),
    /limit must be 1-200/,
  );
});

test("multi body accepts only fully qualified keys and caps at 100", () => {
  assert.deepEqual(fastDataMultiBody([fastDataKey("social", "alice.testnet", "post/1")]), {
    keys: ["social/alice.testnet/post/1"],
  });
  assert.throws(() => fastDataMultiBody(["post/1"]), /fully qualified/);
  const tooMany = Array.from({ length: FASTDATA_MAX_MULTI_KEYS + 1 }, () => "social/alice.testnet/post/1");
  assert.throws(() => fastDataMultiBody(tooMany), /at most 100/);
});

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
    new Uint8Array([0x00]), u32(pathBytes.length), pathBytes,
    new Uint8Array([0x01]), u32(mimeBytes.length), mimeBytes,
    u32(content.length), content,
  ]);
}
function partialReference(path, mime, chunk, offset, fullSize, nonce) {
  const pathBytes = text(path);
  const mimeBytes = text(mime);
  return reference([
    new Uint8Array([0x01]), u32(pathBytes.length), pathBytes,
    u32(offset), u32(fullSize), u32(mimeBytes.length), mimeBytes,
    u32(chunk.length), chunk, u32(nonce),
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

function oldLoadMainPost(data, author) {
  const accountData = data?.[author];
  if (!accountData || typeof accountData !== "object" || !("post" in accountData)) return null;
  const post = accountData.post;
  if (!post || typeof post !== "object" || !("main" in post)) return null;
  return parseMainPost(post.main);
}
function oldBehavior(data, authors) {
  const posts = new Map();
  for (const author of authors) {
    const main = oldLoadMainPost(data, author);
    if (main) posts.set(author, main.text);
  }
  return posts;
}

test("batched collectMainPosts is oracle-equal to N per-author reads (mixed shapes)", () => {
  const authors = ["a.near", "b.near", "c.near", "d.near", "e.near", "f.near", "g.near", "h.near"];
  const data = {
    "a.near": { post: { main: JSON.stringify({ text: "hello" }) } },
    "b.near": { post: { main: { text: "raw object" } } },
    "c.near": { post: { main: "not json" } },
    "d.near": {},
    "e.near": { post: {} },
    "f.near": { post: { main: JSON.stringify({ nope: 1 }) } },
  };
  const expected = oldBehavior(data, authors);
  assert.deepEqual([...collectMainPosts(data, authors)], [...expected]);
  assert.deepEqual([...collectMainPosts(data, authors)], [["a.near", "hello"], ["b.near", "raw object"]]);
});

test("mainPostKey and parseMainPost cover the edge cases", () => {
  assert.equal(mainPostKey("alice.near"), "alice.near/post/main");
  assert.equal(parseMainPost('{"text":"x"}').text, "x");
  assert.equal(parseMainPost({ text: "y" }).text, "y");
  assert.equal(parseMainPost("bad json"), null);
  assert.equal(parseMainPost(42), null);
  assert.equal(parseMainPost({ nope: 1 }), null);
});

test("missing, null, or empty data yields an empty map without throwing", () => {
  assert.equal(collectMainPosts(null, ["a.near"]).size, 0);
  assert.equal(collectMainPosts(undefined, ["a.near"]).size, 0);
  assert.equal(collectMainPosts({}, ["a.near"]).size, 0);
  assert.equal(collectMainPosts("not an object", ["a.near"]).size, 0);
});

test("one merged get() response covers all authors with no N+1 reads", () => {
  const authors = ["x.near", "y.near", "z.near"];
  const data = {
    "x.near": { post: { main: JSON.stringify({ text: "one" }) } },
    "y.near": { post: { main: JSON.stringify({ text: "two" }) } },
    "z.near": { post: { main: JSON.stringify({ text: "three" }) } },
  };
  const posts = collectMainPosts(data, authors);
  assert.equal(posts.size, 3);
  assert.equal(posts.get("y.near"), "two");
  assert.deepEqual([...posts.keys()], authors);
});

test("timeAgo uses past/future/now labels across unit thresholds", () => {
  const now = 1_700_000_000_000;
  assert.match(timeAgo(now - 5_000, now), /ago/);
  assert.match(timeAgo(now - 120_000, now), /ago/);
  assert.match(timeAgo(now - 7_200_000, now), /ago/);
  assert.match(timeAgo(now - 172_800_000, now), /ago|yesterday/);
  assert.match(timeAgo(now + 3_600_000, now), /in/);
  assert.equal(timeAgo(now, now), "now");
});

test("timeAgo picks the correct unit (second/minute/hour/day)", () => {
  const now = 1_700_000_000_000;
  assert.match(timeAgo(now - 30_000, now), /second/);
  assert.match(timeAgo(now - 600_000, now), /minute/);
  assert.match(timeAgo(now - 10_800_000, now), /hour/);
  assert.match(timeAgo(now - 259_200_000, now), /day|yesterday/);
});
