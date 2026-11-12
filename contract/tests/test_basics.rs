//! Sandbox integration test for the `philia-tips` contract.
//!
//! The test starts a local NEAR node, builds the contract wasm with `cargo near build`,
//! deploys it with its init call, and walks the storage-accounting paths with balance evidence
//! read back from the RPC account view:
//!
//! 1. growing storage without a deposit is rejected and changes nothing;
//! 2. the same insert succeeds once the caller funds the bytes, and the excess deposit is
//!    refunded;
//! 3. an equal-length update needs no deposit and costs gas only;
//! 4. a longer value grows storage (funded); overwriting it with a shorter one frees bytes, so
//!    the zero-deposit write is accepted and costs less than the equal-length update by about
//!    the freed bytes' value (a shrink cannot gain NEAR net, because the call burns more gas
//!    than the freed bytes are worth);
//! 5. removal returns the preference to the default and refunds the whole freed record, which
//!    is worth more than the call's gas, so the balance grows;
//! 6. `set_default_tip` is owner-only.
//!
//! A second test starts its own sandbox on a 6-decimal deployment — the production USDC binding
//! — and covers the doc's counterexamples: removing a preference that was never stored is a
//! no-op, the owner cannot install a default the deployment cannot express in base units, and
//! removal is scoped to the caller instead of touching another account's entry.
//!
//! Nothing in this contract reads the clock or a block height, so no case here is
//! time-dependent and `sandbox.fast_forward` is intentionally not used (row S13-05 is N/A).
//!
//! Sandbox execution is supported on Linux and macOS only.

use std::sync::Arc;

use anyhow::{Context, Result};
use near_api::{
    signer::generate_secret_key, Account, AccountId, Contract, Data, NearToken, NetworkConfig, Signer, Tokens,
};
use near_sandbox::config::{DEFAULT_GENESIS_ACCOUNT, DEFAULT_GENESIS_ACCOUNT_PRIVATE_KEY};
use near_sandbox::Sandbox;
use serde_json::{json, Value};

const FT_ACCOUNT: &str = "wrap.testnet";
const DECIMALS: u8 = 24;
const DEFAULT_TIP: &str = "0.1";
/// The longest amount `parse_units` accepts for this deployment: 12 integer digits, the dot and
/// all 24 fractional digits. Writing it and then overwriting it with `SHRUNK_TIP` frees the
/// most bytes a single write can free here.
const LONG_TIP: &str = "123456789012.000000000000000000000001";
/// The value that overwrites `LONG_TIP` in the shrink case.
const SHRUNK_TIP: &str = "0.2";
/// Storage price: 1e19 yoctoNEAR per byte (100 kB per NEAR).
const STORAGE_BYTE_COST: u128 = 10_000_000_000_000_000_000;

async fn view_string(network: &NetworkConfig, contract_id: &AccountId, method: &str, args: Value) -> Result<String> {
    let data: Data<String> = Contract(contract_id.clone())
        .call_function(method, args)
        .read_only()
        .fetch_from(network)
        .await
        .with_context(|| format!("view call {method} failed"))?;
    Ok(data.data)
}

async fn tip_preference(network: &NetworkConfig, contract_id: &AccountId, account_id: &AccountId) -> Result<String> {
    view_string(
        network,
        contract_id,
        "get_tip_preference",
        json!({ "account_id": account_id.to_string() }),
    )
    .await
}

async fn balance_of(network: &NetworkConfig, account_id: &AccountId) -> Result<NearToken> {
    Ok(Tokens::account(account_id.clone())
        .near_balance()
        .fetch_from(network)
        .await
        .with_context(|| format!("read the NEAR balance of {account_id}"))?
        .total)
}

async fn call(
    network: &NetworkConfig,
    contract_id: &AccountId,
    signer_id: &AccountId,
    signer: &Arc<Signer>,
    method: &str,
    args: Value,
    deposit: NearToken,
) -> Result<()> {
    Contract(contract_id.clone())
        .call_function(method, args)
        .transaction()
        .deposit(deposit)
        .with_signer(signer_id.clone(), signer.clone())
        .send_to(network)
        .await
        .with_context(|| format!("call {method} failed"))?
        .assert_success();
    Ok(())
}

