import test from "node:test";
import assert from "node:assert/strict";
import {
  FASTDATA_MAX_MULTI_KEYS,
  fastDataKey,
  fastDataLatestUrl,
  fastDataMultiBody,
  fastDataPrefixBody,
  fastDataPrefixUrl,
} from "../lib/fastdata-core.ts";

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
