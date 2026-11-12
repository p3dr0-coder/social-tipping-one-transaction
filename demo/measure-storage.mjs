#!/usr/bin/env node
/**
 * Storage measurement: what `set_tip_preference` costs on testnet.
 *
 * Runs three writes against `PHILIA_CONTRACT` with the BOB key (ALICE is the fallback):
 *   1. growth        - a 27-character, 24-decimal amount, deposited with 0.01 NEAR
 *   2. equal update  - same character length, so the stored record does not change size
 *   3. shorter update - 4 characters, so the record shrinks and the freed bytes are refunded
 *
 * Before each write the contract account's `storage_usage` is read with RPC
 * `query`/`view_account`; after the transaction reaches `FINAL` it is read again. The byte
 * delta multiplied by the protocol's `storage_amount_per_byte` (1e19 yocto on testnet) is the
 * storage cost. The transaction's receipts supply `gas_burnt` and `tokens_burnt`, and Transfer
 * receipts to the signer supply the refund actually delivered (gas refund included). Progress
 * goes to stderr; the JSON summary goes to stdout; any failed sample exits non-zero.
 */
import { Account, JsonRpcProvider, actions, teraToGas } from "near-api-js";
import {
  createRpc,
  describeError,
  failureReason as failureReasonOf,
  finalStatusName,
  transactionHash,
} from "./lib/near-rpc.mjs";

const NETWORK = (process.env.PHILIA_NETWORK ?? "testnet").trim().toLowerCase();
const RPC_URL = process.env.NEAR_RPC_URL ?? "https://rpc.testnet.near.org";
const CONTRACT = (process.env.PHILIA_CONTRACT ?? "").trim();
const ATTACHED_GAS = teraToGas("30");
const DEPOSIT = 10n ** 22n; // 0.01 NEAR
const LONG_AMOUNT = "12.000000000000000000000001";
const UPDATE_AMOUNT = "13.000000000000000000000002";
const SHORTER_AMOUNT = "13.5";
const YOCTO_PER_NEAR = 10n ** 24n;
const EXPECTED_STORAGE_BYTE_COST = 10n ** 19n;

function fail(message) {
  console.error(`measure-storage: ${message}`);
  process.exit(1);
}

function formatNear(yocto) {
  const value = BigInt(yocto);
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const whole = absolute / YOCTO_PER_NEAR;
  const fraction = (absolute % YOCTO_PER_NEAR).toString().padStart(24, "0").replace(/0+$/, "");
  return `${negative ? "-" : ""}${whole}${fraction ? `.${fraction}` : ""}`;
}

if (NETWORK !== "testnet") {
  fail(
    `measure-storage.mjs records the testnet baseline only; PHILIA_NETWORK=${JSON.stringify(process.env.PHILIA_NETWORK)} is not testnet — unset it or set it to testnet`,
  );
}
if (!CONTRACT) {
  fail(
    "PHILIA_CONTRACT is not set; export PHILIA_CONTRACT=tips.philia.testnet (the deployed tip-preferences contract)",
  );
}
if (/mainnet/i.test(RPC_URL) || CONTRACT.toLowerCase().endsWith(".near")) {
  fail(
    `this measurement is testnet-only; point NEAR_RPC_URL at https://rpc.testnet.near.org and PHILIA_CONTRACT at a *.testnet contract (got ${JSON.stringify(CONTRACT)})`,
  );
}
if (LONG_AMOUNT.length !== UPDATE_AMOUNT.length) {
  fail("the growth and equal-update amounts must have the same character length for the storage test");
}

const bobAccount = process.env.BOB_ACCOUNT;
const bobKey = process.env.BOB_PRIVATE_KEY;
const aliceAccount = process.env.ALICE_ACCOUNT;
const aliceKey = process.env.ALICE_PRIVATE_KEY;