async fn set_preference(
    network: &NetworkConfig,
    contract_id: &AccountId,
    signer_id: &AccountId,
    signer: &Arc<Signer>,
    amount: &str,
    deposit: NearToken,
) -> Result<()> {
    call(
        network,
        contract_id,
        signer_id,
        signer,
        "set_tip_preference",
        json!({ "amount": amount }),
        deposit,
    )
    .await
}

/// Builds and deploys `philia-tips` under `owner_id` with its init call.
async fn deploy_contract(
    network: &NetworkConfig,
    owner_id: &AccountId,
    owner_signer: &Arc<Signer>,
    default_tip: &str,
    decimals: u8,
) -> Result<()> {
    let wasm_path = cargo_near_build::build_with_cli(Default::default())
        .map_err(|error| anyhow::anyhow!("build philia-tips wasm: {error}"))?;
    let wasm = std::fs::read(wasm_path).context("read the built philia-tips wasm")?;

    Contract::deploy(owner_id.clone())
        .use_code(wasm)
        .with_init_call(
            "new",
            json!({
                "default_tip": default_tip,
                "ft_account_id": FT_ACCOUNT,
                "decimals": decimals,
                "owner_id": owner_id.to_string(),
            }),
        )
        .context("encode the init call")?
        .with_signer(Arc::clone(owner_signer))
        .send_to(network)
        .await
        .context("deploy philia-tips")?
        .assert_success();
    Ok(())
}

