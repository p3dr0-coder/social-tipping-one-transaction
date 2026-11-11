//! Sandbox integration test for the `philia-tips` contract.
//!
//! The test starts a local NEAR node, builds the contract wasm with `cargo near build`,
//! deploys it with its init call, and walks the storage-accounting paths:
//!
//! 1. growing storage without a deposit is rejected and changes nothing;
//! 2. the same insert succeeds once the caller funds the bytes, and the excess deposit is
//!    refunded;
//! 3. an equal-length update needs no deposit;
//! 4. a shorter value frees bytes and is accepted with no deposit;
//! 5. removal returns the preference to the default and refunds the stored bytes;
//! 6. `set_default_tip` is owner-only.
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

    let wasm_path = cargo_near_build::build_with_cli(Default::default()).context("build philia-tips wasm")?;
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
    let before = Tokens::account(alice_id.clone())
        .near_balance()
        .fetch_from(&network)
        .await
        .context("read alice's balance before the funded write")?
        .total;
    set_preference(
        &network,
        &owner_id,
        &alice_id,
        &alice_signer,
        "0.2",
        NearToken::from_millinear(10),
    )
    .await?;
    assert_eq!(tip_preference(&network, &owner_id, &alice_id).await?, "0.2");
    let after = Tokens::account(alice_id.clone())
        .near_balance()
        .fetch_from(&network)
        .await
        .context("read alice's balance after the funded write")?
        .total;
    let spent = before.as_yoctonear().saturating_sub(after.as_yoctonear());
    assert!(
        spent < NearToken::from_millinear(5).as_yoctonear(),
        "the deposit beyond the grown bytes must be refunded; {spent} yocto were spent"
    );

    // 3. An equal-length update needs no deposit at all.
    set_preference(
        &network,
        &owner_id,
        &alice_id,
        &alice_signer,
        "0.3",
        NearToken::from_yoctonear(0),
    )
    .await?;
    assert_eq!(tip_preference(&network, &owner_id, &alice_id).await?, "0.3");

    // 4. A longer value grows storage (funded), then a shorter value shrinks it and is
    //    accepted with no deposit: the freed bytes are refunded, not charged.
    set_preference(
        &network,
        &owner_id,
        &alice_id,
        &alice_signer,
        "0.25",
        NearToken::from_millinear(10),
    )
    .await?;
    set_preference(
        &network,
        &owner_id,
        &alice_id,
        &alice_signer,
        "0.2",
        NearToken::from_yoctonear(0),
    )
    .await?;
    assert_eq!(tip_preference(&network, &owner_id, &alice_id).await?, "0.2");

    // 5. Removal refunds the stored bytes and restores the default fallback.
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
    assert_eq!(tip_preference(&network, &owner_id, &alice_id).await?, DEFAULT_TIP);

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
