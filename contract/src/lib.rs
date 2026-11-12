//! # philia-tips
//!
//! Tip preferences for philia. Each deployment is bound to exactly one NEP-141 token: the
//! stored decimal string is only meaningful together with that token's account id and
//! decimals, both of which live in the contract state and are exposed through
//! [`TipPreferences::get_tip_token`].
//!
//! Storage follows NEAR's staking rules. A write that grows the contract's storage must be
//! funded by the caller's attached deposit; a write that shrinks storage refunds the freed
//! bytes' value; any deposit beyond the grown bytes is refunded as well. Because
//! `store::LookupMap` persists lazily, every write is flushed before the second
//! `storage_usage` measurement.

use near_sdk::borsh::BorshSerialize;
use near_sdk::store::LookupMap;
use near_sdk::{env, near, AccountId, BorshStorageKey, PanicOnDefault, Promise};

mod units;

use units::parse_units;

#[derive(BorshSerialize, BorshStorageKey)]
#[borsh(crate = "near_sdk::borsh")]
enum Prefix {
    Preferences,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct TipPreferences {
    preferences: LookupMap<AccountId, String>,
    default_tip: String,
    ft_account_id: AccountId,
    decimals: u8,
    owner_id: AccountId,
}

#[near(event_json(standard = "philia-tips"))]
pub enum TipEvent {
    #[event_version("1.0.0")]
    PreferenceSet { account_id: AccountId, amount: String },
    #[event_version("1.0.0")]
    PreferenceRemoved { account_id: AccountId },
    #[event_version("1.0.0")]
    DefaultTipSet { amount: String },
}

#[near]
impl TipPreferences {
    #[init]
    pub fn new(default_tip: String, ft_account_id: AccountId, decimals: u8, owner_id: AccountId) -> Self {
        // Reject a bad default at init instead of failing the first tip.
        parse_units(&default_tip, decimals);
        Self {
            preferences: LookupMap::new(Prefix::Preferences),
            default_tip,
            ft_account_id,
            decimals,
            owner_id,
        }
    }

    /// Stores `amount` as the caller's tip preference.
    ///
    /// Payable: the caller covers any storage the write adds. A shrink frees bytes, so the
    /// freed value is refunded together with any excess deposit. There is no 1-yocto
    /// minimum, but any call that grows storage needs a deposit, so an app-scoped
    /// function-call key can only sign zero-cost updates and the wallet signs the rest.
    #[payable]
    pub fn set_tip_preference(&mut self, amount: String) {
        // NEP-141 amounts are base-10 integer strings, and the preference is parsed against
        // this deployment's token decimals: "0.0000001" is valid for a 24-decimal token and
        // invalid for a 6-decimal one.
        parse_units(&amount, self.decimals);

        let before = env::storage_usage();
        let caller = env::predecessor_account_id();
        self.preferences.insert(caller.clone(), amount.clone());
        // Lazy store write: flush before measuring the delta.
        self.preferences.flush();
        let after = env::storage_usage();

        let grown = env::storage_byte_cost().saturating_mul(after.saturating_sub(before) as u128);
        let freed = env::storage_byte_cost().saturating_mul(before.saturating_sub(after) as u128);
        let deposit = env::attached_deposit();
        assert!(deposit >= grown, "attach a storage deposit for the bytes this write adds");

        let refund = deposit.saturating_sub(grown).saturating_add(freed);
        if !refund.is_zero() {
            Promise::new(caller.clone()).transfer(refund).detach();
        }

        TipEvent::PreferenceSet {
            account_id: caller,
            amount,
        }
        .emit();
    }

    pub fn get_tip_preference(&self, account_id: AccountId) -> String {
        self.preferences
            .get(&account_id)
            .cloned()
            .unwrap_or_else(|| self.default_tip.clone())
    }

    pub fn get_default_tip(&self) -> String {
        self.default_tip.clone()
    }

    /// The one token this deployment prices tips in, and its decimals. Clients need both to
    /// turn a stored decimal preference into NEP-141 base units.
    pub fn get_tip_token(&self) -> (AccountId, u8) {
        (self.ft_account_id.clone(), self.decimals)
    }

    /// Removes the caller's preference and refunds the stored bytes' value.
    pub fn remove_tip_preference(&mut self) {
        let caller = env::predecessor_account_id();
        let before = env::storage_usage();
        if self.preferences.remove(&caller).is_some() {
            // Flush the removal before measuring the freed bytes.
            self.preferences.flush();
            let after = env::storage_usage();
            let freed = env::storage_byte_cost().saturating_mul(before.saturating_sub(after) as u128);
            if !freed.is_zero() {
                Promise::new(caller.clone()).transfer(freed).detach();
            }
            TipEvent::PreferenceRemoved { account_id: caller }.emit();
        }
    }

