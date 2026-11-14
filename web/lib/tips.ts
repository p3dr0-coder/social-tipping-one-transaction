import { teraToGas } from "near-api-js";
import { nearConfig } from "~~/near.config";
import { extractTxHash, isValidAccountId, type WalletConnection } from "./social";
import { delay, getRpcProvider } from "./shared.ts";

async function view<T>(contractId: string, method: string, args: Record<string, unknown> = {}): Promise<T> {
  const result = await getRpcProvider().callFunction({ contractId, method, args });
  if (result === undefined) {
    throw new Error(`${method} on ${contractId} returned no value`);
  }
  const value: unknown = result;
  // RPC boundary: callers name the view's return type.
  return value as T;
}

export async function getTipPreference(accountId: string): Promise<string> {
  return view<string>(nearConfig.philiaContract, "get_tip_preference", { account_id: accountId });
}

export async function getDefaultTip(): Promise<string> {
  return view<string>(nearConfig.philiaContract, "get_default_tip");
}

export type TipToken = {
  ftAccountId: string;
  decimals: number;
};

export async function getTipToken(): Promise<TipToken> {
  const [ftAccountId, decimals] = await view<[string, number]>(nearConfig.philiaContract, "get_tip_token");
  // The contract is the single source of truth; the env value is a deployment check only.
  if (nearConfig.tipFt && nearConfig.tipFt !== ftAccountId) {
    console.warn(
      `tips contract ${nearConfig.philiaContract} is bound to ${ftAccountId}, but NEXT_PUBLIC_PHILIA_TIP_FT is ${nearConfig.tipFt}`,
    );
  }
  return { ftAccountId, decimals };
}

type StorageBounds = {
  min: string;
  max: string | null;
};

/** Storage registration price read from the token itself; never a hardcoded amount. */
async function getStorageBounds(ftAccountId: string): Promise<StorageBounds> {
  const bounds = await view<{ min: string; max: string | null }>(ftAccountId, "storage_balance_bounds");
  return { min: bounds.min, max: bounds.max };
}

async function isRegistered(ftAccountId: string, accountId: string): Promise<boolean> {
  const balance = await view<{ total: string; available: string } | null>(ftAccountId, "storage_balance_of", {
    account_id: accountId,
  });
  return balance !== null;
}

/**
 * Converts a human decimal amount into NEP-141 base units with BigInt arithmetic.
 * Same grammar as the contract's parser: ASCII digits, one optional dot, no leading zeros,
 * at most 12 integer digits, at most `decimals` fractional digits, and a positive result.
 */
export function parseUnits(amount: string, decimals: number): bigint {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 38) {
    throw new Error(`unsupported token decimals: ${decimals}`);
  }
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

/**
 * Sends a NEP-141 tip.
 *
 * The amount comes from the author's on-chain preference (or an explicit override), the
 * token and decimals come from the tips contract, and the author is registered first only
 * when `storage_balance_of` returns null. Registration uses the token's own
 * `storage_balance_bounds.min`. The transfer attaches exactly 1 yoctoNEAR, so the
 * app-scoped function-call key cannot sign it and the wallet prompts instead.
 */
export async function sendTip(author: string, amount: string | null, wallet: WalletConnection): Promise<string> {
  if (!wallet.accountId) throw new Error("connect a wallet before tipping");
  if (!isValidAccountId(author)) throw new Error(`"${author}" is not a valid account id`);
  if (wallet.accountId === author) throw new Error("you cannot tip yourself");

  const [token, preference] = await Promise.all([getTipToken(), getTipPreference(author)]);
  const requested = amount?.trim() ?? "";
  const units = parseUnits(requested.length > 0 ? requested : preference, token.decimals);

  if (!(await isRegistered(token.ftAccountId, author))) {
    const bounds = await getStorageBounds(token.ftAccountId);
    await wallet.signAndSendTransaction({
      receiverId: token.ftAccountId,
      actions: [
        {
          type: "FunctionCall",
          params: {
            methodName: "storage_deposit",
            args: { account_id: author },
            gas: teraToGas("30").toString(),
            deposit: bounds.min,
          },
        },
      ],
    });
  }

  const settled = await wallet.signAndSendTransaction({
    receiverId: token.ftAccountId,
    actions: [
      {
        type: "FunctionCall",
        params: {
          methodName: "ft_transfer",
          args: {
            receiver_id: author,
            amount: units.toString(),
            memo: "tip via philia",
          },
          gas: "30000000000000",
          deposit: "1",
        },
      },
    ],
  });

  const hash = extractTxHash(settled);
  if (!hash) throw new Error("the tip transaction returned no hash");
  return hash;
}

export type TipQuote = {
  quote?: unknown;
  depositAddress?: string;
  amountIn?: string;
  amountOut?: string;
  deadline?: string;
};

let destinationAssetCheck: Promise<void> | null = null;

/** Confirms the hardcoded native-USDC asset id is still listed by 1Click `/v0/tokens`. */
async function assertDestinationAsset(): Promise<void> {
  if (!destinationAssetCheck) {
    destinationAssetCheck = (async () => {
      const response = await fetch(nearConfig.oneClickTokensUrl, { headers: { accept: "application/json" } });
      if (!response.ok) throw new Error(`1Click token list failed: ${response.status}`);
      const tokens: unknown = await response.json();
      if (!Array.isArray(tokens)) throw new Error("1Click token list is not an array");
      const listed = tokens.some(
        token =>
          token !== null &&
          typeof token === "object" &&
          "assetId" in token &&
          token.assetId === nearConfig.mainnetUsdcAssetId,
      );
      if (!listed) {
        throw new Error(`1Click no longer lists ${nearConfig.mainnetUsdcAssetId} as a destination asset`);
      }
    })().catch(error => {
      destinationAssetCheck = null;
      throw error;
    });
  }
  return destinationAssetCheck;
}