#[tokio::test]
async fn tip_preferences_storage_paths_and_owner_gate() -> Result<()> {
    let sandbox = Sandbox::start_sandbox().await.context("start near sandbox")?;
    let network = NetworkConfig::from_rpc_url(
        "sandbox",
        sandbox.rpc_addr.parse().context("parse the sandbox RPC address")?,
    );

    // Parse the documented genesis account id instead of converting between the
    // near-account-id versions used by the sandbox and near-api crates.
    let owner_id: AccountId = DEFAULT_GENESIS_ACCOUNT.as_str().parse().context("parse the genesis account id")?;
    let owner_signer = Signer::from_secret_key(
        DEFAULT_GENESIS_ACCOUNT_PRIVATE_KEY
            .parse()
            .context("parse the sandbox genesis key")?,
    )?;

    let wasm_path = cargo_near_build::build_with_cli(Default::default())
        .map_err(|error| anyhow::anyhow!("build philia-tips wasm: {error}"))?;
    let wasm = std::fs::read(wasm_path).context("read the built philia-tips wasm")?;

    Contract::deploy(owner_id.clone())
        .use_code(wasm)
        .with_init_call(
            "new",
            json!({
                "default_tip": DEFAULT_TIP,
                "ft_account_id": FT_ACCOUNT,
                "decimals": DECIMALS,
                "owner_id": owner_id.to_string(),
            }),
        )
        .context("encode the init call")?
        .with_signer(owner_signer.clone())
        .send_to(&network)
        .await
        .context("deploy philia-tips")?
        .assert_success();

    // The deployment binds one token, exposes it, and seeds the default preference.
    assert_eq!(
        view_string(&network, &owner_id, "get_default_tip", json!({})).await?,
        DEFAULT_TIP
    );
    let token: Data<(String, u8)> = Contract(owner_id.clone())
        .call_function("get_tip_token", json!({}))
        .read_only()
        .fetch_from(&network)
        .await
        .context("view get_tip_token")?;
    assert_eq!(token.data, (FT_ACCOUNT.to_string(), DECIMALS));
    assert_eq!(
        tip_preference(&network, &owner_id, &owner_id).await?,
        DEFAULT_TIP,
        "an account without a preference falls back to the default"
    );

    // A second account signs the storage-accounting calls.
    let alice_id: AccountId = format!("alice.{owner_id}")
        .parse()
        .context("build the sub-account id")?;
    let alice_secret = generate_secret_key()?;
    Account::create_account(alice_id.clone())
        .fund_myself(owner_id.clone(), NearToken::from_near(20))
        .with_public_key(alice_secret.public_key())
        .with_signer(owner_signer.clone())
        .send_to(&network)
        .await
        .context("create alice")?
        .assert_success();
    let alice_signer = Signer::from_secret_key(alice_secret)?;

    // 1. Growing storage without a deposit is rejected; the preference stays at the default.
    //    The outcome is intentionally not asserted as successful: the call may fail either at
    //    submission or at execution, and only the state matters here.
    let _rejected = Contract(owner_id.clone())
        .call_function("set_tip_preference", json!({ "amount": "0.2" }))
        .transaction()
        .with_signer(alice_id.clone(), alice_signer.clone())
        .send_to(&network)
        .await;
    assert_eq!(
        tip_preference(&network, &owner_id, &alice_id).await?,
        DEFAULT_TIP,
        "a zero-deposit insert must not be stored"
    );

    // 2. The insert succeeds when the caller funds the grown bytes, and the excess deposit
    //    comes back in the same transaction (only gas is spent).
    let before = balance_of(&network, &alice_id).await?;
    set_preference(
        &network,
        &owner_id,
        &alice_id,
        &alice_signer,
        "0.2",
        NearToken::from_millinear(10),
    )
    .await?;
    assert_eq!(
        tip_preference(&network, &owner_id, &alice_id).await?,
        "0.2",
        "the funded write stores the new value"
    );
    let after = balance_of(&network, &alice_id).await?;
    let spent = before.as_yoctonear().saturating_sub(after.as_yoctonear());
    assert!(
        spent < NearToken::from_millinear(5).as_yoctonear(),
        "the deposit beyond the grown bytes must be refunded; {spent} yocto were spent"
    );

    // 3. An equal-length update needs no deposit and buys no storage either: the balance pays
    //    gas only, so it strictly decreases with no refund to offset it. That delta is the
    //    gas-only baseline the shrink case in step 4 is measured against.
    let equal_before = balance_of(&network, &alice_id).await?;
    set_preference(
        &network,
        &owner_id,
        &alice_id,
        &alice_signer,
        "0.3",
        NearToken::from_yoctonear(0),
    )
    .await?;
    assert_eq!(
        tip_preference(&network, &owner_id, &alice_id).await?,
        "0.3",
        "the equal-length update stores the new value"
    );
    let equal_after = balance_of(&network, &alice_id).await?;
    let gas_only = equal_before.as_yoctonear().saturating_sub(equal_after.as_yoctonear());
    assert!(
        equal_after.as_yoctonear() < equal_before.as_yoctonear(),
        "an equal-length update must not refund anything; the balance only pays gas"
    );
    assert!(
        gas_only < NearToken::from_millinear(5).as_yoctonear(),
        "an equal-length update must not charge storage; {gas_only} yocto were spent"
    );

    // 4. A much longer value grows storage (funded), then a shorter value shrinks it and is
    //    accepted with no deposit. The shrink refunds the freed bytes, but it cannot leave the
    //    caller with a higher balance than it started with: the sandbox genesis gas price is
    //    nearcore's `MIN_GAS_PRICE` of 1e8 yocto per gas, a function call burns the
    //    `function_call` fee on send *and* on execution (2.32 Tgas each, plus receipt fees),
    //    so a call costs about 0.0005 NEAR, while the freed bytes here are worth 0.00034 NEAR.
    //    The refund is therefore measured against the gas-only baseline of step 3: the shrink
    //    must undercut it by about the freed bytes' value, whereas without the refund both
    //    calls would cost the same gas.
    let grown_before = balance_of(&network, &alice_id).await?;
    set_preference(
        &network,
        &owner_id,
        &alice_id,
        &alice_signer,
        LONG_TIP,
        NearToken::from_millinear(10),
    )
    .await?;
    assert_eq!(
        tip_preference(&network, &owner_id, &alice_id).await?,
        LONG_TIP,
        "the funded write stores the long value"
    );
    let grown_after = balance_of(&network, &alice_id).await?;
    let grown_spent = grown_before.as_yoctonear().saturating_sub(grown_after.as_yoctonear());
    assert!(
        grown_spent < NearToken::from_millinear(5).as_yoctonear(),
        "the deposit beyond the grown bytes must be refunded; {grown_spent} yocto were spent"
    );

    let shrink_before = balance_of(&network, &alice_id).await?;
    set_preference(
        &network,
        &owner_id,
        &alice_id,
        &alice_signer,
        SHRUNK_TIP,
        NearToken::from_yoctonear(0),
    )
    .await?;
    assert_eq!(
        tip_preference(&network, &owner_id, &alice_id).await?,
        SHRUNK_TIP,
        "the shrink is accepted without a deposit"
    );
    let shrink_after = balance_of(&network, &alice_id).await?;
    let shrink_spent = shrink_before.as_yoctonear().saturating_sub(shrink_after.as_yoctonear());
    let freed_bytes = (LONG_TIP.len() - SHRUNK_TIP.len()) as u128;
    let refunded = gas_only.saturating_sub(shrink_spent);
    assert!(
        refunded > freed_bytes * STORAGE_BYTE_COST / 2,
        "the freed bytes must be refunded, not charged: the shrink spent {shrink_spent} yocto \
         against {gas_only} for the equal-length update, {refunded} yocto less than gas alone"
    );

    // 5. Removal refunds the whole freed record — the 33-byte hashed key, the 7-byte value and
    //    the 40 bytes the protocol charges per record, about 0.0008 NEAR — which is more than
    //    the roughly 0.0005 NEAR the call burns in gas, so the caller's balance grows.
    let removal_before = balance_of(&network, &alice_id).await?;
    call(
        &network,
        &owner_id,
        &alice_id,
        &alice_signer,
        "remove_tip_preference",
        json!({}),
        NearToken::from_yoctonear(0),
    )
    .await?;
    assert_eq!(
        tip_preference(&network, &owner_id, &alice_id).await?,
        DEFAULT_TIP,
        "a removed preference falls back to the default"
    );
    let removal_after = balance_of(&network, &alice_id).await?;
    assert!(
        removal_after.as_yoctonear() > removal_before.as_yoctonear(),
        "removal must refund the freed record: the balance went from {} to {} yocto",
        removal_before.as_yoctonear(),
        removal_after.as_yoctonear()
    );

    // 6. Only the owner can reprice the default.
    let _denied = Contract(owner_id.clone())
        .call_function("set_default_tip", json!({ "amount": "9.9" }))
        .transaction()
        .with_signer(alice_id.clone(), alice_signer.clone())
        .send_to(&network)
        .await;
    assert_eq!(
        view_string(&network, &owner_id, "get_default_tip", json!({})).await?,
        DEFAULT_TIP,
        "a non-owner call must not change the default"
    );

    call(
        &network,
        &owner_id,
        &owner_id,
        &owner_signer,
        "set_default_tip",
        json!({ "amount": "0.2" }),
        NearToken::from_yoctonear(0),
    )
    .await?;
    assert_eq!(
        view_string(&network, &owner_id, "get_default_tip", json!({})).await?,
        "0.2"
    );
    assert_eq!(
        tip_preference(&network, &owner_id, &alice_id).await?,
        "0.2",
        "the fallback follows the new default"
    );

    Ok(())
}

