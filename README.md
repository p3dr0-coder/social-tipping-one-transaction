# philia — sovereign social on NEAR

philia is a small, fully on-chain social app. Profiles, posts, follow edges, and tip preferences
live in NEAR-native storage. There is no application database and no server-side account system.
A named NEAR account is the identity. The wallet is the login. The social graph is public data
that any client can read.

The app ships with a Rust contract for tipping preferences. It also ships a zero-funds testnet
demo that walks the whole loop: set a profile, publish a post, follow someone, read the feed and
the follower list, and settle a tip.

## What you can do

- Sign in with a named NEAR account. No email, password, or app account record is stored.
- Set a profile: display name, bio, and an avatar uploaded to FastFS.
- Publish a post as one append-only key on the mainnet FastData path. On testnet the SocialDB
  adapter stores the latest main post instead (SocialDB semantics).
- Follow and unfollow. Read the global feed plus any account's follower/following lists.
- See a reputation badge derived from indexer follower counts (≥10 / ≥100 / ≥1,000).
- Set a tip preference once per account. Then tip in the NEP-141 token that deployment is
  bound to.
- On the mainnet FastData path, confirm every write by transaction hash through the indexer.
  The confirmation includes the keys the indexer rejected. Testnet SocialDB writes return after
  wallet submission because api2 is mainnet-only.

## Architecture

| Layer | What it is |
|---|---|
| Social primitive | **near.social social DB (`social-kv/1` FastData KV + SocialDB)** |
| Writes (mainnet path) | `social.__fastdata_kv` with a 1 Tgas function call and no attached deposit; one key per entity (`post/{id}`, `graph/follow/{account}`, `profile/*`) |
| Reads (mainnet path) | `api2.near.social` feeds, profiles, search, suggestions, follower lists, and an SSE block stream; FastData `/v0/latest` and `/v0/multi` verify exact keys and back the follow/post/profile fallbacks |
| Writes/reads (testnet path) | SocialDB contract `v1.social08.testnet` through `near-social-js` for reads and a wallet-signed `set` call for writes |
| Media | FastFS upload to `social.__fastdata_fastfs`, referenced as `fastfs://{account}/social/{path}` |
| Tips | NEP-141 `ft_transfer` to the author, priced by the author's preference |
| Tip preferences | `philia-tips` contract (the recorded testnet deployment is `tips.philia.testnet`): a `LookupMap<AccountId, String>` with storage accounting, refunds, and NEP-297 events |
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
├── demo/              # zero-funds testnet loop + gas/latency and storage measurement
├── scripts/           # account creation and contract deployment
└── .env.example
```

## Quickstart

Prerequisites: Node.js >= 22.22.2, pnpm >= 10.4.1, Rust 1.95.0 with
`wasm32-unknown-unknown`, `cargo-near` 0.23.0, and `near-cli-rs` 0.31.1.

```bash
# 1. Install the JavaScript workspaces (web + demo).
pnpm install

# 2. Configure the app. The template targets testnet and Circle testnet USDC.
cp .env.example web/.env.local

# 3. Create the testnet accounts (top-level from the faucet, sub-accounts from the parent).
bash scripts/create-accounts.sh

# 4. Build the contract and deploy it with its init call, then read the default tip back.
bash scripts/deploy.sh

