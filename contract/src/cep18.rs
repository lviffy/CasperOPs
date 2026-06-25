//! BlockOps CEP-18 fungible token (Casper ERC-20 equivalent).
//!
//! This is a minimal CEP-18-compatible token used by the BlockOps x402 payment
//! flow. It supports the standard `transfer`, `transfer_from`, `approve`,
//! `balance_of`, `allowance`, `total_supply`, and `burn` entry points. The full
//! CEP-18 specification (https://github.com/casper-network/CEP) is intentionally
//! narrowed to the surface BlockOps needs; extend it if your deployment
//! requires additional compliance hooks.

use casper_event_standard::Event;
use odra::prelude::*;
use odra::casper_types::U256;

#[derive(Event, Debug, PartialEq, Eq)]
pub struct Burn {
    pub holder: Address,
    pub amount: U256,
}

#[odra::module]
pub struct Cep18Token {
    pub name: Var<String>,
    pub symbol: Var<String>,
    pub decimals: Var<u8>,
    pub total_supply: Var<U256>,
    pub balances: Mapping<Address, U256>,
    pub allowances: Mapping<(Address, Address), U256>,
}

#[odra::module]
impl Cep18Token {
    pub fn init(
        &mut self,
        name: String,
        symbol: String,
        decimals: u8,
        total_supply: U256,
    ) {
        self.name.set(name);
        self.symbol.set(symbol);
        self.decimals.set(decimals);
        self.total_supply.set(total_supply);
        let deployer = self.env().caller();
        self.balances.set(&deployer, total_supply);
    }

    pub fn transfer(&mut self, recipient: Address, amount: U256) {
        let caller = self.env().caller();
        self.move_tokens(&caller, &recipient, amount);
    }

    pub fn approve(&mut self, spender: Address, amount: U256) {
        let caller = self.env().caller();
        self.allowances.set(&(caller, spender), amount);
    }

    pub fn transfer_from(&mut self, owner: Address, recipient: Address, amount: U256) {
        let caller = self.env().caller();
        let allowance = self.allowances.get(&(owner, caller)).unwrap_or(U256::zero());
        if allowance < amount {
            self.env().revert(Error::InsufficientAllowance);
        }
        self.allowances.set(&(owner, caller), allowance - amount);
        self.move_tokens(&owner, &recipient, amount);
    }

    /// Holder burns `amount` of their own balance. Total supply decreases.
    pub fn burn(&mut self, amount: U256) {
        let caller = self.env().caller();
        let balance = self.balances.get(&caller).unwrap_or(U256::zero());
        if balance < amount {
            self.env().revert(Error::InsufficientBalance);
        }
        self.balances.set(&caller, balance - amount);
        let total = self.total_supply.get_or_default();
        self.total_supply.set(total - amount);
        self.env().emit_event(Burn {
            holder: caller,
            amount,
        });
    }

    pub fn balance_of(&self, owner: Address) -> U256 {
        self.balances.get(&owner).unwrap_or(U256::zero())
    }

    pub fn allowance(&self, owner: Address, spender: Address) -> U256 {
        self.allowances.get(&(owner, spender)).unwrap_or(U256::zero())
    }

    pub fn total_supply(&self) -> U256 {
        self.total_supply.get_or_default()
    }
}

impl Cep18Token {
    fn move_tokens(&mut self, from: &Address, to: &Address, amount: U256) {
        let from_balance = self.balances.get(from).unwrap_or(U256::zero());
        if from_balance < amount {
            self.env().revert(Error::InsufficientBalance);
        }
        let to_balance = self.balances.get(to).unwrap_or(U256::zero());
        self.balances.set(from, from_balance - amount);
        self.balances.set(to, to_balance + amount);
    }
}

#[odra::odra_error]
pub enum Error {
    InsufficientBalance = 1,
    InsufficientAllowance = 2,
}

#[cfg(test)]
mod tests {
    use super::{Burn, Cep18Token};
    use casper_event_standard::EventInstance;
    use odra::casper_types::U256;
    use odra::host::Deployer;
    use odra::OdraContract;

    type Cep18TokenHostRef = <Cep18Token as OdraContract>::HostRef;

    fn deploy_with_supply(supply: u64) -> (odra::host::HostEnv, Cep18TokenHostRef) {
        let env = odra_test::env();
        let token = Cep18Token::deploy(
            &env,
            super::__cep18_token_test_parts::Cep18TokenInitArgs {
                name: "BlockOps Token".to_string(),
                symbol: "BOPS".to_string(),
                decimals: 9,
                total_supply: U256::from(supply),
            },
        );
        (env, token)
    }

