#!/usr/bin/env node
/**
 * Social loop demo.
 *
 * Default (`PHILIA_NETWORK=testnet`): profile -> post -> follow -> reads -> NEP-141 tip
 * through the testnet SocialDB contract (`v1.social08.testnet`). Every write is signed by a
 * faucet-funded account; the script never needs mainnet funds.
 *
 * `PHILIA_NETWORK=mainnet`: profile -> post -> follow through `social.__fastdata_kv`
 * (1 Tgas, zero deposit), confirmed through `https://api2.near.social/v1/tx/{hash}` and read
 * back from `/v1/accounts/{id}/posts` and `/v1/accounts/{id}/following`. The tip is skipped
 * unless TIP_FT, BOB_ACCOUNT and PHILIA_CONTRACT are set, because mainnet tips spend real
 * funds. The private key stays in the environment; this file never contains one.
 */
import { Account, JsonRpcProvider, actions, teraToGas } from "near-api-js";

const NETWORK = (process.env.PHILIA_NETWORK ?? "testnet").trim().toLowerCase();
const RPC_URL =
  process.env.NEAR_RPC_URL ?? (NETWORK === "mainnet" ? "https://rpc.mainnet.near.org" : "https://rpc.testnet.near.org");
const SOCIAL_RECEIVER = "social";
const SOCIAL_API = "https://api2.near.social";
const CONFIRM_TIMEOUT_MS = 60_000;
const CONFIRM_INTERVAL_MS = 1_500;

const GAS_30_TGAS = 30n * 10n ** 12n;
const GAS_100_TGAS = 100n * 10n ** 12n;
// v1.social08.testnet `storage_balance_bounds.min` is 0.02 NEAR; pad to 0.05 so a
// profile + post + index payload fits and any surplus stays as the writer's storage balance.
const SOCIALDB_STORAGE_DEPOSIT = 5n * 10n ** 22n;

function fail(message) {
  console.error(`social-loop: ${message}`);
  process.exit(1);
}

if (NETWORK !== "testnet" && NETWORK !== "mainnet") {
  fail(
    `PHILIA_NETWORK must be "testnet" or "mainnet", received ${JSON.stringify(process.env.PHILIA_NETWORK)}; unset it to run the zero-funds testnet loop`,
  );
}

const REQUIRED_ENV =
  NETWORK === "testnet"
    ? ["ALICE_ACCOUNT", "ALICE_PRIVATE_KEY", "BOB_ACCOUNT", "PHILIA_CONTRACT", "TIP_FT", "SOCIALDB_CONTRACT_ID"]
    : ["ALICE_ACCOUNT", "ALICE_PRIVATE_KEY"];

for (const name of REQUIRED_ENV) {
  if (!process.env[name] || process.env[name].trim().length === 0) {
    fail(`missing ${name}; export the demo variables described in .env.example`);
  }
}

const alice = process.env.ALICE_ACCOUNT;
const bob = process.env.BOB_ACCOUNT;
const philiaContract = process.env.PHILIA_CONTRACT;
const tipFt = process.env.TIP_FT;
const socialDbContract = process.env.SOCIALDB_CONTRACT_ID;

function assertNetworkTarget() {
  const ids = [
    ["ALICE_ACCOUNT", alice],
    ["BOB_ACCOUNT", bob],
    ["PHILIA_CONTRACT", philiaContract],
    ["TIP_FT", tipFt],
    ["SOCIALDB_CONTRACT_ID", socialDbContract],
  ];

  if (NETWORK === "mainnet") {
    if (/testnet/i.test(RPC_URL)) {
      fail(
        `NEAR_RPC_URL=${RPC_URL} looks like testnet; remove it (the mainnet default is https://rpc.mainnet.near.org) or run with PHILIA_NETWORK=testnet`,
      );
    }
    for (const [name, value] of ids) {
      if (value && value.toLowerCase().endsWith(".testnet")) {
        fail(
          `${name}=${value} is a testnet id; unset testnet-only variables (SOCIALDB_CONTRACT_ID is not used on mainnet) or run with PHILIA_NETWORK=testnet`,
        );
      }
    }
    return;
  }

  if (/mainnet/i.test(RPC_URL)) {
    fail(
      `NEAR_RPC_URL=${RPC_URL} looks like mainnet; set it to https://rpc.testnet.near.org or run with PHILIA_NETWORK=mainnet`,
    );
  }
  for (const [name, value] of ids) {
    if (value && value.toLowerCase().endsWith(".near")) {
      fail(`${name}=${value} is a mainnet id; set a testnet value or run with PHILIA_NETWORK=mainnet`);
    }
  }
}

