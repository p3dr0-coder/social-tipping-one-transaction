# Contributing to philia

Thanks for helping. This repository holds three workspaces:

- `contract/` — the `philia-tips` Rust contract (near-sdk 5.30.1).
- `web/` — the Next.js application (`philia-web`).
- `demo/` — Node scripts for the zero-funds testnet loop and the measurement run.

## Toolchain

- Node.js >= 22.22.2 and pnpm >= 10.4.1.
- Rust 1.95.0 with the `wasm32-unknown-unknown` target (the contract pins it in
  `contract/rust-toolchain.toml`).
- `cargo-near` 0.23.0 and `near-cli-rs` 0.31.1 for builds and testnet deployment.

## Setup

```bash
pnpm install
cp .env.example web/.env.local
```

Fill in `web/.env.local` for your network. Never commit a private key: the demo scripts read
keys from the shell environment only.

## Everyday commands

```bash
pnpm dev                 # next dev for the web app
pnpm build               # next build
pnpm lint                # next lint
pnpm check-types         # tsc --noEmit
pnpm format              # prettier --write

cd contract && cargo test --lib          # unit tests, no node needed
cd contract && cargo test                # sandbox tests (Linux or macOS)
bash scripts/create-accounts.sh          # testnet accounts
bash scripts/deploy.sh                   # build and deploy the contract
node demo/social-loop.mjs                # profile -> post -> follow -> read -> tip
node demo/measure.mjs                    # gas, fees, and confirmation latency
```

Sandbox tests download and run a local NEAR node, which is supported on Linux and macOS only.
On other hosts, run `cargo test --lib` for the pure unit tests and leave the sandbox suite to
CI or the deployment box.

## Code style

- TypeScript: strict mode, `~~/` path alias for `web/`, Prettier defaults from
  `web/.prettierrc.js`.
- Rust: `cargo fmt` and `cargo clippy` with the pinned toolchain.
- Keep the contract's storage accounting intact: flush lazy collections before measuring
  `storage_usage`, and compare `NearToken` values instead of raw `u128` when a token amount
  is involved.
- Documentation in prose must not claim a measured number that was not produced by
  `demo/measure.mjs`.

## Pull requests

1. Create a branch.
2. Keep one logical change per pull request.
3. Run the commands above that apply to the files you touched.
4. Describe what changed and how you verified it.

## License

By contributing you agree that your contribution is licensed under the MIT License in
[`LICENSE`](./LICENSE). Reused origin code and the origin's application baseline are disclosed in
[`ATTRIBUTION.md`](./ATTRIBUTION.md) and [`NOTICE`](./NOTICE).
