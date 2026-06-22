//! BlockOps CEP-18 fungible token (Casper ERC-20 equivalent).
//!
//! This is a minimal CEP-18-compatible token used by the BlockOps x402 payment
//! flow. It supports the standard `transfer`, `transfer_from`, `approve`,
//! `balance_of`, `allowance`, and `total_supply` entry points. The full CEP-18
//! specification (https://github.com/casper-network/CEP) is intentionally
//! narrowed to the surface BlockOps needs; extend it if your deployment
//! requires additional compliance hooks.

use odra::prelude::*;
use odra::casper_types::U256;

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