/**
 * Optional cross-chain tip: a dry 1Click quote that settles into native USDC on NEAR.
 * `dry: true` returns a quote and a deposit address without moving funds.
 */
export async function quoteTip(params: {
  originAsset: string;
  amount: string;
  recipient: string;
  refundTo: string;
}): Promise<TipQuote> {
  await assertDestinationAsset();
  if (!/^\d+$/.test(params.amount) || params.amount === "0") {
    throw new Error("the 1Click amount must be a positive integer string in origin base units");
  }
  const response = await fetch(nearConfig.oneClickQuoteUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      dry: true,
      originAsset: params.originAsset,
      destinationAsset: nearConfig.mainnetUsdcAssetId,
      amount: params.amount,
      recipient: params.recipient,
      recipientType: "DESTINATION_CHAIN",
      refundTo: params.refundTo,
      refundType: "ORIGIN_CHAIN",
      deadline: new Date(Date.now() + 10 * 60 * 1_000).toISOString(),
    }),
  });
  if (!response.ok) {
    throw new Error(`1Click quote failed: ${response.status} ${await response.text()}`);
  }
  const payload: unknown = await response.json();
  return payload as TipQuote;
}

/**
 * 1Click's fee schedule in basis points: unauthenticated quotes pay the default rate,
 * authenticated quotes pay the lower one, and stablecoin-to-stablecoin pairs the smallest.
 */
export const ONECLICK_FEES = {
  unauthenticatedBps: 25,
  authenticatedBps: 20,
  stablecoinBps: 1,
} as const;

export type OneClickSwapDetails = {
  intentHashes?: string[];
  nearTxHashes?: string[];
  amountIn?: string;
  amountInFormatted?: string;
  amountOut?: string;
  amountOutFormatted?: string;
  depositedAmount?: string;
  refundedAmount?: string;
  refundedAmountFormatted?: string;
  refundReason?: string;
};

/**
 * `GET /v0/status` result. The documented `swapDetails.nearTxHashes` list is flattened onto
 * the top level so callers can poll shield/unshield hashes without walking the response.
 */
export type OneClickStatus = {
  status: string;
  nearTxHashes: string[];
  swapDetails?: OneClickSwapDetails;
};

export type OneClickPollOptions = {
  timeoutMs?: number;
  intervalMs?: number;
};

const STATUS_URL = "https://1click.chaindefuser.com/v0/status";
const POLL_TIMEOUT_MS = 10 * 60 * 1_000;
const POLL_INTERVAL_MS = 5_000;
const TERMINAL_STATUSES: Record<string, true> = {
  SUCCESS: true,
  INCOMPLETE_DEPOSIT: true,
  REFUNDED: true,
  FAILED: true,
};

type OneClickStatusResponse = {
  status?: string;
  nearTxHashes?: string[];
  swapDetails?: OneClickSwapDetails | null;
};


export async function getOneClickStatus(depositAddress: string): Promise<OneClickStatus> {
  const address = depositAddress.trim();
  if (address.length === 0) throw new Error("a 1Click deposit address is required");

  const url = new URL(STATUS_URL);
  url.searchParams.set("depositAddress", address);
  const response = await fetch(url, { headers: { accept: "application/json" } });
  if (!response.ok) {
    throw new Error(`1Click status failed: ${response.status} ${await response.text()}`);
  }
  const payload: unknown = await response.json();
  if (payload === null || typeof payload !== "object") {
    throw new Error("1Click status response has no status");
  }
  // 1Click boundary: `nearTxHashes` normally sits under `swapDetails`.
  const record = payload as OneClickStatusResponse;
  if (typeof record.status !== "string" || record.status.length === 0) {
    throw new Error("1Click status response has no status");
  }
  return {
    status: record.status,
    nearTxHashes: record.nearTxHashes ?? record.swapDetails?.nearTxHashes ?? [],
    swapDetails: record.swapDetails ?? undefined,
  };
}

/**
 * Polls `/v0/status` until the swap reaches a terminal state. Resolves with the `SUCCESS`
 * status, whose `nearTxHashes` are the shield/unshield transactions for a confidential swap;
 * throws on `FAILED`, `REFUNDED`, `INCOMPLETE_DEPOSIT`, and timeout.
 */
export async function pollOneClickStatus(
  depositAddress: string,
  options: OneClickPollOptions = {},
): Promise<OneClickStatus> {
  const timeoutMs = options.timeoutMs ?? POLL_TIMEOUT_MS;
  const intervalMs = options.intervalMs ?? POLL_INTERVAL_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error("timeoutMs must be a positive number");
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) throw new Error("intervalMs must be a positive number");

  const deadline = Date.now() + timeoutMs;
  let lastStatus = "unknown";
  for (;;) {
    const status = await getOneClickStatus(depositAddress);
    lastStatus = status.status;
    if (status.status === "SUCCESS") return status;
    if (TERMINAL_STATUSES[status.status]) {
      const detail = status.swapDetails?.refundReason ?? status.swapDetails?.refundedAmountFormatted;
      throw new Error(`1Click swap ended ${status.status} for ${depositAddress}${detail ? ` (${detail})` : ""}`);
    }

    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      throw new Error(`1Click status polling timed out after ${timeoutMs} ms (last status ${lastStatus})`);
    }
    await delay(Math.min(intervalMs, remaining));
  }
}
