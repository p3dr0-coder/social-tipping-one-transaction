#!/usr/bin/env node
/**
 * Measurement run: 10 posts of about 1 KB through `social.__fastdata_kv` on testnet.
 *
 * Every sample records the protocol version, the attached gas (1 Tgas), the transaction hash,
 * the gas and tokens burnt, the time until `tx_status` with `wait_until: "FINAL"` returns
 * (`confirm_ms`), and the time until the write is visible in the testnet FastData KV index
 * (`index_ms`). Submission asks for `INCLUDED` and recovers the hash from the result or the
 * thrown outcome; the hash is then queried at `FINAL` while the KV API is polled in parallel.
 * `social` has no contract code (the testnet account does not exist), so the expected
 * `CodeDoesNotExist` / `AccountDoesNotExist` failure is recorded but is not a sample failure:
 * FastData indexes the write from the transaction itself, not from contract state. If the
 * index cannot see a key within the poll timeout, `index_ms` is
 * null with the reason in `index_error`; that is a measurement gap, not a failed write. Any
 * other failure is reported with its hash and status, and the script exits non-zero. Progress
 * goes to stderr; the JSON summary goes to stdout.
 */
import { Account, JsonRpcProvider, actions, teraToGas } from "near-api-js";
import {
  createRpc,
  delay,
  describeError,
  failureReason as failureReasonOf,
  finalStatusName,
  transactionHash,
} from "./lib/near-rpc.mjs";

const POST_COUNT = 10;
const TEXT_BYTES = 1_024;
const ATTACHED_GAS = teraToGas("1");
const ATTACHED_DEPOSIT = 0n;
const SOCIAL_RECEIVER = "social";
const EXPECTED_FASTDATA_FAILURES = ["CodeDoesNotExist", "AccountDoesNotExist"];
const FCK_ALLOWANCE_CONSUMED = "0 (full-access key; FCK not used in this run)";
const KV_API_URL = (process.env.PHILIA_KV_API ?? "https://kv.test.fastnear.com").replace(/\/+$/, "");
const KV_KEY_PREFIX = "post/";
const INDEX_TIMEOUT_MS = 30_000;
const INDEX_INTERVAL_MS = 1_000;
const RPC_URL = process.env.NEAR_RPC_URL ?? "https://rpc.testnet.fastnear.com";

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

const rpc = createRpc(RPC_URL);



/**
 * The documented testnet FastData KV read API, exact-key form:
 * `POST https://kv.test.fastnear.com/v0/latest/social/{predecessor}` with `{"key": ...}`.
 * The prefix listing is key-ordered and paginated, so it cannot cheaply prove that one new
 * key is visible; the exact-key endpoint answers that directly for the submitting account.
 */