```

`scripts/deploy.sh` deploys to `PHILIA_CONTRACT` (default `philia.testnet`). The init call carries
`TIP_FT` (default Circle testnet USDC, 6 decimals) and `TIP_DECIMALS` (default 6). The init binds
one token for the life of that deployment. To deploy another binding, export the three variables:

```bash
PHILIA_CONTRACT=tips.philia.testnet TIP_FT=wrap.testnet TIP_DECIMALS=24 bash scripts/deploy.sh
```

The recorded zero-funds run used that wNEAR binding. `tips.philia.testnet` initialized with
`ft_account_id=wrap.testnet`, `decimals=24`, 1 NEAR wrapped from the faucet, and `bob` registered
with the token. Whatever you deploy, the demo's `PHILIA_CONTRACT` and `TIP_FT` must match the
contract's `get_tip_token()`. `NEXT_PUBLIC_PHILIA_CONTRACT` in `web/.env.local` must name the same
account. A mismatch is a deployment error, not a tip error.

Step 5. Export the demo keys in your shell. Never put them in a file that git tracks. Then run the
loop. `PHILIA_CONTRACT` and `TIP_FT` reproduce the default `deploy.sh` binding. The demo registers
the receiver but does not mint the tip token. Fund `alice` with the bound token (the Circle testnet
faucet issues testnet USDC), or deploy and use the wNEAR binding described above.

```bash
export ALICE_ACCOUNT=alice.philia.testnet
export ALICE_PRIVATE_KEY=...          # from your local keystore or wallet export
export BOB_ACCOUNT=bob.philia.testnet
export PHILIA_CONTRACT=philia.testnet
export TIP_FT=3e2210e1184b45b64c8a434c0a7e7b23cc04ea7eb7a6c3c32520d03d4afcb8af
export SOCIALDB_CONTRACT_ID=v1.social08.testnet
node demo/social-loop.mjs
```

Expected result, printed transaction by transaction: the profile write, post write, follow
edge, feed/follower reads, and the NEP-141 transfer each reported by hash, ending with

```
done: a post indexed + a tip settled
```

That exact line is what the recorded testnet run printed. The script refuses to run when a
variable is missing or when the RPC, account, or contract ids do not belong to the selected
network.

Optional, after the loop: `pnpm dev` serves the web app against the configured testnet.

For the cost side, `demo/measure.mjs` records gas, fees, and confirmation/indexing latency, and
`demo/measure-storage.mjs` records the tips-contract storage cost; see [Numbers](#numbers).

The mainnet social path spends real funds. It writes `__fastdata_kv` to `social`, confirms
`/v1/tx`, and reads api2. The tip runs only when `TIP_FT`, `BOB_ACCOUNT`, and `PHILIA_CONTRACT`
are also set:

```bash
PHILIA_NETWORK=mainnet ALICE_ACCOUNT=you.near ALICE_PRIVATE_KEY=... node demo/social-loop.mjs
```

## `CodeDoesNotExist` is success

`social` is a data account. It has no contract code. A `__fastdata_kv` call returns
`CodeDoesNotExist` from the runtime. The transaction and its receipts still succeed. philia does
not retry that answer. It extracts the transaction hash. It polls
`https://api2.near.social/v1/tx/{hash}` every 1.5 seconds. It reports the write as done only when
`indexed` is `true` and every `actions[].keys[].status` is `ok`. A key with status `invalid`,
`ignored`, `rate_limited`, `key_too_long`, or `value_too_large` fails the write. An action with
`too_many_keys`, `invalid_json`, or `invalid_borsh` fails the write. The UI shows the key and
status that failed. The endpoint keeps roughly the last 200k transactions. A stale hash is
reported as such. The write is never retried.

## NEP-413 authentication and replay

`web/lib/auth.ts` verifies NEP-413 signatures with `near-api-js/nep413` `verifyMessage`. The
library reads the signing key from the chain. It requires `FullAccess`. It checks the message,
recipient, nonce, and optional callback URL that the wallet signed.

The verifier does not store nonces. This repository has no backend authentication endpoint. A
production backend MUST generate the 32-byte nonce for each session. It MUST bind the nonce to
that session. It MUST compare `recipient` with its own value. It MUST accept each nonce once.
Reject a replayed signature, even when the signature is valid. A signature is not a bearer token.

## Limits and costs

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

**Account creation.** A named account costs **0.007 NEAR** in gas. That covers the first **770
bytes** of its data. Data beyond 770 bytes is staked at 1e19 yocto per byte (NEP-448). An account
holding only its name pays nothing extra. A contract account stakes its code and state.
`scripts/create-accounts.sh` creates the top-level account from the faucet. It creates the two
demo sub-accounts from their parent with a 0.1 NEAR balance.

**SocialDB on the testnet demo path.** `v1.social08.testnet` requires a storage balance of 0.02
NEAR (`storage_balance_bounds`). The demo attaches 0.05. The surplus stays in the account's
storage balance.

