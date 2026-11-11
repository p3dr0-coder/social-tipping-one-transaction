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