async function fetchIndexedKey(key) {
  let response;
  try {
    response = await fetch(`${KV_API_URL}/v0/latest/${SOCIAL_RECEIVER}/${alice}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ key, include_metadata: true }),
      signal: AbortSignal.timeout(20_000),
    });
  } catch (error) {
    throw new Error(`cannot reach ${KV_API_URL}: ${error.message}`);
  }
  if (!response.ok) {
    throw new Error(`${KV_API_URL} returned HTTP ${response.status}`);
  }
  let body;
  try {
    body = await response.json();
  } catch {
    throw new Error(`${KV_API_URL} returned a non-JSON response`);
  }
  return body;
}

/**
 * Polls the KV API from submission until this sample's key is visible. Matching by `tx_hash`
 * (metadata) or by the exact key keeps other writers out of the result. A timeout or API
 * error returns `index_ms: null` with the reason instead of failing the write.
 */
async function waitForKey(hash, key, startedAt, token) {
  const deadline = startedAt + INDEX_TIMEOUT_MS;
  let lastError = null;
  while (!token.cancelled) {
    try {
      const body = await fetchIndexedKey(key);
      const entries = Array.isArray(body?.entries) ? body.entries : [];
      const hit = entries.find(entry => entry?.tx_hash === hash || entry?.key === key);
      if (hit) {
        return {
          index_ms: Math.round(performance.now() - startedAt),
          index_error: null,
          index_block_height: hit.block_height ?? null,
        };
      }
    } catch (error) {
      lastError = error.message;
    }
    if (performance.now() >= deadline) break;
    await delay(INDEX_INTERVAL_MS);
  }
  const reason = token.cancelled
    ? "not checked: the transaction failed before the index could see it"
    : lastError
      ? `KV API error: ${lastError}`
      : `key ${JSON.stringify(key)} not visible at ${KV_API_URL} within ${INDEX_TIMEOUT_MS} ms`;
  return { index_ms: null, index_error: reason, index_block_height: null };
}

function functionCall(methodName, args) {
  return actions.functionCall(methodName, args, ATTACHED_GAS, ATTACHED_DEPOSIT);
}



const status = await rpc("status", []);
const protocolVersion = status?.protocol_version;
if (status?.chain_id !== "testnet") {
  fail(
    `${RPC_URL} reports chain_id ${JSON.stringify(status?.chain_id)}; this measurement is testnet-only, so point NEAR_RPC_URL at https://rpc.testnet.fastnear.com`,
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
    fck_allowance_consumed: FCK_ALLOWANCE_CONSUMED,
    receipts: null,
    gas_burnt: null,
    tokens_burnt: null,
    confirm_ms: null,
    index_ms: null,
    index_error: null,
    index_block_height: null,
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
    sample.index_error = "not checked: no transaction hash";
    reportFailure(sample, "submit", `no transaction hash (${describeError(settled)})`);
    continue;
  }
  sample.tx_hash = hash;

  // Poll the KV index in parallel with the FINAL confirmation so `index_ms` is the true
  // submit-to-visible latency, independent of `confirm_ms`.
  const indexToken = { cancelled: false };
  const indexPromise = waitForKey(hash, key, startedAt, indexToken);

  let final;
  try {
    final = await rpc("tx_status", {
      tx_hash: hash,
      sender_account_id: alice,
      wait_until: "FINAL",
    });
  } catch (error) {
    indexToken.cancelled = true;
    const indexResult = await indexPromise;
    sample.index_ms = indexResult.index_ms;
    sample.index_error = indexResult.index_error;
    sample.index_block_height = indexResult.index_block_height;
    reportFailure(sample, "tx_status", error.message);
    continue;
  }

  sample.confirm_ms = Math.round(performance.now() - startedAt);
  const indexResult = await indexPromise;
  sample.index_ms = indexResult.index_ms;
  sample.index_error = indexResult.index_error;
  sample.index_block_height = indexResult.index_block_height;

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
  const expectedFailure = EXPECTED_FASTDATA_FAILURES.find(name => failureReason?.includes(name)) ?? null;
  if (failureReason && !expectedFailure) {
    problems.push(`execution failed: ${failureReason}`);
  } else if (expectedFailure) {
    sample.expected_failure = expectedFailure;
  }
  if (problems.length > 0) {
    reportFailure(sample, "status", `${problems.join("; ")} (final_status ${JSON.stringify(sample.final_status)})`);
    continue;
  }

  sample.ok = true;
  const indexText = sample.index_ms === null ? `index unavailable (${sample.index_error})` : `indexed in ${sample.index_ms} ms`;
  console.error(
    `measure: ${index + 1}/${POST_COUNT} ${hash} gas ${sample.gas_burnt} tokens ${sample.tokens_burnt} confirm ${sample.confirm_ms} ms, ${indexText} (${sample.final_execution_status}${sample.expected_failure ? `, expected ${sample.expected_failure}` : ""})`,
  );
}

const successful = samples.filter(sample => sample.ok);
const indexed = successful.filter(sample => typeof sample.index_ms === "number");
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
        indexed_samples: indexed.length,
        index_unavailable_samples: successful.length - indexed.length,
        average_index_ms:
          indexed.length === 0
            ? null
            : Math.round(indexed.reduce((sum, sample) => sum + sample.index_ms, 0) / indexed.length),
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
  fck_allowance_consumed: FCK_ALLOWANCE_CONSUMED,
  kv_api_url: KV_API_URL,
  index_key_prefix: KV_KEY_PREFIX,
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
