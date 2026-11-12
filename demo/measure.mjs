#!/usr/bin/env node
/**
 * Measurement run: 10 posts of about 1 KB through `social.__fastdata_kv` on testnet.
 *
 * Every sample records the protocol version, the attached gas (1 Tgas), the transaction hash,
 * the gas and tokens burnt, and the time until `tx_status` with `wait_until: "FINAL"` returns.
 * Submission asks for `INCLUDED` and recovers the hash from the result or the thrown outcome;
 * the hash is then queried at `FINAL`. `social` has no contract code, so the expected
 * `CodeDoesNotExist` failure is recorded but is not a sample failure. Any other failure is
 * reported with its hash and status, and the script exits non-zero. Progress goes to stderr;
 * the JSON summary goes to stdout.
 */
import { Account, JsonRpcProvider, actions, teraToGas } from "near-api-js";

const POST_COUNT = 10;
const TEXT_BYTES = 1_024;
const ATTACHED_GAS = teraToGas("1");
const ATTACHED_DEPOSIT = 0n;
const SOCIAL_RECEIVER = "social";
const RPC_URL = process.env.NEAR_RPC_URL ?? "https://rpc.testnet.near.org";

function fail(message) {
  console.error(`measure: ${message}`);
  process.exit(1);
}

const NETWORK = (process.env.PHILIA_NETWORK ?? "testnet").trim().toLowerCase();
if (NETWORK !== "testnet") {
  fail(
    `measure.mjs records the testnet baseline only; PHILIA_NETWORK=${JSON.stringify(process.env.PHILIA_NETWORK)} is not testnet — unset it or set it to testnet`,
  );
}
if (!process.env.ALICE_ACCOUNT || !process.env.ALICE_PRIVATE_KEY) {
  fail("export ALICE_ACCOUNT and ALICE_PRIVATE_KEY before measuring");
}
if (/mainnet/i.test(RPC_URL) || process.env.ALICE_ACCOUNT.toLowerCase().endsWith(".near")) {
  fail("this measurement is testnet-only; point NEAR_RPC_URL and ALICE_ACCOUNT at testnet");
}

const alice = process.env.ALICE_ACCOUNT;
const provider = new JsonRpcProvider({ url: RPC_URL });
const account = new Account(alice, provider, process.env.ALICE_PRIVATE_KEY);

let requestId = 0;

async function rpc(method, params) {
  requestId += 1;
  let response;
  try {
    response = await fetch(RPC_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: requestId, method, params }),
    });
  } catch (error) {
    throw new Error(`cannot reach ${RPC_URL}: ${error.message}`);
  }
  if (!response.ok) {
    throw new Error(`${RPC_URL} returned HTTP ${response.status}`);
  }
  let body;
  try {
    body = await response.json();
  } catch {
    throw new Error(`${RPC_URL} returned a non-JSON response`);
  }
  if (body.error) {
    throw new Error(`${method}: ${body.error.message ?? JSON.stringify(body.error)}`);
  }
  return body.result;
}

function functionCall(methodName, args) {
  return actions.functionCall(methodName, args, ATTACHED_GAS, ATTACHED_DEPOSIT);
}

function transactionHash(value) {
  if (!value || typeof value !== "object") return null;
  const candidates = [
    value.transaction_outcome?.id,
    value.transaction?.hash,
    value.transactionHash,
    value.context?.transactionHash,
    value.transactionResult?.transaction_outcome?.id,
    value.result?.transaction_outcome?.id,
    value.result?.transaction?.hash,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.length > 0) return candidate;
  }
  return null;
}

