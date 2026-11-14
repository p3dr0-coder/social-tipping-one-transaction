/**
 * Shared Node helpers for the testnet demo/measurement scripts.
 *
 * These scripts intentionally talk to raw JSON-RPC (they print receipt-level gas/token fields
 * and query `EXPERIMENTAL_protocol_config`), so this module centralizes the small pieces they
 * would otherwise duplicate: a JSON-RPC caller, a sleep, tx-hash/error extraction from
 * near-js results or thrown outcomes, and the float-free FT amount parser. No keys here.
 */

export function createRpc(rpcUrl) {
  let requestId = 0;

  return async function rpc(method, params) {
    requestId += 1;
    let response;
    try {
      response = await fetch(rpcUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: requestId, method, params }),
        signal: AbortSignal.timeout(20_000),
      });
    } catch (error) {
      throw new Error(`cannot reach ${rpcUrl}: ${error.message}`);
    }
    if (!response.ok) {
      throw new Error(`${rpcUrl} returned HTTP ${response.status}`);
    }
    let body;
    try {
      body = await response.json();
    } catch {
      throw new Error(`${rpcUrl} returned a non-JSON response`);
    }
    if (body.error) {
      throw new Error(`${method}: ${body.error.message ?? JSON.stringify(body.error)}`);
    }
    return body.result;
  };
}

export function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function transactionHash(value) {
  if (!value || typeof value !== "object") return null;
  const candidates = [
    value.transaction_outcome?.id,
    value.transaction?.hash,
    value.transactionHash,
    value.context?.transactionHash,
    value.transactionResult?.transaction_outcome?.id,
    value.transactionResult?.transaction?.hash,
    value.result?.transaction_outcome?.id,
    value.result?.transaction?.hash,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.length > 0) return candidate;
  }
  return null;
}

export function describeError(value) {
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

export function finalStatusName(final) {
  const status = final?.status;
  if (!status || typeof status !== "object") return null;
  return Object.keys(status)[0] ?? null;
}

export function failureReason(value) {
  const status = value?.status ?? value?.result?.status ?? value?.transactionResult?.status;
  if (!status || typeof status !== "object" || !("Failure" in status)) return null;
  try {
    return JSON.stringify(status.Failure);
  } catch {
    return "Failure";
  }
}

/** Float-free decimal parse against token decimals; mirrors the contract's parser. */
export function parseUnits(amount, decimals) {
  const match = /^(\d+)(?:\.(\d+))?$/.exec(amount);
  if (!match) throw new Error(`invalid amount "${amount}"`);
  const integer = match[1];
  const fraction = match[2] ?? "";
  if (integer !== "0" && integer.startsWith("0")) throw new Error("amount must not have leading zeros");
  if (integer.length > 12) throw new Error("integer part must be at most 12 digits");
  if (fraction.length > decimals) throw new Error(`amount has more than ${decimals} fractional digits`);
  const units = BigInt(integer) * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, "0") || "0");
  if (units <= 0n) throw new Error("amount must be greater than zero");
  return units;
}

/** Sums burnt gas and tokens across all receipts plus the transaction signature outcome. */
export function sumOutcomeFees(final) {
  const receipts = Array.isArray(final?.receipts_outcome) ? final.receipts_outcome : [];
  let gas = 0n;
  let tokens = 0n;
  for (const entry of receipts) {
    gas += BigInt(entry?.outcome?.gas_burnt ?? 0);
    tokens += BigInt(entry?.outcome?.tokens_burnt ?? 0);
  }
  const txFee = final?.transaction_outcome?.outcome ?? final?.outcomes_agg?.transaction_fee ?? {};
  gas += BigInt(txFee?.gas_burnt ?? 0);
  tokens += BigInt(txFee?.tokens_burnt ?? 0);
  return { receipts: receipts.length, gas, tokens };
}
