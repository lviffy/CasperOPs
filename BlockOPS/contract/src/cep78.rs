//! BlockOps CEP-78 NFT collection (Casper ERC-721 equivalent).
//!
//! Minimal CEP-78-compatible NFT contract used by the BlockOps workflow
//! builder when minting receipts, agent avatars, or other on-chain assets.
//! The full CEP-78 spec (https://github.com/casper-network/CEP) is narrowed to
//! the surface BlockOps needs; extend it if your deployment requires
//! additional metadata mutability or ownership modes.

use casper_event_standard::Event;
use odra::prelude::*;
use odra::casper_types::U256;

#[derive(Event, Debug, PartialEq, Eq)]
pub struct Burn {
    pub token_id: U256,
    pub owner: Address,
}

#[odra::module]
pub struct Cep78Nft {
    pub collection_name: Var<String>,
    pub collection_symbol: Var<String>,
    pub total_token_supply: Var<u64>,
    pub minted: Var<u64>,
    pub burned: Var<u64>,
    pub minter: Var<Address>,
    pub owner_of: Mapping<U256, Address>,
    pub burned_tokens: Mapping<U256, bool>,
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
        minter: Address,
    ) {
        self.collection_name.set(collection_name);
        self.collection_symbol.set(collection_symbol);
        self.total_token_supply.set(total_token_supply);
        self.minter.set(minter);
        self.minted.set(0);
        self.burned.set(0);
    }

    pub fn mint(&mut self, recipient: Address) -> U256 {
        let caller = self.env().caller();
        let minter = self.minter.get_or_revert_with(Error::NotInitialized);
        let self_addr = self.env().self_address();
        if caller != minter && caller != self_addr {
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

    pub fn set_minter(&mut self, new_minter: Address) {
        let caller = self.env().caller();
        let minter = self.minter.get_or_revert_with(Error::NotInitialized);
        if caller != minter {
            self.env().revert(Error::Unauthorized);
        }
        self.minter.set(new_minter);
    }

    pub fn transfer(&mut self, from: Address, to: Address, token_id: U256) {
        self.require_live(token_id);
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
        self.require_live(token_id);
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

    /// Token owner burns their own token. The token ID is marked burned in
    /// `burned_tokens` so subsequent transfer/approve/owner_of calls revert,
    /// and the caller's balance is decremented.
    pub fn burn(&mut self, token_id: U256) {
        let caller = self.env().caller();
        if self.burned_tokens.get(&token_id).unwrap_or(false) {
            self.env().revert(Error::TokenNotFound);
        }
        let owner = self.owner_of.get(&token_id).unwrap_or_else(|| {
            self.env().revert(Error::TokenNotFound);
        });
        if caller != owner && !self.is_approved_or_operator(caller, owner, token_id) {
            self.env().revert(Error::Unauthorized);
        }
        let balance = self.balance_of.get(&owner).unwrap_or(U256::zero());
        if balance == U256::zero() {
            self.env().revert(Error::InsufficientBalance);
        }
        self.balance_of.set(&owner, balance - U256::one());
        self.burned_tokens.set(&token_id, true);
        self.token_approvals.set(&token_id, caller);
        let burned_count = self.burned.get_or_default();
        self.burned.set(burned_count + 1);
        self.env().emit_event(Burn {
            token_id,
            owner,
        });
    }

    pub fn owner_of(&self, token_id: U256) -> Address {
        if self.burned_tokens.get(&token_id).unwrap_or(false) {
            self.env().revert(Error::TokenNotFound);
        }
        self.owner_of
            .get(&token_id)
            .unwrap_or_else(|| self.env().revert(Error::TokenNotFound))
    }

    pub fn is_burned(&self, token_id: U256) -> bool {
        self.burned_tokens.get(&token_id).unwrap_or(false)
    }

    pub fn balance_of_view(&self, owner: Address) -> U256 {
        self.balance_of.get(&owner).unwrap_or(U256::zero())
    }

    pub fn total_supply(&self) -> u64 {
        self.minted.get_or_default()
    }

    pub fn burned_count(&self) -> u64 {
        self.burned.get_or_default()
    }

    pub fn live_supply(&self) -> u64 {
        let minted = self.minted.get_or_default();
        let burned = self.burned.get_or_default();
        minted.saturating_sub(burned)
    }
}

impl Cep78Nft {
    fn require_live(&self, token_id: U256) {
        if self.burned_tokens.get(&token_id).unwrap_or(false) {
            self.env().revert(Error::TokenNotFound);
        }
    }

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
    InsufficientBalance = 6,
    NotInitialized = 7,
}

#[cfg(test)]
mod tests {
    use super::{Burn, Cep78Nft};
    use casper_event_standard::EventInstance;
    use odra::casper_types::U256;
    use odra::host::Deployer;
    use odra::OdraContract;

    type Cep78NftHostRef = <Cep78Nft as OdraContract>::HostRef;

    fn deploy_collection(cap: u64) -> (odra::host::HostEnv, Cep78NftHostRef) {
        let env = odra_test::env();
        let minter = env.get_account(0);
        let nft = Cep78Nft::deploy(
            &env,
            super::__cep78_nft_test_parts::Cep78NftInitArgs {
                collection_name: "BlockOps Agents".to_string(),
                collection_symbol: "BOPA".to_string(),
                total_token_supply: cap,
                minter,
            },
        );
        (env, nft)
    }

    #[test]
    fn test_cep78_initial_state() {
        let (_env, nft) = deploy_collection(100);
        assert_eq!(nft.total_supply(), 0);
        assert_eq!(nft.burned_count(), 0);
        assert_eq!(nft.live_supply(), 0);
    }

    #[test]
    fn test_cep78_mint_assigns_sequential_ids() {
        let (env, mut nft) = deploy_collection(10);
        let owner = env.get_account(0);
        let alice = env.get_account(1);
        let bob = env.get_account(2);
        env.set_caller(owner);
        let id_a = nft.mint(alice);
        let id_b = nft.mint(bob);
        assert_eq!(id_a, U256::from(1));
        assert_eq!(id_b, U256::from(2));
        assert_eq!(nft.balance_of_view(alice), U256::one());
        assert_eq!(nft.balance_of_view(bob), U256::one());
    }

    #[test]
    #[should_panic]
    fn test_cep78_mint_reverts_for_non_owner() {
        let (env, mut nft) = deploy_collection(10);
        let attacker = env.get_account(1);
        env.set_caller(attacker);
        nft.mint(attacker);
    }

    #[test]
    #[should_panic]
    fn test_cep78_mint_reverts_when_cap_reached() {
        let (env, mut nft) = deploy_collection(2);
        let owner = env.get_account(0);
        let recipient = env.get_account(1);
        env.set_caller(owner);
        nft.mint(recipient);
        nft.mint(recipient);
        nft.mint(recipient);
    }

    #[test]
    fn test_cep78_transfer_moves_ownership_and_balance() {
        let (env, mut nft) = deploy_collection(10);
        let owner = env.get_account(0);
        let alice = env.get_account(1);
        let bob = env.get_account(2);
        env.set_caller(owner);
        let token_id = nft.mint(alice);
        env.set_caller(alice);
        nft.transfer(alice, bob, token_id);
        assert_eq!(nft.owner_of(token_id), bob);
        assert_eq!(nft.balance_of_view(alice), U256::zero());
        assert_eq!(nft.balance_of_view(bob), U256::one());
    }

    #[test]
    #[should_panic]
    fn test_cep78_transfer_reverts_for_unauthorized_caller() {
        let (env, mut nft) = deploy_collection(10);
        let owner = env.get_account(0);
        let alice = env.get_account(1);
        let bob = env.get_account(2);
        let attacker = env.get_account(3);
        env.set_caller(owner);
        let token_id = nft.mint(alice);
        env.set_caller(attacker);
        nft.transfer(alice, bob, token_id);
    }

    #[test]
    fn test_cep78_burn_clears_ownership_and_decrements_balance() {
        let (env, mut nft) = deploy_collection(10);
        let owner = env.get_account(0);
        let alice = env.get_account(1);
        env.set_caller(owner);
        let token_id = nft.mint(alice);
        assert_eq!(nft.balance_of_view(alice), U256::one());

        env.set_caller(alice);
        nft.burn(token_id);
        assert_eq!(nft.balance_of_view(alice), U256::zero());
        assert_eq!(nft.burned_count(), 1);
        assert_eq!(nft.live_supply(), 0);
        assert!(nft.is_burned(token_id));
    }

    #[test]
    #[should_panic]
    fn test_cep78_burn_reverts_for_non_owner_non_approved() {
        let (env, mut nft) = deploy_collection(10);
        let owner = env.get_account(0);
        let alice = env.get_account(1);
        let attacker = env.get_account(2);
        env.set_caller(owner);
        let token_id = nft.mint(alice);
        env.set_caller(attacker);
        nft.burn(token_id);
    }

    #[test]
    #[should_panic]
    fn test_cep78_burn_reverts_for_unknown_token() {
        let (_env, mut nft) = deploy_collection(10);
        nft.burn(U256::from(999));
    }

    #[test]
    fn test_cep78_burn_emits_event() {
        let (env, mut nft) = deploy_collection(10);
        let owner = env.get_account(0);
        let alice = env.get_account(1);
        env.set_caller(owner);
        let token_id = nft.mint(alice);
        env.set_caller(alice);
        nft.burn(token_id);
        assert!(
            env.emitted(&nft, Burn::name().as_str()),
            "expected Burn event to be emitted"
        );
    }

    #[test]
    fn test_cep78_burn_via_operator_approval() {
        let (env, mut nft) = deploy_collection(10);
        let owner = env.get_account(0);
        let alice = env.get_account(1);
        let operator = env.get_account(2);
        env.set_caller(owner);
        let token_id = nft.mint(alice);
        env.set_caller(alice);
        nft.set_approval_for_all(operator, true);
        env.set_caller(operator);
        nft.burn(token_id);
        assert_eq!(nft.balance_of_view(alice), U256::zero());
        assert_eq!(nft.burned_count(), 1);
    }

    #[test]
    #[should_panic]
    fn test_cep78_burn_twice_reverts_on_second_call() {
        let (env, mut nft) = deploy_collection(10);
        let owner = env.get_account(0);
        let alice = env.get_account(1);
        env.set_caller(owner);
        let token_id = nft.mint(alice);
        env.set_caller(alice);
        nft.burn(token_id);
        // Second burn: token is marked burned, so it reverts.
        nft.burn(token_id);
    }

    #[test]
    fn test_cep78_live_supply_tracks_mints_minus_burns() {
        let (env, mut nft) = deploy_collection(10);
        let owner = env.get_account(0);
        let alice = env.get_account(1);
        env.set_caller(owner);
        let id_1 = nft.mint(alice);
        let _id_2 = nft.mint(alice);
        let _id_3 = nft.mint(alice);
        assert_eq!(nft.total_supply(), 3);
        assert_eq!(nft.live_supply(), 3);

        env.set_caller(alice);
        nft.burn(id_1);
        assert_eq!(nft.total_supply(), 3);
        assert_eq!(nft.burned_count(), 1);
        assert_eq!(nft.live_supply(), 2);
    }

    #[test]
    fn test_cep78_set_minter_transfers_minter_role() {
        let (env, mut nft) = deploy_collection(10);
        let old_minter = env.get_account(0);
        let new_minter = env.get_account(1);
        let recipient = env.get_account(2);
        env.set_caller(old_minter);
        nft.set_minter(new_minter);
        // Old minter can no longer mint.
        env.set_caller(old_minter);
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            nft.mint(recipient);
        }));
        assert!(result.is_err());
        // New minter can mint.
        env.set_caller(new_minter);
        let id = nft.mint(recipient);
        assert_eq!(id, U256::from(1));
    }

    #[test]
    #[should_panic]
    fn test_cep78_set_minter_reverts_for_non_minter() {
        let (env, mut nft) = deploy_collection(10);
        let attacker = env.get_account(3);
        env.set_caller(attacker);
        nft.set_minter(attacker);
    }

    #[test]
    #[should_panic]
    fn test_cep78_transfer_burned_token_reverts() {
        let (env, mut nft) = deploy_collection(10);
        let owner = env.get_account(0);
        let alice = env.get_account(1);
        let bob = env.get_account(2);
        env.set_caller(owner);
        let token_id = nft.mint(alice);
        env.set_caller(alice);
        nft.burn(token_id);
        // Transfer a burned token -> revert.
        nft.transfer(alice, bob, token_id);
    }
}
