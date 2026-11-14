# Contributing to philia

This repository has three workspaces. `contract/` holds `philia-tips` on near-sdk 5.30.2, and `web/` holds `philia-web` on Next.js. `demo/` holds Node scripts for the testnet loop and measurement runs.

## Toolchain

- Node.js >= 26.0.0 and pnpm >= 12.18.0.
- Rust 1.100.0 with `wasm32-unknown-unknown` (pinned in `contract/rust-toolchain.toml`).
- `cargo-near` 0.23.0 and `near-cli-rs` 0.31.1 for builds and testnet deployment.

## Setup and commands

Copy the env template and configure `web/.env.local` for your network. Never commit private keys; the demo scripts read keys from the shell environment only.

```bash
pnpm install
cp .env.example web/.env.local
pnpm dev                          # Next.js dev server
pnpm lint                         # eslint .
pnpm check-types                  # tsc --noEmit
pnpm test                         # consolidated web + demo node --test suites
pnpm format                       # prettier --write .
cd contract && cargo test --lib   # unit tests (no node needed)
cd contract && cargo test         # sandbox tests (Linux or macOS)
bash scripts/create-accounts.sh   # testnet accounts
bash scripts/deploy.sh            # build and deploy contract
node demo/social-loop.mjs         # profile -> post -> follow -> read -> tip
node demo/measure.mjs             # gas, fees, and confirmation latency
```

Sandbox tests download and run a local NEAR node on Linux and macOS only. On other hosts, run `cargo test --lib`, then run the sandbox suite in CI or on Linux.

## Code rules and pull requests

- TypeScript: strict mode, `~~/` path alias for `web/`, Prettier config in `web/.prettierrc.js`.
- Rust: run `cargo fmt` and `cargo clippy` with the pinned toolchain.
- Preserve storage accounting: flush lazy collections before measuring `storage_usage`, and compare `NearToken` values rather than raw `u128` token amounts.
- Do not write unmeasured numbers in prose; every metric must come from `demo/measure.mjs`.
- Pull requests: create a branch, keep 1 logical change per PR, and describe the verification. Work in four steps: branch, code, checks, then describe. Never mix 128 unrelated edits, and never skip checks.

Contributions are licensed under the MIT License in [`LICENSE`](./LICENSE). Origin code and baseline disclosures live in [`ATTRIBUTION.md`](./ATTRIBUTION.md) and [`NOTICE`](./NOTICE).