let signer;
let signerKey;
let signerSource;
if (bobAccount && bobKey) {
  signer = bobAccount;
  signerKey = bobKey;
  signerSource = "BOB_ACCOUNT/BOB_PRIVATE_KEY";
} else if (bobAccount && !bobKey) {
  fail("BOB_ACCOUNT is set but BOB_PRIVATE_KEY is missing; export both, or unset BOB_ACCOUNT to fall back to ALICE");
} else if (!bobAccount && bobKey) {
  fail("BOB_PRIVATE_KEY is set but BOB_ACCOUNT is missing; export both, or unset the key");
} else if (aliceAccount && aliceKey) {
  signer = aliceAccount;
  signerKey = aliceKey;
  signerSource = "ALICE_ACCOUNT/ALICE_PRIVATE_KEY fallback";
} else {
  fail(
    "export BOB_ACCOUNT and BOB_PRIVATE_KEY (or ALICE_ACCOUNT and ALICE_PRIVATE_KEY) before measuring",
  );
}
if (signer.toLowerCase().endsWith(".near")) {
  fail(`signer ${JSON.stringify(signer)} is a mainnet account id; use a *.testnet account`);
}
if (signer.toLowerCase() === CONTRACT.toLowerCase()) {
  fail("the signer must be an end-user account, not PHILIA_CONTRACT itself");
}

const provider = new JsonRpcProvider({ url: RPC_URL });
const account = new Account(signer, provider, signerKey);

const rpc = createRpc(RPC_URL);