    /// Owner-only: reprice the default preference. Emits a NEP-297 event.
    pub fn set_default_tip(&mut self, amount: String) {
        assert_eq!(env::predecessor_account_id(), self.owner_id, "owner only");
        parse_units(&amount, self.decimals);
        self.default_tip = amount.clone();
        TipEvent::DefaultTipSet { amount }.emit();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::serde_json::Value;
    use near_sdk::test_utils::{get_logs, VMContextBuilder};
    use near_sdk::testing_env;

    fn account(id: &str) -> AccountId {
        id.parse().expect("valid account id")
    }

    /// The token bound to every test deployment: 6 decimals, like USDC.
    fn deployed(default_tip: &str, decimals: u8) -> TipPreferences {
        TipPreferences::new(
            default_tip.to_string(),
            account("usdc.testnet"),
            decimals,
            account("owner.testnet"),
        )
    }

    /// Reads the single log emitted by a test and returns the parsed NEP-297 payload.
    fn single_emitted_event() -> Value {
        let logs = get_logs();
        assert_eq!(logs.len(), 1, "the event is the only log");
        let json = logs[0]
            .strip_prefix("EVENT_JSON:")
            .expect("NEP-297 events are logged with the EVENT_JSON: prefix");
        near_sdk::serde_json::from_str(json).expect("event log holds valid JSON")
    }

    fn assert_nep297_envelope(event: &Value, name: &str) {
        let object = event.as_object().expect("event is a JSON object");
        assert_eq!(object.len(), 4, "standard, version, event, data");
        assert_eq!(event["standard"], "philia-tips");
        assert_eq!(event["version"], "1.0.0");
        assert_eq!(event["event"], name);
    }

    #[test]
    #[should_panic(expected = "fraction has more digits")]
    fn new_rejects_a_default_the_token_cannot_represent() {
        testing_env!(VMContextBuilder::new().build());
        // A 6-decimal token cannot store 0.0000001; `new` must reject it instead of
        // failing the first tip.
        deployed("0.0000001", 6);
    }

    #[test]
    fn unknown_account_falls_back_to_the_default_tip() {
        testing_env!(VMContextBuilder::new()
            .current_account_id(account("philia.testnet"))
            .build());
        let contract = deployed("0.1", 6);

        // Nothing was inserted into the LookupMap, so the read misses and falls back.
        assert_eq!(contract.get_tip_preference(account("alice.testnet")), "0.1");
    }

    #[test]
    fn views_return_the_initialized_values() {
        testing_env!(VMContextBuilder::new().build());
        let contract = deployed("0.1", 6);

        assert_eq!(contract.get_default_tip(), "0.1");
        assert_eq!(contract.get_tip_token(), (account("usdc.testnet"), 6));
    }

    #[test]
    fn preference_set_event_has_the_nep297_shape() {
        testing_env!(VMContextBuilder::new()
            .current_account_id(account("philia.testnet"))
            .predecessor_account_id(account("alice.testnet"))
            .build());

        TipEvent::PreferenceSet {
            account_id: account("alice.testnet"),
            amount: "0.1".to_string(),
        }
        .emit();

        let event = single_emitted_event();
        assert_nep297_envelope(&event, "preference_set");
        let data = event["data"].as_object().expect("data is a JSON object");
        assert_eq!(data.len(), 2);
        assert_eq!(event["data"]["account_id"], "alice.testnet");
        assert_eq!(event["data"]["amount"], "0.1");
    }

    #[test]
    fn preference_removed_event_has_the_nep297_shape() {
        testing_env!(VMContextBuilder::new()
            .current_account_id(account("philia.testnet"))
            .predecessor_account_id(account("alice.testnet"))
            .build());

        TipEvent::PreferenceRemoved {
            account_id: account("alice.testnet"),
        }
        .emit();

        let event = single_emitted_event();
        assert_nep297_envelope(&event, "preference_removed");
        let data = event["data"].as_object().expect("data is a JSON object");
        assert_eq!(data.len(), 1);
        assert_eq!(event["data"]["account_id"], "alice.testnet");
    }

    #[test]
    fn default_tip_set_event_has_the_nep297_shape() {
        testing_env!(VMContextBuilder::new()
            .current_account_id(account("philia.testnet"))
            .predecessor_account_id(account("owner.testnet"))
            .build());

        TipEvent::DefaultTipSet {
            amount: "0.25".to_string(),
        }
        .emit();

        let event = single_emitted_event();
        assert_nep297_envelope(&event, "default_tip_set");
        let data = event["data"].as_object().expect("data is a JSON object");
        assert_eq!(data.len(), 1);
        assert_eq!(event["data"]["amount"], "0.25");
    }
}
