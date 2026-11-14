#!/usr/bin/env node
/**
 * Tip transaction measurement: one NEP-141 `ft_transfer` (1 yoctoNEAR deposit) on testnet,
 * queried with `tx_status` at FINAL. Records the transfer's `gas_burnt` and `tokens_burnt`
 * summed across `receipts_outcome`, plus the transaction fee exactly once, and the
 * submit-to-FINAL latency. Run it twice to confirm the number is stable.
 *
 * Env: ALICE_ACCOUNT/ALICE_PRIVATE_KEY (sender), BOB_ACCOUNT (receiver), TIP_FT (NEP-141),
 *      TIP_AMOUNT (human decimal, default 0.01), PHILIA_CONTRACT (tips contract for decimals).
 * No keys are stored in this file; nothing runs on mainnet.
 */
import { Account, JsonRpcProvider, actions, teraToGas } from "near-api-js";
import { createRpc, parseUnits, sumOutcomeFees, transactionHash } from "./lib/near-rpc.mjs";

const RPC_URL = process.env.NEAR_RPC_URL ?? "https://rpc.testnet.fastnear.com";
const NETWORK = (process.env.PHILIA_NETWORK ?? "testnet").trim().toLowerCase();
const TIP_GAS = teraToGas("30");
const TIP_DEPOSIT = 1n;
const AMOUNT = process.env.TIP_AMOUNT ?? "0.01";

function fail(message) {
  console.error(`measure-tip: ${message}`);
  process.exit(1);
}
if (NETWORK !== "testnet") fail(`testnet-only; PHILIA_NETWORK=${JSON.stringify(process.env.PHILIA_NETWORK)}`);
for (const name of ["ALICE_ACCOUNT", "ALICE_PRIVATE_KEY", "BOB_ACCOUNT", "TIP_FT"]) {
  if (!process.env[name]) fail(`missing ${name}`);
}
if (/mainnet/i.test(RPC_URL) || process.env.ALICE_ACCOUNT.endsWith(".near")) fail("mainnet target refused");

const rpc = createRpc(RPC_URL);

const provider = new JsonRpcProvider({ url: RPC_URL });
const account = new Account(process.env.ALICE_ACCOUNT, provider, process.env.ALICE_PRIVATE_KEY);
const meta = await provider.callFunction({
  contractId: process.env.TIP_FT,
  method: "ft_metadata",
  args: {},
});
const decimals = Number(meta?.decimals);
if (!Number.isInteger(decimals) || decimals < 0 || decimals > 24) fail(`bad ft_metadata.decimals ${decimals}`);
const amount = parseUnits(AMOUNT, decimals);

const sender = process.env.ALICE_ACCOUNT;
const receiver = process.env.BOB_ACCOUNT;
const startedAt = performance.now();
const settled = await account
  .signAndSendTransaction({
    receiverId: process.env.TIP_FT,
    actions: [actions.functionCall("ft_transfer", { receiver_id: receiver, amount: amount.toString(), memo: "tip via philia" }, TIP_GAS, TIP_DEPOSIT)],
    waitUntil: "INCLUDED",
    throwOnFailure: false,
  })
  .catch(error => error);
const hash = transactionHash(settled);
if (!hash) fail(`no transaction hash: ${JSON.stringify(settled).slice(0, 300)}`);

let final;
for (;;) {
  final = await rpc("tx_status", { tx_hash: hash, sender_account_id: sender, wait_until: "FINAL" });
  if (final?.final_execution_status === "FINAL") break;
  if (performance.now() - startedAt > 60_000) fail(`tx ${hash} not FINAL after 60 s`);
  await new Promise(resolve => setTimeout(resolve, 1_000));
}
const status = final?.status;
if (!status || typeof status !== "object" || !("SuccessValue" in status)) {
  fail(`tip failed: ${JSON.stringify(status).slice(0, 300)}`);
}

const { receipts, gas: gasBurnt, tokens: tokensBurnt } = sumOutcomeFees(final);

const summary = {
  network: "testnet",
  protocol_version: (await rpc("status", [])).protocol_version,
  rpc_url: RPC_URL,
  sender,
  receiver,
  tip_ft: process.env.TIP_FT,
  decimals,
  amount_base_units: amount.toString(),
  attached_gas: TIP_GAS.toString(),
  attached_deposit: TIP_DEPOSIT.toString(),
  tx_hash: hash,
  final_execution_status: final.final_execution_status,
  confirm_ms: Math.round(performance.now() - startedAt),
  receipts,
  gas_burnt: gasBurnt.toString(),
  tokens_burnt: tokensBurnt.toString(),
  tokens_burnt_near: (Number(tokensBurnt) / 1e24).toFixed(12),
};
console.log(JSON.stringify(summary, null, 2));
