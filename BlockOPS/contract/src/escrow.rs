use odra::prelude::*;
use odra::casper_types::U512;

#[odra::module]
pub struct Escrow {
    pub deposits: Mapping<Address, U512>,
    pub authorized_backend: Var<Address>,
    pub treasury: Var<Address>,
    pub daily_limit: Mapping<Address, U512>,
    pub expires_at: Mapping<Address, u64>, // Expiry in milliseconds
    pub daily_spent: Mapping<Address, U512>,
    pub last_spent_reset: Mapping<Address, u64>,
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

    pub fn execute_payout_bounded(&mut self, agent: Address, amount: U512) {
        let caller = self.env().caller();
        let backend = self.authorized_backend.get_or_revert_with(Error::Unauthorized);
        if caller != backend {
            self.env().revert(Error::Unauthorized);
        }

        // Check if agent's key is expired
        let expiry = self.expires_at.get(&agent).unwrap_or(0);
        let now = self.env().get_block_time();
        if expiry > 0 && now > expiry {
            self.env().revert(Error::AgentKeyExpired);
        }

        // Check and update daily spent
        let limit = self.daily_limit.get(&agent).unwrap_or(U512::zero());
        if limit > U512::zero() {
            let last_reset = self.last_spent_reset.get(&agent).unwrap_or(0);
            let mut spent = self.daily_spent.get(&agent).unwrap_or(U512::zero());
            
            // 24 hours = 86_400_000 milliseconds
            if now >= last_reset + 86_400_000 {
                spent = U512::zero();
                self.last_spent_reset.set(&agent, now);
            }

            if spent + amount > limit {
                self.env().revert(Error::DailyLimitExceeded);
            }

            self.daily_spent.set(&agent, spent + amount);
        }

        // Standard payout deduction & transfer
        let balance = self.deposits.get(&agent).unwrap_or(U512::zero());
        if balance < amount {
            self.env().revert(Error::InsufficientBalance);
        }
        self.deposits.set(&agent, balance - amount);

        let treasury = self.treasury.get_or_revert_with(Error::Unauthorized);
        self.env().transfer_tokens(&treasury, &amount);
    }

    pub fn set_agent_limits(&mut self, agent: Address, daily_limit: U512, expires_at: u64) {
        let caller = self.env().caller();
        let backend = self.authorized_backend.get_or_revert_with(Error::Unauthorized);
        if caller != backend {
            self.env().revert(Error::Unauthorized);
        }
        self.daily_limit.set(&agent, daily_limit);
        self.expires_at.set(&agent, expires_at);
        self.daily_spent.set(&agent, U512::zero());
        self.last_spent_reset.set(&agent, self.env().get_block_time());
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

    pub fn set_treasury(&mut self, new_treasury: Address) {
        let caller = self.env().caller();
        let backend = self.authorized_backend.get_or_revert_with(Error::Unauthorized);
        if caller != backend {
            self.env().revert(Error::Unauthorized);
        }
        self.treasury.set(new_treasury);
    }

    pub fn get_balance(&self, agent: Address) -> U512 {
        self.deposits.get(&agent).unwrap_or(U512::zero())
    }

    pub fn get_daily_limit(&self, agent: Address) -> U512 {
        self.daily_limit.get(&agent).unwrap_or(U512::zero())
    }

    pub fn get_expires_at(&self, agent: Address) -> u64 {
        self.expires_at.get(&agent).unwrap_or(0)
    }

    pub fn get_daily_spent(&self, agent: Address) -> U512 {
        self.daily_spent.get(&agent).unwrap_or(U512::zero())
    }

    pub fn get_last_spent_reset(&self, agent: Address) -> u64 {
        self.last_spent_reset.get(&agent).unwrap_or(0)
    }
}

#[odra::odra_error]
pub enum Error {
    Unauthorized = 1,
    InsufficientBalance = 2,
    AgentKeyExpired = 3,
    DailyLimitExceeded = 4,
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
        assert_eq!(escrow.get_daily_limit(agent), U512::zero());
        assert_eq!(escrow.get_expires_at(agent), 0);
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
    fn test_escrow_set_limits_and_execute_payout_bounded() {
        let env = odra_test::env();
        let backend = env.get_account(0);
        let treasury = env.get_account(1);
        let agent = env.get_account(2);
        let depositor = env.get_account(3);

        let mut escrow = Escrow::deploy(
            &env,
            super::__escrow_test_parts::EscrowInitArgs { backend, treasury }
        );

        // Deposit
        env.set_caller(depositor);
        escrow.with_tokens(U512::from(2000)).deposit(agent);

        // Set agent limits: daily limit = 500, expiry = block time + 10,000 ms
        env.set_caller(backend);
        let now = env.block_time();
        let expiry = now + 10000;
        escrow.set_agent_limits(agent, U512::from(500), expiry);

        assert_eq!(escrow.get_daily_limit(agent), U512::from(500));
        assert_eq!(escrow.get_expires_at(agent), expiry);

        // Payout within limit
        escrow.execute_payout_bounded(agent, U512::from(300));
        assert_eq!(escrow.get_balance(agent), U512::from(1700));
        assert_eq!(escrow.get_daily_spent(agent), U512::from(300));
    }

