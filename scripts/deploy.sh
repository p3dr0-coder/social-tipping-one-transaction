#!/usr/bin/env bash
# Builds and deploys the philia-tips contract to testnet with its init call, then reads the
# default tip back from the deployed contract.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONTRACT_DIR="$ROOT/contract"

NETWORK="${NEAR_NETWORK:-testnet}"
ACCOUNT="${PHILIA_CONTRACT:-philia.testnet}"
TIP_FT="${TIP_FT:-3e2210e1184b45b64c8a434c0a7e7b23cc04ea7eb7a6c3c32520d03d4afcb8af}"
DECIMALS="${TIP_DECIMALS:-6}"

if [[ "$NETWORK" != "testnet" ]]; then
  echo "deploy: this script deploys to testnet only (network=$NETWORK)" >&2
  exit 1
fi

if ! command -v cargo >/dev/null 2>&1; then
  echo "deploy: cargo is required" >&2
  exit 1
fi
if ! command -v near >/dev/null 2>&1; then
  echo "deploy: near-cli-rs (near) is required" >&2
  exit 1
fi

WASM="$CONTRACT_DIR/target/near/philia-tips.wasm"
INIT_ARGS="$(printf '{"default_tip":"0.1","ft_account_id":"%s","decimals":%s,"owner_id":"%s"}' "$TIP_FT" "$DECIMALS" "$ACCOUNT")"

(
  cd "$CONTRACT_DIR"
  cargo near build non-reproducible-wasm
)

near contract deploy "$ACCOUNT" \
  use-file "$WASM" \
  with-init-call new json-args "$INIT_ARGS" \
  prepaid-gas '100 Tgas' attached-deposit '0 NEAR' \
  network-config "$NETWORK" sign-with-keychain send

near view "$ACCOUNT" get_default_tip '{}' --networkId "$NETWORK"
