# philia — sovereign social on NEAR

philia is a small, fully on-chain social app. Profiles, posts, follow edges, and tip
preferences live in NEAR-native storage; there is no application database and no server-side
account system. A named NEAR account is the identity, the wallet is the login, and the social
graph is public data that any client can read.

The app ships with a Rust contract for tipping preferences and a zero-funds testnet demo that
walks the whole loop: set a profile, publish a post, follow someone, read the feed and the
follower list, and settle a tip.

## Architecture

| Layer | What it is |
|---|---|
| Social primitive | **near.social social DB (`social-kv/1` FastData KV + SocialDB)** |
| Writes (mainnet path) | `social.__fastdata_kv` with a 1 Tgas function call and no attached deposit; one key per entity (`post/{id}`, `graph/follow/{account}`, `profile/*`) |
| Reads (mainnet path) | `api2.near.social` feeds, profiles, search, suggestions, follower lists, and an SSE block stream |
| Writes/reads (testnet path) | SocialDB contract `v1.social08.testnet` through `near-social-js` for reads and a wallet-signed `set` call for writes |
| Media | FastFS upload to `social.__fastdata_fastfs`, referenced as `fastfs://{account}/social/{path}` |
| Tips | NEP-141 `ft_transfer` to the author, priced by the author's preference |
| Tip preferences | `philia-tips` contract on `philia.testnet`: a `LookupMap<AccountId, String>` with storage accounting, refunds, and NEP-297 events |
| Wallet | NEAR Connect, with a function-call access key for the two FastData methods |