**Tip-preference storage.** A `set_tip_preference` call that grows storage needs an attached
deposit. An equal-length update is deposit-free. A shrink refunds the freed bytes. An entry is a
key of at most 64 bytes plus the value and the map's record overhead. At 1e19 yocto per byte
(≈0.01024 NEAR/KB), an entry lands at roughly **0.001–0.002 NEAR**. `demo/measure-storage.mjs`
produces the measured bytes and cost for this contract; see [Numbers](#numbers).

**Function-call key.** The app's access key signs only zero-deposit calls to `__fastdata_kv` and
`__fastdata_fastfs`. `ft_transfer` (1 yoctoNEAR) and `storage_deposit` (variable) therefore always
fall back to wallet signing. The access-key allowance is not a spend limit.

**Testnet vs mainnet.** Testnet SocialDB writes go to `v1.social08.testnet`. api2 does **not**
index them. Raw testnet FastData writes (`__fastdata_kv` to `social`) are indexed by
`kv.test.fastnear.com`. Mainnet writes go to `social` and are read through `api2.near.social`. The
app selects the adapter from `NEXT_PUBLIC_NEAR_NETWORK`. The testnet demo spends only
faucet-derived funds. The mainnet form of the same command spends real tokens.

The browser and demo default to `https://rpc.testnet.fastnear.com` on testnet. Set
`NEXT_PUBLIC_NEAR_RPC_URL` or `NEAR_RPC_URL` to override the endpoint.

**No sybil claim.** NEAR accounts are not people. FastData quotas are per-account daily rate
limits, not proof of uniqueness: one person can hold many accounts, and one account can be
shared. philia makes no sybil-resistance claim — the quotas bound spam per account and nothing
more.

## Tip assets and fees

A tip is one NEP-141 `ft_transfer`. The token is fixed per tips-contract deployment. In order of
preference:

| Path | Asset | Decimals | Use |
|---|---|---|---|
| Production | Circle native USDC — mainnet `17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1`, testnet `3e2210e1184b45b64c8a434c0a7e7b23cc04ea7eb7a6c3c32520d03d4afcb8af` | 6 | Mainnet, and testnet when Circle faucet USDC is available |
| Zero-funds fallback | `wrap.testnet` (wrapped NEAR) | 24 | Testnet when no USDC is available; faucet NEAR → `near_deposit` |
| Last resort | Self-deployed NEP-141 at `tip.philia.testnet` | deployment-defined | When neither token above can be used |

The self-deployed path is a local NEP-141 (for example the near-examples FT wasm, or
`#[derive(FungibleToken)]` from `near-sdk-contract-tools`). Deploy it with `new_default_meta`.
Then bind it by a tips-contract deployment with the same decimals. The shared token factory is
not a path. The global FT accounts a `use-global-account-id` deploy would rely on have no
contract code today, so that deploy fails. Deploy local code instead.

Use the Circle-listed native USDC accounts, never bridged USDC.e. USDC.e is not redeemable
through Circle. The app reads `get_tip_token()` for the account and decimals bound at deploy. It
does not assume 6 everywhere.

Before the first transfer to an author, the app reads `storage_balance_of`. A `null` result
means the author is unregistered. The registration attaches the token's own
`storage_balance_bounds.min`. Never attach a remembered `0.00125`. That is the example FT's
minimum, not USDC's.

wNEAR fallback on testnet (near-cli-rs; deploy the contract with `decimals=24` and
`NEXT_PUBLIC_PHILIA_TIP_FT=wrap.testnet`):

```bash
near call wrap.testnet near_deposit '{}' --deposit 1 --use-account alice.philia.testnet --network-id testnet
near call wrap.testnet storage_deposit '{"account_id":"bob.philia.testnet"}' --deposit 0.00125 --use-account alice.philia.testnet --network-id testnet
near call wrap.testnet ft_transfer '{"receiver_id":"bob.philia.testnet","amount":"1000000000000000000000000"}' --deposit-yocto 1 --use-account alice.philia.testnet --network-id testnet
```

The `0.00125` in that manual example is `wrap.testnet`'s own storage minimum. Do not reuse it for
another token; the app still reads `storage_balance_bounds` per token.

The optional cross-chain tip path uses 1Click. Send `POST /v0/quote` with `destinationAsset` set
to the native USDC asset id
`nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1` and `dry: true` for a
preview. Fees are 25 bps for unauthenticated quotes, 20 bps authenticated, and 1 bp for
stablecoin pairs. The "0.2%" figure is the authenticated default. 1Click's documented default
since 2026-10-27 is confidential settlement of the swap. `GET /v0/status?depositAddress=…` may
report `nearTxHashes` that are shield/unshield transactions rather than a public swap hash.
philia makes no privacy claim of its own. This is the upstream API's behavior. `SUCCESS` is the
only success state. `REFUNDED`, `FAILED`, and `INCOMPLETE_DEPOSIT` are terminal failures that
carry the refund reason.

## Numbers

Reproduce the measurements on testnet:

```bash
# All runs: testnet, protocol 88, 2026-11-12.
export NEAR_RPC_URL=https://rpc.testnet.fastnear.com

# 10 posts of about 1 KB through social.__fastdata_kv at 1 Tgas.
export ALICE_ACCOUNT=alice.philia.testnet
export ALICE_PRIVATE_KEY=...
node demo/measure.mjs

# One longer, one equal-length, and one shorter set_tip_preference update.
export PHILIA_CONTRACT=tips.philia.testnet
export BOB_ACCOUNT=bob.philia.testnet
export BOB_PRIVATE_KEY=...            # ALICE_ACCOUNT/ALICE_PRIVATE_KEY is used when unset
node demo/measure-storage.mjs

# One 0.001 wNEAR tip: ft_transfer, deposit 1 yocto, tx_status FINAL.
export TIP_FT=wrap.testnet
export TIP_AMOUNT=0.001
node demo/measure-tip.mjs
```

**Measured (`measure.mjs`, 10/10 samples):** a ~1 KB FastData write burns **1.473364542367 Tgas**
and **0.0001250181979867 N** (`tokens_burnt`). It reaches RPC `FINAL` in **3,798 ms** on average.
It is visible in the testnet KV index in **3,958 ms** on average. Protocol **88**. The full-access
demo key consumes **0** function-call-key allowance. This run does not exercise a function-call
key.

**Measured (`measure-tip.mjs`, rerun):** a 30 Tgas `ft_transfer` with a 1-yocto deposit burns
**2.391197807527 Tgas** and **0.000216801525 N**. The two runs agree exactly on gas and tokens
(`FINAL` in 4.2 s and 3.9 s).

**Measured (`measure-storage.mjs`, protocol 88):** storage byte cost is exactly **1e19 yocto/B**.
A 94-byte preference entry costs **0.00094 N** (**0.01024 N/KB**). An equal-length update grows 0
bytes and costs 0 storage. A 23-byte shrink refunds **0.00023 N** (the excess 0.01 N deposit is
returned too).

On testnet the `social` account has no contract code, so the measurement writes return
`AccountDoesNotExist` by design. The testnet FastData index still records them. The script treats
that expected failure as success. `/v1/tx` is mainnet-only. The app's mainnet path uses it. This
testnet measurement combines RPC `tx_status FINAL` with the KV-index latency. All three scripts
refuse mainnet and exit non-zero on an unexpected failure.

## Origin, license, and attribution

This project is a port of **SocialENS** (MIT), `https://github.com/NikhilRaikwar/SocialENS` —
created 2026-02-08, last commit 2026-03-14, **2 stars**. Its pedigree is real. SocialENS won the
ENS "Integrate ENS" pool prize at **ETHGlobal HackMoney 2026**, recorded at
`https://ethglobal.com/showcase/socialens-jps0p`. Its traction is not: two stars and no commits
since March 2026. This port keeps the presentation layer and rebuilds the data, wallet, and
payment layers rather than inheriting the implementation. The prize and the design are the
asset. The repository is not.

Bugs in the origin that this port fixes:

- **Tip-preference key mismatch.** The profile page wrote one text-record key while both tip
  readers read a different one. A saved preference was never used, and every tip fell back to
  `0.1`. philia has one source of truth, the tips contract. It prices every tip from
  `get_tip_preference(author)`.
- **Dead follower count.** The origin read a followers text record that it never wrote, so the
  count was always 0. philia reads `counts.followers` from the indexer and the actual list from
  `/v1/accounts/{id}/followers`.
- **20-cast cap and 20,000-block window.** Every new cast rewrote a JSON array sliced to the 20
  newest casts. User discovery scanned only the last 20,000 blocks. Older history and older users
  disappeared. philia writes one append-only key per post and reads full-history indexer feeds, so
  neither cap exists.
- **Asset mismatch in the docs.** The origin's README described ETH tips while the code
  transferred Sepolia USDC. philia tips are NEP-141 only. The token and decimals are read from the
  contract bound at deploy.

The original license text is preserved in [`LICENSE`](./LICENSE). [`ATTRIBUTION.md`](./ATTRIBUTION.md)
itemizes the origin repository, the reused presentation layer, and the rewritten data/wallet/payment
layers. The origin was generated from the Scaffold-ETH 2 baseline; that disclosure is in
[`NOTICE`](./NOTICE). The EVM scaffold — hardhat workspace, wagmi/RainbowKit connectors,
deployed-contract fixtures — is deleted, not adapted.

## Hackathon fit and adjudication

The submission track is `social`. The hackathon brief's SputnikDAO and Trezu references are hints,
not dependencies. philia uses neither. It does not claim to implement a DAO or a treasury.

What the port does lean on:

- **Named accounts as identity** — the account id is the user id, and the route parameter is
  the full account id.
- **Its own tips contract** — `philia-tips` holds the per-account preference and the token
  binding; it is the only custom contract in the repository.
- **Client-derived tiers** — follower tiers (≥10 / ≥100 / ≥1,000) are computed in the client
  from indexer counts. No tier, score, or reputation value is stored on-chain.

There is no privacy layer, no NFT-as-wallet mechanism, and no spend firewall. The wallet is a NEAR
account. The function-call key signs only zero-deposit social writes. Every payable call falls back
to wallet signing rather than being filtered by the app.

## Known constraints

- **Testnet and mainnet social paths differ.** `api2.near.social` indexes mainnet `social` writes
  only. Testnet writes go to the SocialDB contract (`v1.social08.testnet`), and reads go through
  `near-social-js`. Raw testnet FastData writes are indexed by `kv.test.fastnear.com`. There is no
  testnet derived-feed API. The app selects the adapter from `NEXT_PUBLIC_NEAR_NETWORK`.
- **The function-call access key cannot attach a deposit.** App-scoped signing covers only
  zero-deposit calls to `__fastdata_kv` and `__fastdata_fastfs` on `social`. Tipping (1 yocto on
  `ft_transfer`), storage registration, and any payable contract call fall back to normal wallet
  signing. This is expected behavior, not a failure.
- **Avatars are capped at 1 MiB.** Larger media is uploaded as 1 MiB `Partial` chunks, reassembled
  up to 32 MiB. Avatars stay on the single-transaction `Simple` path.
- **Reputation tiers are derived, not stored.** The UI reads `counts.followers` from
  `/v1/accounts/{id}` and labels ≥10 / ≥100 / ≥1,000 followers. No tier exists in the tips contract
  or any other on-chain state.

## Before you submit (human-only)

Nothing in this repository submits an application, and no submission was made from it. The
following is the checklist for the person who does:

- Build the **11-field payload** exactly as the submission form defines it. `website` is not one of
  the 11 fields. Omit it entirely rather than sending an empty string (it is a spam trap).
- Set `tracks: ["social"]`. Add a second track only if the work genuinely covers it.
- Generate a **fresh UUID `requestId`** for the application. Reuse that same value if the request is
  retried.
- Print the full JSON payload and read the contact notice before sending. Send only after an
  explicit "yes".
- On **403**, tell the human and stop. Do not retry. Do not reformat the payload. Do not swap the
  `requestId`.
- **201** means saved. If a field is wrong after that, use `/request-changes`. Never resubmit the
  application.
- X demo: a video of two minutes or less. Tag **@NEARProtocol + #NEARHackathon**.
- Demo host options (optional — a local-only demo is acceptable): Vercel Hobby, GitHub Pages for a
  static export, or Netlify Free. Any hosted URL must stay alive through Nov 18, ideally Nov 25.
- Do not put a number, video URL, or hosted-demo URL in the payload before that artifact exists.
  The WORKLOG is the source for measured values.

## Development commands

```bash
pnpm dev                 # web app
pnpm build               # production build
pnpm lint                # next lint
pnpm check-types         # tsc --noEmit
cd contract && cargo test --lib   # decimal parser unit tests, no node
cd contract && cargo test         # sandbox integration test (Linux or macOS)
node demo/social-loop.mjs         # zero-funds testnet loop
node demo/measure.mjs             # gas, latency, protocol (testnet)
node demo/measure-storage.mjs     # tips-contract storage cost (testnet)
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
