import test from "node:test";
import assert from "node:assert/strict";
import {
  parseUnits,
  transactionHash,
  describeError,
  finalStatusName,
  failureReason,
  sumOutcomeFees,
} from "../lib/near-rpc.mjs";

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

test("sumOutcomeFees counts the signature fee exactly once", () => {
  const receipts = [
    { outcome: { gas_burnt: 2_400_000_000_000, tokens_burnt: "93020000000000000000" } },
    { outcome: { gas_burnt: 1_000_000_000_000, tokens_burnt: "1000000000000000000" } },
  ];
  const viaOutcome = sumOutcomeFees({
    receipts_outcome: receipts,
    transaction_outcome: { outcome: { gas_burnt: 2_428_000_000_000, tokens_burnt: "93410000000000000000" } },
  });
  const viaAggregate = sumOutcomeFees({
    receipts_outcome: receipts,
    outcomes_agg: { transaction_fee: { gas_burnt: 2_428_000_000_000, tokens_burnt: "93410000000000000000" } },
  });
  assert.deepEqual(viaOutcome, { receipts: 2, gas: 5_828_000_000_000, tokens: 187_430_000_000_000_000_000n });
  assert.deepEqual(viaAggregate, viaOutcome);
  assert.deepEqual(sumOutcomeFees({}), { receipts: 0, gas: 0, tokens: 0n });
});