A social write to the `social` receiver is a function call against an account that has **no
contract code**. The node answers `CodeDoesNotExist` by design: the write itself is valid and
the indexer picks it up. philia treats that answer as success and then proves it through
`GET /v1/tx/{hash}`. See [the confirmation rule](#codedoesnotexist-is-success) below.

The tips contract binds exactly one NEP-141 token per deployment. It stores the token account
and its decimals, validates every preference with a float-free decimal parser, charges the
caller for any storage the write grows, refunds freed bytes when a value shrinks, and emits
`PreferenceSet`, `PreferenceRemoved`, and `DefaultTipSet`.

## Repository layout

```
near-philia/
├── contract/          # philia-tips: units.rs, lib.rs, sandbox tests
├── web/               # philia-web: Next.js app, social/tips/fastfs libraries
├── demo/              # zero-funds testnet loop + measurement script
├── scripts/           # account creation and deployment
└── .env.example
```

## Quickstart

Prerequisites: Node.js >= 22.22.2, pnpm >= 10.4.1, Rust 1.95.0 with
`wasm32-unknown-unknown`, `cargo-near` 0.23.0, and `near-cli-rs` 0.31.1.

```bash
# 1. Install the JavaScript workspaces.
pnpm install

# 2. Configure the app. The template targets testnet and Circle testnet USDC.
cp .env.example web/.env.local

# 3. Create the testnet accounts (top-level from the faucet, sub-accounts from the parent).
bash scripts/create-accounts.sh

# 4. Build the contract and deploy it with its init call, then read the default tip back.
bash scripts/deploy.sh

# 5. Run the web app.
pnpm dev
```

The zero-funds demo runs the social loop against testnet. Export the demo keys in your shell
(never in a file that git tracks), then:

```bash
export ALICE_ACCOUNT=alice.philia.testnet
export ALICE_PRIVATE_KEY=...          # from your local keystore or wallet export
export BOB_ACCOUNT=bob.philia.testnet
export PHILIA_CONTRACT=philia.testnet
export TIP_FT=3e2210e1184b45b64c8a434c0a7e7b23cc04ea7eb7a6c3c32520d03d4afcb8af
export SOCIALDB_CONTRACT_ID=v1.social08.testnet
node demo/social-loop.mjs
```

Expected result, printed transaction by transaction: **a post indexed + a tip settled**, with
the profile write, post write, follow edge, feed/follower reads, and the NEP-141 transfer each
reported by hash. The script refuses to run when a variable is missing or when the RPC/account
ids do not belong to the selected network.

The mainnet social path spends real funds. It writes `__fastdata_kv` to `social`, confirms
`/v1/tx`, and reads api2; the tip runs only when `TIP_FT`, `BOB_ACCOUNT` and `PHILIA_CONTRACT`
are also set:

```bash
PHILIA_NETWORK=mainnet ALICE_ACCOUNT=you.near ALICE_PRIVATE_KEY=... node demo/social-loop.mjs
```

## `CodeDoesNotExist` is success

`social` is a data account, not a contract account. A `__fastdata_kv` call therefore returns
`CodeDoesNotExist` from the runtime while the transaction and its receipts succeed. philia does
not retry that answer. It extracts the transaction hash, polls
`https://api2.near.social/v1/tx/{hash}` every 1.5 seconds, and reports the write as done only
when `indexed` is `true` **and** every `actions[].keys[].status` is `ok`. A key that comes back
`invalid`, `ignored` (a key the indexer does not know), `rate_limited`, `key_too_long`, or
`value_too_large`, or an action that comes back
`too_many_keys`, `invalid_json`, or `invalid_borsh`, is surfaced to the UI with the key and
status that failed. The endpoint keeps roughly the last 200k transactions, so confirmation is
prompt and a stale hash is reported as such instead of being retried.

## Limits and quotas

FastData enforces these per UTC day (over-quota writes return `rate_limited`):

| Limit | Value |
|---|---|
| Posts | 300 |
| Likes | 1,000 |
| Reposts | 300 |
| Follows | 5,000 |
| Uploaded media | 5 MiB |
| Keys per transaction | 256 |
| Key length | 1,024 bytes |
| Value size | 256 KiB |
| Transaction size | 1.5 MiB |

Edits and deletes keep public history. Avatars are capped at 1 MiB per FastFS upload.

## Tip assets and fees

A tip is one NEP-141 `ft_transfer`, so the token is fixed per tips-contract deployment. In order
of preference:

| Path | Asset | Decimals | Use |
|---|---|---|---|
| Production | Circle native USDC — mainnet `17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1`, testnet `3e2210e1184b45b64c8a434c0a7e7b23cc04ea7eb7a6c3c32520d03d4afcb8af` | 6 | Mainnet, and testnet when Circle faucet USDC is available |
| Zero-funds fallback | `wrap.testnet` (wrapped NEAR) | 24 | Testnet when no USDC is available; faucet NEAR → `near_deposit` |
| Last resort | Self-deployed NEP-141 at `tip.philia.testnet` | deployment-defined | When neither token above can be used |

Use the Circle-listed native USDC accounts, never bridged USDC.e: USDC.e is not redeemable
through Circle. The app reads `get_tip_token()` for the account and decimals bound at deploy;
it does not assume 6 everywhere.

Before the first transfer to an author, the app reads `storage_balance_of`. A `null` result
means the author is unregistered, and the registration attaches the token's own
`storage_balance_bounds.min`. Never attach a remembered `0.00125`: that is the example FT's
minimum, not USDC's.

wNEAR fallback on testnet (near-cli-rs; deploy the contract with `decimals=24` and
`NEXT_PUBLIC_PHILIA_TIP_FT=wrap.testnet`):

```bash
near call wrap.testnet near_deposit '{}' --deposit 1 --use-account alice.philia.testnet --network-id testnet
near call wrap.testnet storage_deposit '{"account_id":"bob.philia.testnet"}' --deposit 0.00125 --use-account alice.philia.testnet --network-id testnet
near call wrap.testnet ft_transfer '{"receiver_id":"bob.philia.testnet","amount":"1000000000000000000000000"}' --deposit-yocto 1 --use-account alice.philia.testnet --network-id testnet
```

The optional cross-chain tip path uses 1Click (`POST /v0/quote` with `destinationAsset` set to
the native USDC asset id `nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1` and
`dry: true` for a preview). Fees are 25 bps for unauthenticated quotes, 20 bps authenticated,
and 1 bp for stablecoin pairs; the "0.2%" figure is the authenticated default. Swaps settle
confidentially by default since 2026-10-27, so `GET /v0/status?depositAddress=…` may report
`nearTxHashes` that are shield/unshield transactions rather than a public swap hash.
`SUCCESS` is the only success state; `REFUNDED`, `FAILED`, and `INCOMPLETE_DEPOSIT` are
terminal failures that carry the refund reason.

The app's function-call access key signs only zero-deposit calls to `__fastdata_kv` and
`__fastdata_fastfs`. `ft_transfer` (1 yoctoNEAR) and `storage_deposit` (variable) therefore
always fall back to wallet signing; the access-key allowance is not a spend limit.

NEAR accounts are not people. FastData quotas are per-account daily rate limits, not proof of
uniqueness: one person can hold many accounts, and one account can be shared. philia makes no
sybil-resistance claim — the quotas bound spam per account and nothing more.

## Numbers

Reproduce the measurement on testnet:

```bash
node demo/measure.mjs
```

The script publishes 10 posts of about 1 KB through `__fastdata_kv`, then records the
transaction hash, attached gas, gas burnt, tokens burnt, and the time until the transaction
reaches `FINAL` (queried with `tx_status` and `wait_until: "FINAL"`), together with the
protocol version reported by `status`. Its JSON output is the recorded measurement: any gas,
fee, or latency figure quoted for this project must come from that run, not from an
estimate. The values are recorded in the wave that runs the script on the deployment box.

## Origin, license, and attribution

This project is a port of SocialENS (MIT). The original license text is preserved in
[`LICENSE`](./LICENSE); the origin repository, the reused presentation layer, and the rewritten
data/wallet/payment layers are itemized in [`ATTRIBUTION.md`](./ATTRIBUTION.md). The origin was
generated from the Scaffold-ETH 2 baseline; that disclosure is in [`NOTICE`](./NOTICE).

## Known constraints

- **Testnet and mainnet social paths differ.** `api2.near.social` indexes mainnet `social`
  writes only. Testnet writes go to the SocialDB contract (`v1.social08.testnet`) and reads go
  through `near-social-js`; raw testnet FastData writes are indexed by
  `kv.test.fastnear.com`, but there is no testnet derived-feed API. The app selects the
  adapter from `NEXT_PUBLIC_NEAR_NETWORK`.
- **The function-call access key cannot attach a deposit.** App-scoped signing covers only
  zero-deposit calls to `__fastdata_kv` and `__fastdata_fastfs` on `social`. Tipping (1 yocto
  on `ft_transfer`), storage registration, and any payable contract call fall back to normal
  wallet signing. This is expected behavior, not a failure.
- **Avatars are capped at 1 MiB.** Larger media is uploaded as 1 MiB `Partial` chunks
  (reassembled up to 32 MiB); avatars stay on the single-transaction `Simple` path.
- **Reputation tiers are derived, not stored.** The UI reads `counts.followers` from
  `/v1/accounts/{id}` and labels ≥10 / ≥100 / ≥1,000 followers; no tier exists in the tips
  contract or any other on-chain state.

## Development commands

```bash
pnpm dev                 # web app
pnpm build               # production build
pnpm lint                # next lint
pnpm check-types         # tsc --noEmit
cd contract && cargo test --lib   # decimal parser unit tests, no node
cd contract && cargo test         # sandbox integration test (Linux or macOS)
```

Optional agent tooling for contributors using an AI coding agent; the five skills match the
work in this repository (contract, dapp, near-api-js, intents, near-kit):

```bash
npx skills add near/agent-skills \
  --skill near-smart-contracts --skill near-dapp --skill near-api-js \
  --skill near-intents --skill near-kit
```


## Contributing

See [`CONTRIBUTING.md`](./CONTRIBUTING.md).