async function viewFunction(methodName, args) {
  const result = await rpc("query", {
    request_type: "call_function",
    finality: "final",
    account_id: CONTRACT,
    method_name: methodName,
    args_base64: Buffer.from(JSON.stringify(args)).toString("base64"),
  });
  const bytes = Array.isArray(result?.result) ? result.result : [];
  const text = Buffer.from(bytes).toString("utf8");
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function storageUsage() {
  const view = await rpc("query", {
    request_type: "view_account",
    finality: "final",
    account_id: CONTRACT,
  });
  const usage = Number(view?.storage_usage);
  if (!Number.isSafeInteger(usage) || usage < 0) {
    throw new Error(`view_account ${CONTRACT} returned storage_usage ${JSON.stringify(view?.storage_usage)}`);
  }
  return usage;
}

function transferReceiptsTo(final, receiver) {
  const receipts = Array.isArray(final?.receipts) ? final.receipts : [];
  const transfers = [];
  for (const entry of receipts) {
    if (entry?.receiver_id !== receiver) continue;
    const actionList = entry?.receipt?.Action?.actions;
    if (!Array.isArray(actionList)) continue;
    for (const action of actionList) {
      const deposit = action?.Transfer?.deposit;
      if (deposit === undefined || deposit === null) continue;
      transfers.push({
        receipt_id: entry.receipt_id ?? null,
        predecessor_id: entry.predecessor_id ?? null,
        deposit_yocto: String(deposit),
      });
    }
  }
  return transfers;
}

/**
 * Signs and submits one function call, then waits for RPC `tx_status` at `FINAL`. Throws on a
 * missing hash, a non-FINAL execution status, or an execution failure so the sample is marked
 * failed with the reason.
 */
async function submit(methodName, args, deposit) {
  const startedAt = performance.now();
  let settled;
  try {
    settled = await account.signAndSendTransaction({
      receiverId: CONTRACT,
      actions: [actions.functionCall(methodName, args, ATTACHED_GAS, deposit)],
      waitUntil: "INCLUDED",
      throwOnFailure: false,
    });
  } catch (error) {
    settled = error;
  }

  const txHash = transactionHash(settled);
  if (!txHash) {
    throw new Error(`submit ${methodName}: no transaction hash (${describeError(settled)})`);
  }

  let final;
  try {
    final = await rpc("tx_status", {
      tx_hash: txHash,
      sender_account_id: signer,
      wait_until: "FINAL",
    });
  } catch (error) {
    throw new Error(`tx_status ${txHash}: ${error.message}`);
  }

  const confirmMs = Math.round(performance.now() - startedAt);
  const finalExecutionStatus = final?.final_execution_status ?? null;
  const finalStatus = finalStatusName(final);
  const failureReason = failureReasonOf(final);
  if (finalExecutionStatus !== "FINAL") {
    throw new Error(
      `tx ${txHash}: final_execution_status ${JSON.stringify(finalExecutionStatus)}, expected "FINAL"`,
    );
  }
  if (failureReason) {
    throw new Error(`tx ${txHash} failed: ${failureReason}`);
  }

  const outcomes = Array.isArray(final?.receipts_outcome) ? final.receipts_outcome : [];
  const receiptGas = outcomes.reduce((sum, receipt) => sum + Number(receipt?.outcome?.gas_burnt ?? 0), 0);
  const receiptTokens = outcomes.reduce(
    (sum, receipt) => sum + BigInt(receipt?.outcome?.tokens_burnt ?? "0"),
    0n,
  );
  // `transaction_outcome.outcome` is the signature fee; `outcomes_agg.transaction_fee` is the
  // fallback for RPC deployments that aggregate it. Never add both.
  const fee = final?.transaction_outcome?.outcome ?? final?.outcomes_agg?.transaction_fee ?? {};

  return {
    tx_hash: txHash,
    confirm_ms: confirmMs,
    final_execution_status: finalExecutionStatus,
    final_status: finalStatus,
    receipts: outcomes.length,
    gas_burnt: receiptGas + Number(fee?.gas_burnt ?? 0),
    tokens_burnt: (receiptTokens + BigInt(fee?.tokens_burnt ?? "0")).toString(),
    transfer_receipts: transferReceiptsTo(final, signer),
  };
}

const status = await rpc("status", []);
const protocolVersion = status?.protocol_version;
if (status?.chain_id !== "testnet") {
  fail(
    `${RPC_URL} reports chain_id ${JSON.stringify(status?.chain_id)}; this measurement is testnet-only, so point NEAR_RPC_URL at https://rpc.testnet.near.org`,
  );
}
console.error(`measure-storage: ${RPC_URL} protocol ${protocolVersion}, ${CONTRACT}, signer ${signer} (${signerSource})`);

let protocolConfig;
try {
  protocolConfig = await rpc("EXPERIMENTAL_protocol_config", { finality: "final" });
} catch (error) {
  fail(`cannot read EXPERIMENTAL_protocol_config from ${RPC_URL}: ${error.message}`);
}
const storageByteCost = BigInt(protocolConfig?.runtime_config?.storage_amount_per_byte ?? "0");
if (storageByteCost <= 0n) {
  fail(
    `EXPERIMENTAL_protocol_config returned storage_amount_per_byte ${JSON.stringify(protocolConfig?.runtime_config?.storage_amount_per_byte)}; expected a positive yocto value`,
  );
}

let tipToken;
try {
  tipToken = await viewFunction("get_tip_token", {});
} catch (error) {
  fail(`cannot call get_tip_token on ${CONTRACT}: ${error.message}`);
}
if (!Array.isArray(tipToken) || tipToken.length !== 2) {
  fail(`get_tip_token on ${CONTRACT} returned ${JSON.stringify(tipToken)}; expected ["<ft account>", <decimals>]`);
}
const [tipTokenAccount, decimals] = tipToken;
if (!Number.isInteger(decimals) || decimals < 24) {
  fail(
    `contract ${CONTRACT} prices tips in ${JSON.stringify(tipTokenAccount)} with ${JSON.stringify(decimals)} decimals; the ${LONG_AMOUNT} sample needs at least 24 decimals`,
  );
}

let preferenceBefore;
try {
  preferenceBefore = await viewFunction("get_tip_preference", { account_id: signer });
} catch (error) {
  fail(`cannot call get_tip_preference on ${CONTRACT}: ${error.message}`);
}

// Reset the signer's own entry so the first measured write is a pure insert. The call is
// idempotent: with no stored preference the contract is a no-op that only burns gas.
let cleanupStorageBefore;
try {
  cleanupStorageBefore = await storageUsage();
} catch (error) {
  fail(`cannot read storage_usage of ${CONTRACT} before resetting the preference: ${error.message}`);
}
let cleanup;
try {
  cleanup = await submit("remove_tip_preference", {}, 0n);
} catch (error) {
  fail(`cannot reset the signer's tip preference before measuring: ${error.message}`);
}
const cleanupStorageAfter = await storageUsage();
const cleanupTransferTotal = cleanup.transfer_receipts.reduce(
  (sum, transfer) => sum + BigInt(transfer.deposit_yocto),
  0n,
);

const preparation = {
  method: "remove_tip_preference",
  deposit_yocto: "0",
  preference_before: preferenceBefore,
  storage_before: cleanupStorageBefore,
  storage_after: cleanupStorageAfter,
  removed_bytes: Math.max(cleanupStorageBefore - cleanupStorageAfter, 0),
  tx_hash: cleanup.tx_hash,
  gas_burnt: cleanup.gas_burnt,
  tokens_burnt: cleanup.tokens_burnt,
  refund_receipts: cleanup.transfer_receipts,
  refund_receipts_total_yocto: cleanupTransferTotal.toString(),
};

async function measureCase(name, amount, expectation) {
  const result = {
    case: name,
    method: "set_tip_preference",
    amount,
    amount_chars: amount.length,
    deposit_yocto: DEPOSIT.toString(),
    deposit_near: formatNear(DEPOSIT),
    attached_gas: ATTACHED_GAS.toString(),
    storage_before: null,
    storage_after: null,
    net_bytes: null,
    bytes_grown: null,
    bytes_freed: null,
    storage_cost_yocto: null,
    cost_near: null,
    refunded_excess_yocto: null,
    refunded_excess_near: null,
    refund_receipts_total_yocto: null,
    refund_receipts_total_near: null,
    refund_receipts: [],
    gas_burnt: null,
    tokens_burnt: null,
    tokens_burnt_near: null,
    confirm_ms: null,
    tx_hash: null,
    final_execution_status: null,
    final_status: null,
    stored_value: null,
    stored_value_matches: null,
    ok: false,
    error: null,
  };

  try {
    const before = await storageUsage();
    result.storage_before = before;

    const tx = await submit("set_tip_preference", { amount }, DEPOSIT);
    result.tx_hash = tx.tx_hash;
    result.confirm_ms = tx.confirm_ms;
    result.final_execution_status = tx.final_execution_status;
    result.final_status = tx.final_status;
    result.gas_burnt = tx.gas_burnt;
    result.tokens_burnt = tx.tokens_burnt;
    result.tokens_burnt_near = formatNear(BigInt(tx.tokens_burnt));
    result.refund_receipts = tx.transfer_receipts;

    const after = await storageUsage();
    result.storage_after = after;
    const net = after - before;
    const grown = Math.max(net, 0);
    const freed = Math.max(-net, 0);
    const grownYocto = BigInt(grown) * storageByteCost;
    const freedYocto = BigInt(freed) * storageByteCost;
    const refundExpected = DEPOSIT - grownYocto + freedYocto;
    const refundObserved = tx.transfer_receipts.reduce(
      (sum, transfer) => sum + BigInt(transfer.deposit_yocto),
      0n,
    );

    result.net_bytes = net;
    result.bytes_grown = grown;
    result.bytes_freed = freed;
    result.storage_cost_yocto = grownYocto.toString();
    result.cost_near = formatNear(grownYocto);
    result.refunded_excess_yocto = refundExpected.toString();
    result.refunded_excess_near = formatNear(refundExpected);
    result.refund_receipts_total_yocto = refundObserved.toString();
    result.refund_receipts_total_near = formatNear(refundObserved);

    const stored = await viewFunction("get_tip_preference", { account_id: signer });
    result.stored_value = typeof stored === "string" ? stored : JSON.stringify(stored);
    result.stored_value_matches = result.stored_value === amount;

    const problems = [];
    if (expectation === "growth" && net <= 0) {
      problems.push(`expected storage to grow on the first insert, net_bytes is ${net}`);
    }
    if (expectation === "equal" && net !== 0) {
      problems.push(`expected an equal-length update to leave storage unchanged, net_bytes is ${net}`);
    }
    if (expectation === "shrink" && net >= 0) {
      problems.push(`expected a shorter update to free bytes, net_bytes is ${net}`);
    }
    if (DEPOSIT < grownYocto) {
      problems.push(
        `deposit ${formatNear(DEPOSIT)} NEAR does not cover ${formatNear(grownYocto)} NEAR of growth`,
      );
    }
    if (refundObserved < refundExpected) {
      problems.push(
        `refund receipts total ${formatNear(refundObserved)} NEAR but the contract formula owes ${formatNear(refundExpected)} NEAR`,
      );
    }
    if (!result.stored_value_matches) {
      problems.push(`stored preference ${JSON.stringify(result.stored_value)} does not match ${JSON.stringify(amount)}`);
    }
    if (problems.length > 0) {
      result.error = problems.join("; ");
      console.error(`measure-storage: case ${name} FAILED (tx ${tx.tx_hash}): ${result.error}`);
      return result;
    }

    result.ok = true;
    console.error(
      `measure-storage: ${name} ${tx.tx_hash} net ${net} B (grown ${grown}, freed ${freed}), gas ${tx.gas_burnt}, tokens ${formatNear(BigInt(tx.tokens_burnt))} NEAR, refund ${formatNear(refundObserved)} NEAR`,
    );
    return result;
  } catch (error) {
    result.error = error.message;
    console.error(`measure-storage: case ${name} FAILED: ${error.message}`);
    return result;
  }
}

const cases = [];
cases.push(await measureCase("growth", LONG_AMOUNT, "growth"));
cases.push(await measureCase("equal_length_update", UPDATE_AMOUNT, "equal"));
cases.push(await measureCase("shorter_update", SHORTER_AMOUNT, "shrink"));

const growth = cases[0];
const failures = cases
  .filter(sample => !sample.ok)
  .map(sample => ({
    case: sample.case,
    tx_hash: sample.tx_hash,
    stage: sample.tx_hash ? "verify" : "submit",
    error: sample.error,
  }));

const checks = {
  growth_charged_bytes: growth.ok && growth.net_bytes > 0,
  equal_length_update_is_free: cases[1].ok && cases[1].net_bytes === 0,
  shorter_update_refunded_freed_bytes: cases[2].ok && cases[2].bytes_freed > 0,
  refund_receipts_cover_contract_formula: cases.every(
    sample => !sample.ok || BigInt(sample.refund_receipts_total_yocto) >= BigInt(sample.refunded_excess_yocto),
  ),
  storage_byte_cost_is_1e19_yocto: storageByteCost === EXPECTED_STORAGE_BYTE_COST,
};

const totalGas = cases.reduce((sum, sample) => sum + (sample.gas_burnt ?? 0), 0);
const totalTokens = cases.reduce(
  (sum, sample) => sum + (sample.tokens_burnt === null ? 0n : BigInt(sample.tokens_burnt)),
  0n,
);
const totalRefund = cases.reduce(
  (sum, sample) =>
    sum + (sample.refund_receipts_total_yocto === null ? 0n : BigInt(sample.refund_receipts_total_yocto)),
  0n,
);

const summary = {
  network: "testnet",
  rpc_url: RPC_URL,
  contract: CONTRACT,
  signer,
  signer_source: signerSource,
  tip_token: tipTokenAccount,
  decimals,
  protocol_version: protocolVersion,
  protocol_config_version: protocolConfig?.protocol_version ?? null,
  generated_at: new Date().toISOString(),
  storage_byte_cost_yocto: storageByteCost.toString(),
  storage_byte_cost_near: formatNear(storageByteCost),
  cost_per_kb_near: formatNear(storageByteCost * 1024n),
  attached_gas: ATTACHED_GAS.toString(),
  attached_deposit_yocto: DEPOSIT.toString(),
  attached_deposit_near: formatNear(DEPOSIT),
  preference_before: preferenceBefore,
  preparation,
  bytes_grown: growth.bytes_grown,
  cost_near: growth.cost_near,
  gas_burnt: growth.gas_burnt,
  tokens_burnt: growth.tokens_burnt,
  cases,
  checks,
  totals: {
    cases_ok: cases.filter(sample => sample.ok).length,
    cases_failed: failures.length,
    gas_burnt: totalGas,
    tokens_burnt: totalTokens.toString(),
    refund_receipts_total_yocto: totalRefund.toString(),
    refund_receipts_total_near: formatNear(totalRefund),
  },
  failures,
};

console.log(JSON.stringify(summary, null, 2));

if (failures.length > 0) {
  console.error(
    `measure-storage: ${failures.length} of ${cases.length} cases failed; see failures[] for the failing hash and reason`,
  );
  process.exitCode = 1;
}
