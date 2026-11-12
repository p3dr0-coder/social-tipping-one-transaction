#!/usr/bin/env bash
# Creates the philia testnet accounts described in the project doc.
#
# The faucet can only sponsor top-level .testnet names, so alice and bob are created by
# their parent account with --useAccount (and a 0.1 NEAR initial balance).
set -euo pipefail

NETWORK="${NEAR_NETWORK:-testnet}"
PARENT="${PHILIA_PARENT_ACCOUNT:-philia.testnet}"
ALICE="${ALICE_ACCOUNT:-alice.philia.testnet}"
BOB="${BOB_ACCOUNT:-bob.philia.testnet}"

if [[ "$NETWORK" != "testnet" ]]; then
  echo "create-accounts: this script only creates testnet accounts (network=$NETWORK)" >&2
  exit 1
fi

if ! command -v near >/dev/null 2>&1; then
  echo "create-accounts: near-cli-rs (near) is required" >&2
  exit 1
fi

account_exists() {
  near account view-account-summary "$1" network-config "$NETWORK" now >/dev/null 2>&1
}

create_parent() {
  if account_exists "$PARENT"; then
    echo "create-accounts: $PARENT already exists"
    return
  fi
  # near-cli-rs v0.31.1: the faucet can only sponsor top-level .testnet names.
  near create-account "$PARENT" --use-faucet --network-id "$NETWORK"
}

create_child() {
  local account="$1"
  if account_exists "$account"; then
    echo "create-accounts: $account already exists"
    return
  fi
  # Sub-accounts are funded by their parent account.
  near create-account "$account" --use-account "$PARENT" --network-id "$NETWORK" --initial-balance 0.1
}

create_parent
create_child "$ALICE"
create_child "$BOB"

echo "create-accounts: ready: $PARENT, $ALICE, $BOB"
