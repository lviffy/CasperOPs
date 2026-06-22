//! BlockOps CEP-78 NFT collection (Casper ERC-721 equivalent).
//!
//! Minimal CEP-78-compatible NFT contract used by the BlockOps workflow
//! builder when minting receipts, agent avatars, or other on-chain assets.
//! The full CEP-78 spec (https://github.com/casper-network/CEP) is narrowed to
//! the surface BlockOps needs; extend it if your deployment requires
//! additional metadata mutability or ownership modes.

use odra::prelude::*;
use odra::casper_types::U256;

#[odra::module]
pub struct Cep78Nft {
    pub collection_name: Var<String>,
    pub collection_symbol: Var<String>,
    pub total_token_supply: Var<u64>,
    pub minted: Var<u64>,
    pub owner_of: Mapping<U256, Address>,
    pub balance_of: Mapping<Address, U256>,
    pub token_approvals: Mapping<U256, Address>,
    pub operator_approvals: Mapping<(Address, Address), bool>,
}

#[odra::module]
impl Cep78Nft {
    pub fn init(
        &mut self,
        collection_name: String,
        collection_symbol: String,
        total_token_supply: u64,
    ) {
        self.collection_name.set(collection_name);
        self.collection_symbol.set(collection_symbol);
        self.total_token_supply.set(total_token_supply);
        self.minted.set(0);
    }

    pub fn mint(&mut self, recipient: Address) -> U256 {
        let caller = self.env().caller();
        let owner = self.env().self_address();
        if caller != owner {
            self.env().revert(Error::OnlyOwner);
        }
        let minted = self.minted.get_or_default();
        let cap = self.total_token_supply.get_or_default();
        if minted >= cap {
            self.env().revert(Error::SupplyExceeded);
        }
        let new_id = U256::from(minted + 1);
        self.owner_of.set(&new_id, recipient);
        let balance = self.balance_of.get(&recipient).unwrap_or(U256::zero());
        self.balance_of.set(&recipient, balance + U256::one());
        self.minted.set(minted + 1);
        new_id
    }

    pub fn transfer(&mut self, from: Address, to: Address, token_id: U256) {
        let caller = self.env().caller();
        let current_owner = self.owner_of.get(&token_id).unwrap_or_else(|| {
            self.env().revert(Error::TokenNotFound);
        });
        if caller != from && !self.is_approved_or_operator(caller, from, token_id) {
            self.env().revert(Error::Unauthorized);
        }
        if current_owner != from {
            self.env().revert(Error::NotOwner);
        }
        self.owner_of.set(&token_id, to);
        let from_balance = self.balance_of.get(&from).unwrap_or(U256::zero());
        let to_balance = self.balance_of.get(&to).unwrap_or(U256::zero());
        self.balance_of.set(&from, from_balance - U256::one());
        self.balance_of.set(&to, to_balance + U256::one());
    }

    pub fn approve(&mut self, spender: Address, token_id: U256) {
        let caller = self.env().caller();
        let owner = self.owner_of.get(&token_id).unwrap_or_else(|| {
            self.env().revert(Error::TokenNotFound);
        });
        if caller != owner {
            self.env().revert(Error::NotOwner);
        }
        self.token_approvals.set(&token_id, spender);
    }

    pub fn set_approval_for_all(&mut self, operator: Address, approved: bool) {
        let caller = self.env().caller();
        self.operator_approvals.set(&(caller, operator), approved);
    }

    pub fn owner_of(&self, token_id: U256) -> Address {
        self.owner_of
            .get(&token_id)
            .unwrap_or_else(|| self.env().revert(Error::TokenNotFound))
    }

    pub fn balance_of_view(&self, owner: Address) -> U256 {
        self.balance_of.get(&owner).unwrap_or(U256::zero())
    }

    pub fn total_supply(&self) -> u64 {
        self.minted.get_or_default()
    }
}

impl Cep78Nft {
    fn is_approved_or_operator(&self, caller: Address, owner: Address, token_id: U256) -> bool {
        if let Some(approved) = self.token_approvals.get(&token_id) {
            if approved == caller {
                return true;
            }
        }
        if let Some(approved) = self.operator_approvals.get(&(owner, caller)) {
            return approved;
        }
        false
    }
}

#[odra::odra_error]
pub enum Error {
    OnlyOwner = 1,
    SupplyExceeded = 2,
    TokenNotFound = 3,
    Unauthorized = 4,
    NotOwner = 5,
}
