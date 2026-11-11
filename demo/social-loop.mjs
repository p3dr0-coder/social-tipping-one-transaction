#!/usr/bin/env node
/**
 * Zero-funds testnet loop: profile -> post -> follow -> reads -> NEP-141 tip.
 *
 * Every write is signed by an account funded from the testnet faucet and the parent
 * account; the script never needs mainnet funds. It refuses to run when a required
 * variable is missing or when the target looks like mainnet.
 */
import { Account, Action, FunctionCall, JsonRpcProvider } from "near-api-js";

const REQUIRED_ENV = [
  "ALICE_ACCOUNT",
  "ALICE_PRIVATE_KEY",
  "BOB_ACCOUNT",
  "PHILIA_CONTRACT",
  "TIP_FT",
  "SOCIALDB_CONTRACT_ID",
];

const RPC_URL = process.env.NEAR_RPC_URL ?? "https://rpc.testnet.near.org";

const GAS_30_TGAS = 30n * 10n ** 12n;
const GAS_100_TGAS = 100n * 10n ** 12n;
const SOCIALDB_STORAGE_DEPOSIT = 10n ** 22n;

function fail(message) {
  console.error(`social-loop: ${message}`);
  process.exit(1);
}

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

if (RPC_URL.includes("mainnet") || philiaContract.endsWith(".near")) {
  fail("this demo is testnet-only; point NEAR_RPC_URL and PHILIA_CONTRACT at testnet");
}

const provider = new JsonRpcProvider({ url: RPC_URL });
const aliceAccount = new Account(alice, provider, process.env.ALICE_PRIVATE_KEY);

function functionCall(methodName, args, gas, deposit) {
  return new Action({
    functionCall: new FunctionCall({
      methodName,
      args: new TextEncoder().encode(JSON.stringify(args)),
      gas,
      deposit,
    }),
  });
}

async function send(receiverId, actions) {
  const result = await aliceAccount.signAndSendTransaction({ receiverId, actions, waitUntil: "FINAL" });
  const hash = result?.transaction_outcome?.id ?? result?.transaction?.hash ?? "unknown";
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

console.log(`philia zero-funds loop on ${RPC_URL}`);
console.log(`  alice ${alice}`);
console.log(`  bob   ${bob}`);

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

console.log("4. read the post and the follower list");
const ownPost = await view(socialDbContract, "get", { keys: [`${alice}/post/main`] });
const followers = await view(socialDbContract, "keys", {
  keys: [`*/graph/follow/${alice}`],
  options: { return_type: "BlockHeight", values_only: true },
});
console.log(`  post indexed: ${ownPost?.[alice]?.post?.main ?? "missing"}`);
console.log(`  followers: ${JSON.stringify(followers ?? {})}`);

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