    #[test]
    fn test_cep18_initial_supply_assigned_to_deployer() {
        let (env, token) = deploy_with_supply(1_000_000);
        let deployer = env.get_account(0);
        assert_eq!(token.balance_of(deployer), U256::from(1_000_000));
        assert_eq!(token.total_supply(), U256::from(1_000_000));
    }

    #[test]
    fn test_cep18_transfer_moves_balance() {
        let (env, mut token) = deploy_with_supply(1_000_000);
        let deployer = env.get_account(0);
        let recipient = env.get_account(1);
        env.set_caller(deployer);
        token.transfer(recipient, U256::from(250));
        assert_eq!(token.balance_of(deployer), U256::from(1_000_000 - 250));
        assert_eq!(token.balance_of(recipient), U256::from(250));
    }

    #[test]
    #[should_panic]
    fn test_cep18_transfer_reverts_on_insufficient_balance() {
        let (env, mut token) = deploy_with_supply(100);
        let recipient = env.get_account(1);
        env.set_caller(env.get_account(0));
        token.transfer(recipient, U256::from(200));
    }

    #[test]
    fn test_cep18_approve_and_transfer_from() {
        let (env, mut token) = deploy_with_supply(1_000);
        let owner = env.get_account(0);
        let spender = env.get_account(1);
        let recipient = env.get_account(2);
        env.set_caller(owner);
        token.approve(spender, U256::from(400));
        assert_eq!(token.allowance(owner, spender), U256::from(400));
        env.set_caller(spender);
        token.transfer_from(owner, recipient, U256::from(150));
        assert_eq!(token.balance_of(owner), U256::from(1_000 - 150));
        assert_eq!(token.balance_of(recipient), U256::from(150));
        assert_eq!(token.allowance(owner, spender), U256::from(250));
    }

    #[test]
    #[should_panic]
    fn test_cep18_transfer_from_reverts_on_insufficient_allowance() {
        let (env, mut token) = deploy_with_supply(1_000);
        let owner = env.get_account(0);
        let spender = env.get_account(1);
        let recipient = env.get_account(2);
        env.set_caller(owner);
        token.approve(spender, U256::from(100));
        env.set_caller(spender);
        token.transfer_from(owner, recipient, U256::from(500));
    }

    #[test]
    fn test_cep18_burn_reduces_balance_and_total_supply() {
        let (env, mut token) = deploy_with_supply(1_000);
        let holder = env.get_account(0);
        env.set_caller(holder);
        token.burn(U256::from(300));
        assert_eq!(token.balance_of(holder), U256::from(700));
        assert_eq!(token.total_supply(), U256::from(700));
    }

    #[test]
    #[should_panic]
    fn test_cep18_burn_reverts_on_insufficient_balance() {
        let (env, mut token) = deploy_with_supply(100);
        env.set_caller(env.get_account(0));
        token.burn(U256::from(200));
    }

    #[test]
    #[should_panic]
    fn test_cep18_burn_reverts_when_caller_has_no_balance() {
        let (env, mut token) = deploy_with_supply(100);
        let other = env.get_account(2);
        env.set_caller(other);
        token.burn(U256::from(1));
    }

    #[test]
    fn test_cep18_burn_only_affects_caller() {
        let (env, mut token) = deploy_with_supply(1_000);
        let deployer = env.get_account(0);
        let other = env.get_account(1);
        env.set_caller(deployer);
        token.transfer(other, U256::from(400));
        env.set_caller(other);
        token.burn(U256::from(400));
        assert_eq!(token.balance_of(other), U256::zero());
        assert_eq!(token.balance_of(deployer), U256::from(600));
        assert_eq!(token.total_supply(), U256::from(600));
    }

    #[test]
    fn test_cep18_burn_emits_event() {
        let (env, mut token) = deploy_with_supply(1_000);
        let holder = env.get_account(0);
        env.set_caller(holder);
        token.burn(U256::from(123));
        assert!(
            env.emitted(&token, Burn::name().as_str()),
            "expected Burn event to be emitted"
        );
    }

    #[test]
    fn test_cep18_burn_full_balance_zeros_total_supply() {
        let (env, mut token) = deploy_with_supply(1_000);
        let holder = env.get_account(0);
        env.set_caller(holder);
        token.burn(U256::from(1_000));
        assert_eq!(token.balance_of(holder), U256::zero());
        assert_eq!(token.total_supply(), U256::zero());
    }
}
