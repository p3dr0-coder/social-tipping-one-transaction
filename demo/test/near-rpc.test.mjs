import test from "node:test";
import assert from "node:assert/strict";
import { parseUnits, transactionHash, describeError, finalStatusName, failureReason } from "../lib/near-rpc.mjs";

test("parseUnits mirrors the contract parser", () => {
  assert.equal(parseUnits("1", 24), 10n ** 24n);
  assert.equal(parseUnits("0.001", 6), 1000n);
  assert.equal(parseUnits("12.000000000000000000000001", 24), 12_000_000_000_000_000_000_000_001n);
  assert.throws(() => parseUnits("abc", 6), /invalid amount/);
  assert.throws(() => parseUnits("01", 6), /leading zeros/);
  assert.throws(() => parseUnits("0.0000001", 6), /fractional digits/);
  assert.throws(() => parseUnits("0", 6), /greater than zero/);
});

test("transactionHash reads the documented result shapes", () => {
  assert.equal(transactionHash({ transaction_outcome: { id: "a" } }), "a");
  assert.equal(transactionHash({ transaction: { hash: "b" } }), "b");
  assert.equal(transactionHash({ context: { transactionHash: "c" } }), "c");
  assert.equal(transactionHash({ transactionResult: { transaction_outcome: { id: "d" } } }), "d");
  assert.equal(transactionHash({}), null);
  assert.equal(transactionHash(null), null);
});

test("error and status helpers preserve the wire failures", () => {
  assert.equal(describeError({ message: "boom" }), "boom");
  assert.equal(describeError({ message: "boom", status: { Failure: "x" } }), 'boom: {"Failure":"x"}');
  assert.equal(finalStatusName({ status: { FINAL: 1 } }), "FINAL");
  assert.equal(failureReason({ status: { Failure: { ActionError: 1 } } }), '{"ActionError":1}');
  assert.equal(failureReason({ status: { SuccessValue: "" } }), null);
});