function describeError(value) {
  if (!value) return "no result";
  if (typeof value === "string") return value;
  const message = value.message ?? value.error?.message ?? value.cause?.message;
  const status = value.status && typeof value.status === "object" ? JSON.stringify(value.status) : null;
  if (message || status) return [message, status].filter(Boolean).join(": ");
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function finalStatusName(final) {
  const status = final?.status;
  if (!status || typeof status !== "object") return null;
  return Object.keys(status)[0] ?? null;
}

function failureReasonOf(final) {
  const status = final?.status;
  if (!status || typeof status !== "object" || !("Failure" in status)) return null;
  try {
    return JSON.stringify(status.Failure);
  } catch {
    return "Failure";
  }
}

const status = await rpc("status", []);
const protocolVersion = status?.protocol_version;
if (status?.chain_id !== "testnet") {
  fail(
    `${RPC_URL} reports chain_id ${JSON.stringify(status?.chain_id)}; this measurement is testnet-only, so point NEAR_RPC_URL at https://rpc.testnet.near.org`,
  );
}
console.error(`measure: ${RPC_URL} protocol ${protocolVersion}, ${alice}`);

const samples = [];
const failures = [];

function reportFailure(sample, stage, message) {
  sample.error = `${stage}: ${message}`;
  const hashSuffix = sample.tx_hash ? ` (tx ${sample.tx_hash})` : "";
  failures.push({
    index: sample.index,
    tx_hash: sample.tx_hash,
    stage,
    final_execution_status: sample.final_execution_status,
    final_status: sample.final_status,
    error: sample.error,
  });
  console.error(`measure: sample ${sample.index}/${POST_COUNT} FAILED at ${stage}${hashSuffix}: ${message}`);
}

for (let index = 0; index < POST_COUNT; index += 1) {
  const text = `sample ${index + 1}: ${"x".repeat(TEXT_BYTES)}`;
  const key = `post/${Date.now()}${String(index).padStart(2, "0")}`;
  const encoded = new TextEncoder().encode(text);

  const sample = {
    index: index + 1,
    post_key: key,
    text_bytes: encoded.byteLength,
    protocol_version: protocolVersion,
    tx_hash: null,
    attached_gas: ATTACHED_GAS.toString(),
    attached_deposit: ATTACHED_DEPOSIT.toString(),
    receipts: null,
    gas_burnt: null,
    tokens_burnt: null,
    confirm_ms: null,
    final_execution_status: null,
    final_status: null,
    failure_reason: null,
    expected_failure: null,
    ok: false,
    error: null,
  };
  samples.push(sample);

  const startedAt = performance.now();

  // The social receiver has no contract code: the wallet/rpc path may surface
  // CodeDoesNotExist even though the write is valid. The hash is extracted either way and
  // the write is judged by its FINAL status below.
  let settled;
  try {
    settled = await account.signAndSendTransaction({
      receiverId: SOCIAL_RECEIVER,
      actions: [functionCall("__fastdata_kv", { [key]: { text } })],
      waitUntil: "INCLUDED",
      throwOnFailure: false,
    });
  } catch (error) {
    settled = error;
  }

  const hash = transactionHash(settled);
  if (!hash) {
    reportFailure(sample, "submit", `no transaction hash (${describeError(settled)})`);
    continue;
  }
  sample.tx_hash = hash;

  let final;
  try {
    final = await rpc("tx_status", {
      tx_hash: hash,
      sender_account_id: alice,
      wait_until: "FINAL",
    });
  } catch (error) {
    reportFailure(sample, "tx_status", error.message);
    continue;
  }

  sample.confirm_ms = Math.round(performance.now() - startedAt);
  sample.final_execution_status = final?.final_execution_status ?? null;
  sample.final_status = finalStatusName(final);
  const failureReason = failureReasonOf(final);
  sample.failure_reason = failureReason;

  try {
    const receipts = Array.isArray(final?.receipts_outcome) ? final.receipts_outcome : [];
    const receiptGas = receipts.reduce((sum, receipt) => sum + Number(receipt?.outcome?.gas_burnt ?? 0), 0);
    const receiptTokens = receipts.reduce(
      (sum, receipt) => sum + BigInt(receipt?.outcome?.tokens_burnt ?? "0"),
      0n,
    );
    // `tx_status` reports the transaction fee as `transaction_outcome.outcome`; the
    // `outcomes_agg.transaction_fee` shape is accepted as a fallback for RPC deployments
    // that aggregate it. Never add both, or the signature fee is counted twice.
    const fee = final?.transaction_outcome?.outcome ?? final?.outcomes_agg?.transaction_fee ?? {};
    sample.receipts = receipts.length;
    sample.gas_burnt = receiptGas + Number(fee?.gas_burnt ?? 0);
    sample.tokens_burnt = (receiptTokens + BigInt(fee?.tokens_burnt ?? "0")).toString();
  } catch (error) {
    reportFailure(sample, "accounting", error.message);
    continue;
  }

  const problems = [];
  if (sample.final_execution_status !== "FINAL") {
    problems.push(
      `final_execution_status is ${JSON.stringify(sample.final_execution_status)}, expected "FINAL" after wait_until:"FINAL"`,
    );
  }
  if (failureReason && !failureReason.includes("CodeDoesNotExist")) {
    problems.push(`execution failed: ${failureReason}`);
  } else if (failureReason) {
    sample.expected_failure = "CodeDoesNotExist";
  }
  if (problems.length > 0) {
    reportFailure(sample, "status", `${problems.join("; ")} (final_status ${JSON.stringify(sample.final_status)})`);
    continue;
  }

  sample.ok = true;
  console.error(
    `measure: ${index + 1}/${POST_COUNT} ${hash} gas ${sample.gas_burnt} tokens ${sample.tokens_burnt} in ${sample.confirm_ms} ms (${sample.final_execution_status}${sample.expected_failure ? ", expected CodeDoesNotExist" : ""})`,
  );
}

const successful = samples.filter(sample => sample.ok);
const totals =
  successful.length === 0
    ? null
    : {
        samples: successful.length,
        gas_burnt: successful.reduce((sum, sample) => sum + sample.gas_burnt, 0),
        tokens_burnt: successful
          .reduce((sum, sample) => sum + BigInt(sample.tokens_burnt), 0n)
          .toString(),
        average_confirm_ms: Math.round(
          successful.reduce((sum, sample) => sum + sample.confirm_ms, 0) / successful.length,
        ),
      };

const summary = {
  network: "testnet",
  rpc_url: RPC_URL,
  receiver: SOCIAL_RECEIVER,
  protocol_version: protocolVersion,
  generated_at: new Date().toISOString(),
  posts_requested: POST_COUNT,
  posts_ok: successful.length,
  posts_failed: failures.length,
  attached_gas_per_post: ATTACHED_GAS.toString(),
  attached_deposit_per_post: ATTACHED_DEPOSIT.toString(),
  samples,
  failures,
  totals,
};

console.log(JSON.stringify(summary, null, 2));

if (failures.length > 0) {
  console.error(
    `measure: ${failures.length} of ${POST_COUNT} samples failed; see failures[] for the failing hash and status`,
  );
  process.exitCode = 1;
}