#[tokio::test]
async fn removal_scope_and_default_validation_counterexamples() -> Result<()> {
    let sandbox = Sandbox::start_sandbox().await.context("start near sandbox")?;
    let network = NetworkConfig::from_rpc_url(
        "sandbox",
        sandbox.rpc_addr.parse().context("parse the sandbox RPC address")?,
    );

    let owner_id: AccountId = DEFAULT_GENESIS_ACCOUNT.as_str().parse().context("parse the genesis account id")?;
    let owner_signer = Signer::from_secret_key(
        DEFAULT_GENESIS_ACCOUNT_PRIVATE_KEY
            .parse()
            .context("parse the sandbox genesis key")?,
    )?;

    // A 6-decimal deployment, matching the Circle USDC binding this contract ships against, so
    // the seven-fractional-digit default below is more precise than the deployment can express.
    deploy_contract(&network, &owner_id, &owner_signer, DEFAULT_TIP, 6).await?;
    let token: Data<(String, u8)> = Contract(owner_id.clone())
        .call_function("get_tip_token", json!({}))
        .read_only()
        .fetch_from(&network)
        .await
        .context("view get_tip_token")?;
    assert_eq!(
        token.data,
        (FT_ACCOUNT.to_string(), 6),
        "the invalid default below is only invalid against six decimals"
    );

    // Two accounts: alice stores a preference, bob never does.
    let alice_id: AccountId = format!("alice.{owner_id}")
        .parse()
        .context("build alice's sub-account id")?;
    let alice_secret = generate_secret_key()?;
    Account::create_account(alice_id.clone())
        .fund_myself(owner_id.clone(), NearToken::from_near(10))
        .with_public_key(alice_secret.public_key())
        .with_signer(owner_signer.clone())
        .send_to(&network)
        .await
        .context("create alice")?
        .assert_success();
    let alice_signer = Signer::from_secret_key(alice_secret)?;

    let bob_id: AccountId = format!("bob.{owner_id}")
        .parse()
        .context("build bob's sub-account id")?;
    let bob_secret = generate_secret_key()?;
    Account::create_account(bob_id.clone())
        .fund_myself(owner_id.clone(), NearToken::from_near(10))
        .with_public_key(bob_secret.public_key())
        .with_signer(owner_signer.clone())
        .send_to(&network)
        .await
        .context("create bob")?
        .assert_success();
    let bob_signer = Signer::from_secret_key(bob_secret)?;

    // 1. Removing a preference that was never stored is a no-op, not an error: there is no
    //    record to delete, nothing is refunded, and the view still answers with the default.
    call(
        &network,
        &owner_id,
        &bob_id,
        &bob_signer,
        "remove_tip_preference",
        json!({}),
        NearToken::from_yoctonear(0),
    )
    .await
    .context("remove a preference bob never set")?;
    assert_eq!(
        tip_preference(&network, &owner_id, &bob_id).await?,
        DEFAULT_TIP,
        "a no-op removal must leave the default fallback in place"
    );

    // 2. The owner cannot install a default the deployment cannot price: seven fractional
    //    digits exceed the six decimals bound at init. The outcome is intentionally not
    //    asserted as successful — it may fail at submission or at execution — and only the
    //    stored default matters.
    let _rejected = Contract(owner_id.clone())
        .call_function("set_default_tip", json!({ "amount": "0.0000001" }))
        .transaction()
        .with_signer(owner_id.clone(), owner_signer.clone())
        .send_to(&network)
        .await;
    assert_eq!(
        view_string(&network, &owner_id, "get_default_tip", json!({})).await?,
        DEFAULT_TIP,
        "an over-precise default must be rejected before it replaces the stored one"
    );

    // 3. Removal is scoped to the predecessor: bob removing his (still missing) preference must
    //    not touch alice's stored one, which falls back to the default if it is deleted.
    set_preference(
        &network,
        &owner_id,
        &alice_id,
        &alice_signer,
        "0.2",
        NearToken::from_millinear(10),
    )
    .await?;
    assert_eq!(
        tip_preference(&network, &owner_id, &alice_id).await?,
        "0.2",
        "alice's funded write stores her preference"
    );
    call(
        &network,
        &owner_id,
        &bob_id,
        &bob_signer,
        "remove_tip_preference",
        json!({}),
        NearToken::from_yoctonear(0),
    )
    .await
    .context("removal from another account failed")?;
    assert_eq!(
        tip_preference(&network, &owner_id, &alice_id).await?,
        "0.2",
        "a removal only deletes the caller's own entry"
    );
    assert_eq!(
        tip_preference(&network, &owner_id, &bob_id).await?,
        DEFAULT_TIP,
        "bob's missing entry still falls back to the default"
    );

    Ok(())
}
