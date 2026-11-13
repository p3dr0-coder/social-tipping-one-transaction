import test from "node:test";
import assert from "node:assert/strict";
import { decodeBase64, decodeHex, encodeBase64, encodeHex } from "../lib/bytes.ts";
import { createAuthPayload, createAuthNonce, AUTH_NONCE_BYTES } from "../lib/auth.ts";

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

test("auth nonce and payload keep their validation", () => {
  const nonce = createAuthNonce();
  assert.equal(nonce.byteLength, AUTH_NONCE_BYTES);
  const payload = createAuthPayload({ message: "sign in", recipient: "philia.example" });
  assert.equal(payload.nonce.byteLength, AUTH_NONCE_BYTES);
  assert.equal(payload.message, "sign in");
  assert.throws(() => createAuthPayload({ message: "", recipient: "philia.example" }), /must not be empty/);
  assert.throws(() => createAuthPayload({ message: "x", recipient: "" }), /must not be empty/);
});
