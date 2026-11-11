#!/usr/bin/env node
/**
 * Measurement run: 10 posts of about 1 KB through `__fastdata_kv` on testnet.
 *
 * For every post the script records the transaction hash, the attached gas, the gas and
 * tokens burnt (summed over `receipts_outcome` plus `outcomes_agg.transaction_fee`), and the
 * time until `tx_status` with `wait_until: "FINAL"` returns. Progress goes to stderr; the
 * JSON summary goes to stdout.
 */
import { Account, Action, FunctionCall, JsonRpcProvider } from "near-api-js";

const POST_COUNT = 10;
const TEXT_BYTES = 1_024;
const ATTACHED_GAS = 10n ** 12n;
const RPC_URL = process.env.NEAR_RPC_URL ?? "https://rpc.testnet.near.org";

function fail(message) {
  console.error(`measure: ${message}`);
  process.exit(1);
}

if (!process.env.ALICE_ACCOUNT || !process.env.ALICE_PRIVATE_KEY) {
  fail("export ALICE_ACCOUNT and ALICE_PRIVATE_KEY before measuring");
}
if (RPC_URL.includes("mainnet") || process.env.ALICE_ACCOUNT.endsWith(".near")) {
  fail("this measurement is testnet-only; point NEAR_RPC_URL and ALICE_ACCOUNT at testnet");
}

const alice = process.env.ALICE_ACCOUNT;
const provider = new JsonRpcProvider({ url: RPC_URL });
const account = new Account(alice, provider, process.env.ALICE_PRIVATE_KEY);

let requestId = 0;

async function rpc(method, params) {
  requestId += 1;
  const response = await fetch(RPC_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: requestId, method, params }),
  });
  const body = await response.json();
  if (body.error) {
    throw new Error(`${method}: ${body.error.message ?? JSON.stringify(body.error)}`);
  }
  return body.result;
}

function functionCall(methodName, args) {
  return new Action({
    functionCall: new FunctionCall({
      methodName,
      args: new TextEncoder().encode(JSON.stringify(args)),
      gas: ATTACHED_GAS,
      deposit: 0n,
    }),
  });
}

function transactionHash(value) {
  if (!value || typeof value !== "object") return null;
  return (
    value.transaction_outcome?.id ??
    value.transaction?.hash ??
    value.transactionHash ??
    value.context?.transactionHash ??
    value.transactionResult?.transaction_outcome?.id ??
    null
  );
}

const status = await rpc("status", []);
const protocolVersion = status.protocol_version;
console.error(`measure: ${RPC_URL} protocol ${protocolVersion}, ${alice}`);

const samples = [];

for (let index = 0; index < POST_COUNT; index += 1) {
  const text = `sample ${index + 1}: ${"x".repeat(TEXT_BYTES)}`;
  const key = `post/${Date.now()}${String(index).padStart(2, "0")}`;

  const startedAt = performance.now();
  // The social receiver has no contract code: the wallet/rpc path may surface
  // CodeDoesNotExist even though the write is valid. The hash is extracted either way and
  // the write is judged by its FINAL status below.
  let submitted;
  try {
    submitted = await account.signAndSendTransaction({
      receiverId: "social",
      actions: [functionCall("__fastdata_kv", { [key]: { text } })],
      waitUntil: "INCLUDED",
      throwOnFailure: false,
    });
  } catch (error) {
    submitted = error;
  }
  const hash = transactionHash(submitted);
  if (!hash) throw new Error(`post ${index + 1} returned no transaction hash`);

  const final = await rpc("tx_status", {
    tx_hash: hash,
    sender_account_id: alice,
    wait_until: "FINAL",
  });
  const confirmMs = Math.round(performance.now() - startedAt);

  const receipts = final.receipts_outcome ?? [];
  const receiptGas = receipts.reduce((sum, receipt) => sum + Number(receipt.outcome?.gas_burnt ?? 0), 0);
  const receiptTokens = receipts.reduce(
    (sum, receipt) => sum + BigInt(receipt.outcome?.tokens_burnt ?? "0"),
    0n,
  );
  const transactionFee = final.outcomes_agg?.transaction_fee ?? {};
  const gasBurnt = receiptGas + Number(transactionFee.gas_burnt ?? 0);
  const tokensBurnt = receiptTokens + BigInt(transactionFee.tokens_burnt ?? "0");

  samples.push({
    index: index + 1,
    post_key: key,
    text_bytes: new TextEncoder().encode(text).byteLength,
    tx_hash: hash,
    attached_gas_units: ATTACHED_GAS.toString(),
    attached_deposit_yocto: "0",
    receipts: receipts.length,
    gas_burnt: gasBurnt,
    tokens_burnt_yocto: tokensBurnt.toString(),
    confirm_ms: confirmMs,
    final_execution_status: final.final_execution_status ?? null,
  });

  console.error(`measure: ${index + 1}/${POST_COUNT} ${hash} gas ${gasBurnt} tokens ${tokensBurnt} in ${confirmMs} ms`);
}

const totals = samples.reduce(
  (accumulator, sample) => ({
    gas_burnt: accumulator.gas_burnt + sample.gas_burnt,
    tokens_burnt_yocto: accumulator.tokens_burnt_yocto + BigInt(sample.tokens_burnt_yocto),
    confirm_ms: accumulator.confirm_ms + sample.confirm_ms,
  }),
  { gas_burnt: 0, tokens_burnt_yocto: 0n, confirm_ms: 0 },
);

const summary = {
  network: "testnet",
  rpc_url: RPC_URL,
  protocol_version: protocolVersion,
  generated_at: new Date().toISOString(),
  posts: samples.length,
  attached_gas_units_per_post: ATTACHED_GAS.toString(),
  samples,
  totals: {
    gas_burnt: totals.gas_burnt,
    tokens_burnt_yocto: totals.tokens_burnt_yocto.toString(),
    average_confirm_ms: Math.round(totals.confirm_ms / samples.length),
  },
};

console.log(JSON.stringify(summary, null, 2));