    #[test]
    #[should_panic]
    fn test_escrow_daily_limit_exceeded_panics() {
        let env = odra_test::env();
        let backend = env.get_account(0);
        let treasury = env.get_account(1);
        let agent = env.get_account(2);
        let depositor = env.get_account(3);

        let mut escrow = Escrow::deploy(
            &env,
            super::__escrow_test_parts::EscrowInitArgs { backend, treasury }
        );

        env.set_caller(depositor);
        escrow.with_tokens(U512::from(2000)).deposit(agent);

        env.set_caller(backend);
        let now = env.block_time();
        escrow.set_agent_limits(agent, U512::from(500), now + 10000);

        // This will exceed daily limit and panic
        escrow.execute_payout_bounded(agent, U512::from(501));
    }

    #[test]
    #[should_panic]
    fn test_escrow_expiry_enforced() {
        let env = odra_test::env();
        let backend = env.get_account(0);
        let treasury = env.get_account(1);
        let agent = env.get_account(2);
        let depositor = env.get_account(3);

        let mut escrow = Escrow::deploy(
            &env,
            super::__escrow_test_parts::EscrowInitArgs { backend, treasury }
        );

        // Deposit
        env.set_caller(depositor);
        escrow.with_tokens(U512::from(1000)).deposit(agent);

        // Set limits: daily limit = 1000, expiry = now + 10 ms
        env.set_caller(backend);
        let now = env.block_time();
        escrow.set_agent_limits(agent, U512::from(1000), now + 10);

        // Advance block time past expiry
        env.advance_block_time(20);

        // Payout should fail with AgentKeyExpired
        escrow.execute_payout_bounded(agent, U512::from(500));
    }

    #[test]
    fn test_escrow_daily_spent_resets_after_24_hours() {
        let env = odra_test::env();
        let backend = env.get_account(0);
        let treasury = env.get_account(1);
        let agent = env.get_account(2);
        let depositor = env.get_account(3);

        let mut escrow = Escrow::deploy(
            &env,
            super::__escrow_test_parts::EscrowInitArgs { backend, treasury }
        );

        // Deposit
        env.set_caller(depositor);
        escrow.with_tokens(U512::from(2000)).deposit(agent);

        // Set limit = 500, expiry = now + 100 hours
        env.set_caller(backend);
        let now = env.block_time();
        escrow.set_agent_limits(agent, U512::from(500), now + 360_000_000);

        // Spend 300
        escrow.execute_payout_bounded(agent, U512::from(300));

        // Advance 25 hours (90,000,000 milliseconds)
        env.advance_block_time(90_000_000);

        // We should be able to spend another 300 (which otherwise would exceed the rolling 500 limit)
        escrow.execute_payout_bounded(agent, U512::from(300));
        assert_eq!(escrow.get_balance(agent), U512::from(1400));
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

    #[test]
    #[should_panic]
    fn test_escrow_unauthorized_refund() {
        let env = odra_test::env();
        let backend = env.get_account(0);
        let treasury = env.get_account(1);
        let agent = env.get_account(2);
        let attacker = env.get_account(3);

        let mut escrow = Escrow::deploy(
            &env,
            super::__escrow_test_parts::EscrowInitArgs { backend, treasury }
        );

        env.set_caller(attacker);
        escrow.refund(agent, attacker);
    }

    #[test]
    #[should_panic]
    fn test_escrow_payout_zero_balance_reverts() {
        let env = odra_test::env();
        let backend = env.get_account(0);
        let treasury = env.get_account(1);
        let agent = env.get_account(2);

        let mut escrow = Escrow::deploy(
            &env,
            super::__escrow_test_parts::EscrowInitArgs { backend, treasury }
        );

        env.set_caller(backend);
        escrow.execute_payout(agent);
    }

    #[test]
    fn test_escrow_multiple_deposits_accumulate() {
        let env = odra_test::env();
        let backend = env.get_account(0);
        let treasury = env.get_account(1);
        let agent = env.get_account(2);
        let depositor_a = env.get_account(3);
        let depositor_b = env.get_account(4);

        let escrow = Escrow::deploy(
            &env,
            super::__escrow_test_parts::EscrowInitArgs { backend, treasury }
        );

        env.set_caller(depositor_a);
        escrow.with_tokens(U512::from(400)).deposit(agent);
        env.set_caller(depositor_b);
        escrow.with_tokens(U512::from(600)).deposit(agent);

        assert_eq!(escrow.get_balance(agent), U512::from(1000));
    }

    #[test]
    fn test_escrow_set_treasury_updates_treasury() {
        let env = odra_test::env();
        let backend = env.get_account(0);
        let treasury = env.get_account(1);
        let new_treasury = env.get_account(2);

        let mut escrow = Escrow::deploy(
            &env,
            super::__escrow_test_parts::EscrowInitArgs { backend, treasury }
        );

        env.set_caller(backend);
        escrow.set_treasury(new_treasury);
        // No getter for treasury, but the operation should succeed and not
        // affect deposit behavior. Round-trip a deposit + payout to the new
        // treasury to confirm.
        let agent = env.get_account(3);
        let depositor = env.get_account(4);
        env.set_caller(depositor);
        escrow.with_tokens(U512::from(500)).deposit(agent);
        env.set_caller(backend);
        escrow.execute_payout(agent);
        assert_eq!(escrow.get_balance(agent), U512::zero());
    }

    #[test]
    #[should_panic]
    fn test_escrow_set_treasury_unauthorized() {
        let env = odra_test::env();
        let backend = env.get_account(0);
        let treasury = env.get_account(1);
        let attacker = env.get_account(2);

        let mut escrow = Escrow::deploy(
            &env,
            super::__escrow_test_parts::EscrowInitArgs { backend, treasury }
        );

        env.set_caller(attacker);
        escrow.set_treasury(attacker);
    }
}