assertNetworkTarget();

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

let chainId;
try {
  chainId = (await rpc("status", []))?.chain_id;
} catch (error) {
  fail(`cannot read ${RPC_URL}: ${error.message}`);
}
if (chainId !== NETWORK) {
  fail(`${RPC_URL} reports chain_id ${JSON.stringify(chainId)}, but PHILIA_NETWORK=${NETWORK}; point NEAR_RPC_URL at ${NETWORK}`);
}

const provider = new JsonRpcProvider({ url: RPC_URL });
const aliceAccount = new Account(alice, provider, process.env.ALICE_PRIVATE_KEY);

function functionCall(methodName, args, gas, deposit) {
  return actions.functionCall(methodName, args, gas, deposit);
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
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

function extractTxHash(value) {
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

function failureReason(value) {
  const status = value?.status ?? value?.result?.status ?? value?.transactionResult?.status;
  if (!status || typeof status !== "object" || !("Failure" in status)) return null;
  try {
    return JSON.stringify(status.Failure);
  } catch {
    return "Failure";
  }
}

async function send(receiverId, actions) {
  let result;
  try {
    result = await aliceAccount.signAndSendTransaction({ receiverId, actions, waitUntil: "FINAL" });
  } catch (error) {
    throw new Error(`${receiverId} transaction failed: ${describeError(error)}`);
  }
  const hash = extractTxHash(result);
  if (!hash) {
    throw new Error(`${receiverId} transaction returned no hash: ${describeError(result)}`);
  }
  console.log(`  tx ${hash}`);
  return hash;
}

async function view(contractId, method, args) {
  return provider.callFunction({ contractId, method, args });
}

async function socialSet(data) {
  return send(socialDbContract, [
    functionCall("set", { data: { [alice]: data } }, GAS_100_TGAS, SOCIALDB_STORAGE_DEPOSIT),
  ]);
}

async function socialApi(path) {
  const url = `${SOCIAL_API}${path}`;
  let response;
  try {
    response = await fetch(url, { headers: { accept: "application/json" } });
  } catch (error) {
    throw new Error(`GET ${url} failed: ${error.message}`);
  }
  if (!response.ok) {
    const body = (await response.text()).slice(0, 300);
    throw new Error(`GET ${url} failed with HTTP ${response.status}: ${body || "(empty body)"}`);
  }
  try {
    return await response.json();
  } catch {
    throw new Error(`GET ${url} returned invalid JSON`);
  }
}

/**
 * Polls `/v1/tx/{hash}` until `indexed:true` and every `actions[].keys[].status` is `ok`.
 * `indexed` alone is not enough: a key can be `invalid`, `rate_limited`, `key_too_long` or
 * `value_too_large`, and an action can be `invalid_json`, `too_many_keys` or `invalid_borsh`.
 * Those statuses are surfaced with the key/action that produced them. The write is never
 * retried: `/v1/tx` keeps roughly the last 200k transactions, and a timeout means the demo
 * must inspect the hash and the read side instead of resending.
 */
async function confirmTx(hash) {
  const startedAt = Date.now();
  let attempts = 0;
  let lastPollError = null;

  for (;;) {
    attempts += 1;
    let response = null;
    try {
      response = await fetch(`${SOCIAL_API}/v1/tx/${encodeURIComponent(hash)}`, {
        headers: { accept: "application/json" },
      });
    } catch (error) {
      lastPollError = error;
    }

    if (response) {
      if (response.status === 404) {
        // The indexer has not seen the hash yet; keep polling.
      } else if (!response.ok) {
        const body = (await response.text()).slice(0, 300);
        throw new Error(`GET ${SOCIAL_API}/v1/tx/${hash} failed with HTTP ${response.status}: ${body || "(empty body)"}`);
      } else {
        let payload;
        try {
          payload = await response.json();
        } catch {
          throw new Error(`GET ${SOCIAL_API}/v1/tx/${hash} returned invalid JSON`);
        }
        if (payload?.indexed === true) {
          const actions = Array.isArray(payload.actions) ? payload.actions : [];
          const failedAction = actions.find(action => action && typeof action.status === "string" && action.status !== "ok");
          if (failedAction) {
            throw new Error(
              `social write ${hash} was indexed but its ${failedAction.kind ?? "unknown"} action reported ${failedAction.status}; inspect ${SOCIAL_API}/v1/tx/${hash}`,
            );
          }
          const keys = actions.flatMap(action => (Array.isArray(action?.keys) ? action.keys : []));
          const failedKey = keys.find(key => !key || key.status !== "ok");
          if (failedKey) {
            throw new Error(
              `social write ${hash} was indexed but key ${failedKey.key ?? "unknown"} reported ${failedKey.status ?? "missing"}${failedKey.reason ? ` (${failedKey.reason})` : ""}; inspect ${SOCIAL_API}/v1/tx/${hash}`,
            );
          }
          if (keys.length === 0) {
            throw new Error(
              `social write ${hash} reported indexed:true without any actions[].keys[] entries; cannot verify the write, inspect ${SOCIAL_API}/v1/tx/${hash}`,
            );
          }
          return { attempts, elapsedMs: Date.now() - startedAt };
        }
      }
    }

    if (Date.now() - startedAt > CONFIRM_TIMEOUT_MS) {
      const suffix = lastPollError ? ` (last poll error: ${lastPollError.message})` : "";
      throw new Error(
        `social write ${hash} was not indexed within ${CONFIRM_TIMEOUT_MS / 1_000} s${suffix}; the write may still land, and /v1/tx keeps roughly the last 200k txs, so check ${SOCIAL_API}/v1/tx/${hash} and the account feed before resending`,
      );
    }
    await delay(CONFIRM_INTERVAL_MS);
  }
}

/**
 * Mainnet FastData write. `social` has no contract code, so the receipt is expected to fail
 * with `CodeDoesNotExist`; that failure is success for this path. The hash is recovered from
 * the result or the thrown outcome, then confirmed against api2.
 */
async function kvWrite(data) {
  const keys = Object.keys(data);
  let settled;
  try {
    settled = await aliceAccount.signAndSendTransaction({
      receiverId: SOCIAL_RECEIVER,
      actions: [functionCall("__fastdata_kv", data, teraToGas("1"), 0n)],
      waitUntil: "INCLUDED",
      throwOnFailure: false,
    });
  } catch (error) {
    settled = error;
  }

  const hash = extractTxHash(settled);
  if (!hash) {
    throw new Error(`__fastdata_kv(${keys.join(", ")}) returned no transaction hash: ${describeError(settled)}`);
  }

  const rejection = failureReason(settled);
  if (rejection && !rejection.includes("CodeDoesNotExist")) {
    throw new Error(
      `__fastdata_kv tx ${hash} failed before indexing: ${rejection}; check the signing key, the access-key allowance and the attached gas`,
    );
  }

  console.log(`  tx ${hash} (${keys.length} key${keys.length === 1 ? "" : "s"})`);
  const confirmed = await confirmTx(hash);
  console.log(
    `  indexed in ${confirmed.elapsedMs} ms after ${confirmed.attempts} poll${confirmed.attempts === 1 ? "" : "s"}; every key is ok`,
  );
  return hash;
}

function parseUnits(amount, decimals) {
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

async function readAccountPosts(accountId) {
  const page = await socialApi(`/v1/accounts/${encodeURIComponent(accountId)}/posts?limit=50`);
  if (!Array.isArray(page?.items)) {
    throw new Error(
      `${SOCIAL_API}/v1/accounts/${accountId}/posts returned no items[] array; inspect that URL and the tx before resending`,
    );
  }
  return page.items;
}

async function readFollowing(accountId) {
  const ids = [];
  let cursor = null;
  for (let page = 0; page < 50; page += 1) {
    const query = new URLSearchParams({ limit: "100" });
    if (cursor) query.set("cursor", cursor);
    const payload = await socialApi(
      `/v1/accounts/${encodeURIComponent(accountId)}/following?${query.toString()}`,
    );
    const items = Array.isArray(payload?.items) ? payload.items : [];
    for (const item of items) {
      if (item?.account_id) ids.push(item.account_id);
    }
    if (!payload?.next_cursor) return ids;
    cursor = payload.next_cursor;
  }
  return ids;
}

/**
 * The NEAR faucet publishes no amount or cooldown, so a fresh account can briefly have no
 * spendable balance. Wait for the deposit instead of failing the first write.
 */
async function waitForFunds(accountId, minimumYocto, timeoutMs = 180_000) {
  const startedAt = Date.now();
  for (;;) {
    const account = await rpc("query", {
      request_type: "view_account",
      finality: "final",
      account_id: accountId,
    });
    if (BigInt(account.amount) >= minimumYocto) return;
    if (Date.now() - startedAt > timeoutMs) {
      fail(
        `${accountId} has ${account.amount} yocto after ${Math.round(timeoutMs / 1000)} s; fund it from the faucet and rerun`,
      );
    }
    console.log(`  waiting for faucet funds: ${accountId} has ${account.amount} yocto`);
    await delay(5_000);
  }
}

async function runTestnet() {
  console.log(`philia zero-funds loop on ${RPC_URL}`);
  console.log(`  alice ${alice}`);
  console.log(`  bob   ${bob}`);
  await waitForFunds(alice, 300_000_000_000_000_000_000_000n);
  console.log("1. profile");
  await socialSet({ profile: { name: "Alice", description: "philia demo account" } });

  console.log("2. post");
  const post = { text: `philia zero-funds demo ${new Date().toISOString()}`, type: "md" };
  await socialSet({
    post: { main: JSON.stringify(post) },
    index: { post: JSON.stringify({ key: "main", value: { type: "md" } }) },
  });

  console.log("3. follow");
  await socialSet({
    graph: { follow: { [bob]: "" } },
    index: { graph: JSON.stringify({ key: "follow", value: { type: "follow", accountId: bob } }) },
  });

  console.log("3b. follow tombstone (unfollow then follow again)");
  await socialSet({
    graph: { follow: { [bob]: null } },
    index: { graph: JSON.stringify({ key: "follow", value: { type: "unfollow", accountId: bob } }) },
  });
  const afterUnfollow = await view(socialDbContract, "get", { keys: [`${alice}/graph/follow/${bob}`] });
  if (afterUnfollow?.[alice]?.graph?.follow?.[bob] != null) {
    fail(`unfollow did not clear the edge: ${JSON.stringify(afterUnfollow)}`);
  }
  await socialSet({
    graph: { follow: { [bob]: "" } },
    index: { graph: JSON.stringify({ key: "follow", value: { type: "follow", accountId: bob } }) },
  });
  console.log("  tombstone cleared and the edge was restored");

  console.log("4. read the post and the follow edge");
  const ownPost = await view(socialDbContract, "get", { keys: [`${alice}/post/main`] });
  const followEdge = await view(socialDbContract, "get", { keys: [`${alice}/graph/follow/${bob}`] });
  console.log(`  post indexed: ${ownPost?.[alice]?.post?.main ?? "missing"}`);
  console.log(`  following edge: ${JSON.stringify(followEdge?.[alice]?.graph?.follow ?? {})}`);

  console.log("5. tip");
  const token = await view(philiaContract, "get_tip_token", {});
  const decimals = Array.isArray(token) ? token[1] : Number(token?.decimals);
  const metadata = await view(tipFt, "ft_metadata", {});
  const amount = parseUnits("0.1", Number(decimals ?? metadata.decimals));
  console.log(`  tip token ${tipFt} (${decimals ?? metadata.decimals} decimals), amount ${amount} base units`);

  const registration = await view(tipFt, "storage_balance_of", { account_id: bob });
  if (registration === null) {
    const bounds = await view(tipFt, "storage_balance_bounds", {});
    console.log(`  registering ${bob} with ${bounds.min} yocto`);
    await send(tipFt, [functionCall("storage_deposit", { account_id: bob }, GAS_30_TGAS, BigInt(bounds.min))]);
  }

  await send(tipFt, [
    functionCall(
      "ft_transfer",
      { receiver_id: bob, amount: amount.toString(), memo: "tip via philia" },
      GAS_30_TGAS,
      1n,
    ),
  ]);

  const bobBalance = await view(tipFt, "ft_balance_of", { account_id: bob });
  const bobPreference = await view(philiaContract, "get_tip_preference", { account_id: bob });
  console.log(`  bob balance: ${bobBalance}`);
  console.log(`  bob tip preference: ${bobPreference}`);

  console.log("done: a post indexed + a tip settled");
}

async function mainnetTip() {
  console.log("  mainnet tip: this sends real funds");
  const token = await view(philiaContract, "get_tip_token", {});
  if (!Array.isArray(token) || token.length < 2) {
    throw new Error(`get_tip_token on ${philiaContract} returned ${JSON.stringify(token)}; expected [account_id, decimals]`);
  }
  const [tokenId, tokenDecimals] = token;
  if (tokenId !== tipFt) {
    throw new Error(`PHILIA_CONTRACT prices tips in ${tokenId}, but TIP_FT is ${tipFt}; set TIP_FT to the contract's token`);
  }
  const decimals = Number(tokenDecimals);
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 24) {
    throw new Error(
      `get_tip_token on ${philiaContract} returned decimals ${JSON.stringify(tokenDecimals)}; expected an integer between 0 and 24`,
    );
  }
  const amount = parseUnits("0.1", decimals);
  console.log(`  tip token ${tipFt} (${decimals} decimals), amount ${amount} base units`);

  const registration = await view(tipFt, "storage_balance_of", { account_id: bob });
  if (registration === null) {
    const bounds = await view(tipFt, "storage_balance_bounds", {});
    console.log(`  registering ${bob} with ${bounds.min} yocto`);
    await send(tipFt, [functionCall("storage_deposit", { account_id: bob }, GAS_30_TGAS, BigInt(bounds.min))]);
  }

  await send(tipFt, [
    functionCall(
      "ft_transfer",
      { receiver_id: bob, amount: amount.toString(), memo: "tip via philia" },
      GAS_30_TGAS,
      1n,
    ),
  ]);

  const bobBalance = await view(tipFt, "ft_balance_of", { account_id: bob });
  const bobPreference = await view(philiaContract, "get_tip_preference", { account_id: bob });
  console.log(`  bob balance: ${bobBalance}`);
  console.log(`  bob tip preference: ${bobPreference}`);
}

async function runMainnet() {
  console.log(`philia mainnet social loop on ${RPC_URL}`);
  console.log(`  alice ${alice}`);
  console.log(`  bob   ${bob || "(unset: follow and tip skipped)"}`);

  const indexer = await socialApi("/v1/status");
  if (indexer?.chain_id !== "mainnet") {
    throw new Error(
      `${SOCIAL_API}/v1/status reports chain_id ${JSON.stringify(indexer?.chain_id)}; refusing to confirm mainnet writes against a non-mainnet indexer`,
    );
  }
  if (indexer?.social_account_id !== SOCIAL_RECEIVER) {
    throw new Error(
      `${SOCIAL_API}/v1/status reports social_account_id ${JSON.stringify(indexer?.social_account_id)}, expected ${JSON.stringify(SOCIAL_RECEIVER)}`,
    );
  }
  console.log(`  indexer ${SOCIAL_API} (${indexer.standard ?? "social-kv/1"}, lag ${indexer.lag_ms ?? "?"} ms)`);

  console.log("1. profile");
  await kvWrite({ "profile/name": "Alice", "profile/about": "philia demo account" });

  console.log("2. post");
  const postId = String(Date.now());
  const postText = `philia mainnet demo ${new Date().toISOString()}`;
  const postHash = await kvWrite({ [`post/${postId}`]: { text: postText } });

  console.log("3. follow");
  let followTarget = null;
  let followHash = null;
  if (bob) {
    followTarget = bob;
    followHash = await kvWrite({ [`graph/follow/${followTarget}`]: {} });
  } else {
    console.log("  skipped: set BOB_ACCOUNT to write a follow edge");
  }

  console.log("4. read the post and the following list");
  const posts = await readAccountPosts(alice);
  const ownPost = posts.find(item => {
    const post = item?.post;
    return (
      post &&
      (String(post.id) === postId || post.key === `${alice}/${postId}` || post.text === postText)
    );
  });
  if (!ownPost) {
    throw new Error(
      `post ${postId} (tx ${postHash}) is confirmed but absent from ${SOCIAL_API}/v1/accounts/${encodeURIComponent(alice)}/posts; inspect that URL and the tx before resending`,
    );
  }
  console.log(`  post indexed: ${ownPost.post.text ?? postText}`);
  const following = await readFollowing(alice);
  console.log(`  following: ${following.length > 0 ? following.join(", ") : "(none)"}`);
  if (followTarget && !following.includes(followTarget)) {
    throw new Error(
      `follow edge ${followTarget} (tx ${followHash}) is confirmed but absent from ${SOCIAL_API}/v1/accounts/${encodeURIComponent(alice)}/following; inspect that URL before resending`,
    );
  }

  console.log("5. tip");
  const missingTipEnv = [
    ["TIP_FT", tipFt],
    ["BOB_ACCOUNT", bob],
    ["PHILIA_CONTRACT", philiaContract],
  ]
    .filter(([, value]) => !value)
    .map(([name]) => name);
  if (missingTipEnv.length > 0) {
    console.log(`  skipped: set ${missingTipEnv.join(", ")} to tip on mainnet (tips spend real funds)`);
  } else {
    await mainnetTip();
  }

  console.log(
    missingTipEnv.length === 0 ? "done: a post indexed + a tip settled" : "done: a post indexed (tip skipped)",
  );
}

try {
  if (NETWORK === "mainnet") {
    await runMainnet();
  } else {
    await runTestnet();
  }
} catch (error) {
  fail(describeError(error));
}
