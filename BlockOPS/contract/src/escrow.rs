use odra::prelude::*;
use odra::casper_types::U512;

#[odra::module]
pub struct Escrow {
    pub deposits: Mapping<Address, U512>,
    pub authorized_backend: Var<Address>,
    pub treasury: Var<Address>,
}

#[odra::module]
impl Escrow {
    pub fn init(&mut self, backend: Address, treasury: Address) {
        self.authorized_backend.set(backend);
        self.treasury.set(treasury);
    }

    #[odra(payable)]
    pub fn deposit(&mut self, agent: Address) {
        let amount = self.env().attached_value();
        let balance = self.deposits.get(&agent).unwrap_or(U512::zero());
        self.deposits.set(&agent, balance + amount);
    }

    pub fn execute_payout(&mut self, agent: Address) {
        let caller = self.env().caller();
        let backend = self.authorized_backend.get_or_revert_with(Error::Unauthorized);
        if caller != backend {
            self.env().revert(Error::Unauthorized);
        }
        let amount = self.deposits.get(&agent).unwrap_or(U512::zero());
        if amount == U512::zero() {
            self.env().revert(Error::InsufficientBalance);
        }
        self.deposits.set(&agent, U512::zero());
        let treasury = self.treasury.get_or_revert_with(Error::Unauthorized);
        self.env().transfer_tokens(&treasury, &amount);
    }

    pub fn refund(&mut self, agent: Address, user: Address) {
        let caller = self.env().caller();
        let backend = self.authorized_backend.get_or_revert_with(Error::Unauthorized);
        if caller != backend {
            self.env().revert(Error::Unauthorized);
        }
        let amount = self.deposits.get(&agent).unwrap_or(U512::zero());
        if amount == U512::zero() {
            self.env().revert(Error::InsufficientBalance);
        }
        self.deposits.set(&agent, U512::zero());
        self.env().transfer_tokens(&user, &amount);
    }

    pub fn get_balance(&self, agent: Address) -> U512 {
        self.deposits.get(&agent).unwrap_or(U512::zero())
    }
}

#[odra::odra_error]
pub enum Error {
    Unauthorized = 1,
    InsufficientBalance = 2,
}

#[cfg(test)]
mod tests {
    use super::Escrow;
    use odra::host::{Deployer, HostRef};
    use odra::casper_types::U512;

    #[test]
    fn test_escrow_initial_state() {
        let env = odra_test::env();
        let backend = env.get_account(0);
        let treasury = env.get_account(1);
        let agent = env.get_account(2);
        
        let escrow = Escrow::deploy(
            &env,
            super::__escrow_test_parts::EscrowInitArgs { backend, treasury }
        );
        
        assert_eq!(escrow.get_balance(agent), U512::zero());
    }

    #[test]
    fn test_escrow_deposit_and_payout() {
        let env = odra_test::env();
        let backend = env.get_account(0);
        let treasury = env.get_account(1);
        let agent = env.get_account(2);
        let depositor = env.get_account(3);
        
        let mut escrow = Escrow::deploy(
            &env,
            super::__escrow_test_parts::EscrowInitArgs { backend, treasury }
        );
        
        // Deposit tokens
        env.set_caller(depositor);
        let amount = U512::from(1000);
        escrow.with_tokens(amount).deposit(agent);
        
        assert_eq!(escrow.get_balance(agent), amount);

        // Execute payout by backend
        env.set_caller(backend);
        escrow.execute_payout(agent);
        
        assert_eq!(escrow.get_balance(agent), U512::zero());
    }

    #[test]
    fn test_escrow_deposit_and_refund() {
        let env = odra_test::env();
        let backend = env.get_account(0);
        let treasury = env.get_account(1);
        let agent = env.get_account(2);
        let depositor = env.get_account(3);
        
        let mut escrow = Escrow::deploy(
            &env,
            super::__escrow_test_parts::EscrowInitArgs { backend, treasury }
        );
        
        // Deposit tokens
        env.set_caller(depositor);
        let amount = U512::from(1000);
        escrow.with_tokens(amount).deposit(agent);
        
        assert_eq!(escrow.get_balance(agent), amount);

        // Refund to depositor by backend
        env.set_caller(backend);
        escrow.refund(agent, depositor);
        
        assert_eq!(escrow.get_balance(agent), U512::zero());
    }

    #[test]
    #[should_panic]
    fn test_escrow_unauthorized_payout() {
        let env = odra_test::env();
        let backend = env.get_account(0);
        let treasury = env.get_account(1);
        let agent = env.get_account(2);
        let non_backend = env.get_account(3);
        
        let mut escrow = Escrow::deploy(
            &env,
            super::__escrow_test_parts::EscrowInitArgs { backend, treasury }
        );
        
        // Try executing payout as non_backend
        env.set_caller(non_backend);
        escrow.execute_payout(agent);
    }
}

