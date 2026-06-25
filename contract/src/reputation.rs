use odra::prelude::*;

#[odra::module]
pub struct Reputation {
    pub ratings: Mapping<Address, u32>,
    pub execution_success: Mapping<Address, u32>,
    pub execution_failures: Mapping<Address, u32>,
    pub last_attestation: Mapping<Address, u64>,
    pub validator: Var<Address>,
}

#[odra::module]
impl Reputation {
    /// 1 hour minimum gap between two attestations from the same attester
    /// for any agent. Set in milliseconds (Casper block-time unit).
    pub const ATTESTATION_COOLDOWN_MS: u64 = 60 * 60 * 1000;

    pub fn init(&mut self, validator_address: Address) {
        self.validator.set(validator_address);
    }

    pub fn set_rating(&mut self, agent: Address, rating: u32) {
        let caller = self.env().caller();
        let validator = self.validator.get_or_revert_with(Error::Unauthorized);
        if caller != validator {
            self.env().revert(Error::Unauthorized);
        }
        self.ratings.set(&agent, rating);
    }

    pub fn log_success(&mut self, agent: Address) {
        self.require_validator();
        self.enforce_cooldown();
        let succ = self.execution_success.get(&agent).unwrap_or(0);
        self.execution_success.set(&agent, succ + 1);
        self.record_attestation();
    }

    pub fn log_failure(&mut self, agent: Address) {
        self.require_validator();
        self.enforce_cooldown();
        let failures = self.execution_failures.get(&agent).unwrap_or(0);
        self.execution_failures.set(&agent, failures + 1);
        self.record_attestation();
    }

    pub fn get_rating(&self, agent: Address) -> u32 {
        self.ratings.get(&agent).unwrap_or(0)
    }

    pub fn get_stats(&self, agent: Address) -> (u32, u32) {
        let succ = self.execution_success.get(&agent).unwrap_or(0);
        let fail = self.execution_failures.get(&agent).unwrap_or(0);
        (succ, fail)
    }

    pub fn get_last_attestation(&self, attester: Address) -> u64 {
        self.last_attestation.get(&attester).unwrap_or(0)
    }
}

impl Reputation {
    fn require_validator(&self) {
        let caller = self.env().caller();
        let validator = self.validator.get_or_revert_with(Error::Unauthorized);
        if caller != validator {
            self.env().revert(Error::Unauthorized);
        }
    }

    fn enforce_cooldown(&self) {
        let caller = self.env().caller();
        if let Some(last) = self.last_attestation.get(&caller) {
            let now = self.env().get_block_time();
            if now.saturating_sub(last) < Self::ATTESTATION_COOLDOWN_MS {
                self.env().revert(Error::AttestationCooldown);
            }
        }
    }

    fn record_attestation(&mut self) {
        let caller = self.env().caller();
        let now = self.env().get_block_time();
        self.last_attestation.set(&caller, now);
    }
}

#[odra::odra_error]
pub enum Error {
    Unauthorized = 1,
    AttestationCooldown = 2,
}

#[cfg(test)]
mod tests {
    use super::Reputation;
    use odra::host::Deployer;

    #[test]
    fn test_reputation_initial_state() {
        let env = odra_test::env();
        let validator = env.get_account(0);
        let agent = env.get_account(1);
        let reputation = Reputation::deploy(
            &env,
            super::__reputation_test_parts::ReputationInitArgs { validator_address: validator }
        );
        
        assert_eq!(reputation.get_rating(agent), 0);
        let (succ, fail) = reputation.get_stats(agent);
        assert_eq!(succ, 0);
        assert_eq!(fail, 0);
    }

#[test]
    fn test_reputation_set_rating_and_stats() {
        let env = odra_test::env();
        let validator = env.get_account(0);
        let agent = env.get_account(1);

        let mut reputation = Reputation::deploy(
            &env,
            super::__reputation_test_parts::ReputationInitArgs { validator_address: validator }
        );

        env.set_caller(validator);
        reputation.set_rating(agent, 95);
        reputation.log_success(agent);
        env.advance_block_time(Reputation::ATTESTATION_COOLDOWN_MS + 1);
        reputation.log_success(agent);
        env.advance_block_time(Reputation::ATTESTATION_COOLDOWN_MS + 1);
        reputation.log_failure(agent);

        assert_eq!(reputation.get_rating(agent), 95);
        let (succ, fail) = reputation.get_stats(agent);
        assert_eq!(succ, 2);
        assert_eq!(fail, 1);
    }

    #[test]
    #[should_panic]
    fn test_reputation_unauthorized() {
        let env = odra_test::env();
        let validator = env.get_account(0);
        let non_validator = env.get_account(2);
        let agent = env.get_account(1);
        
        let mut reputation = Reputation::deploy(
            &env,
            super::__reputation_test_parts::ReputationInitArgs { validator_address: validator }
        );
        
        // Setting caller to non-validator
        env.set_caller(non_validator);
        
        // Expecting set_rating to revert/panic
        reputation.set_rating(agent, 100);
    }

    #[test]
    #[should_panic]
    fn test_reputation_log_success_unauthorized() {
        let env = odra_test::env();
        let validator = env.get_account(0);
        let attacker = env.get_account(2);
        let agent = env.get_account(1);

        let mut reputation = Reputation::deploy(
            &env,
            super::__reputation_test_parts::ReputationInitArgs { validator_address: validator }
        );

        env.set_caller(attacker);
        reputation.log_success(agent);
    }

    #[test]
    #[should_panic]
    fn test_reputation_log_failure_unauthorized() {
        let env = odra_test::env();
        let validator = env.get_account(0);
        let attacker = env.get_account(2);
        let agent = env.get_account(1);

        let mut reputation = Reputation::deploy(
            &env,
            super::__reputation_test_parts::ReputationInitArgs { validator_address: validator }
        );

        env.set_caller(attacker);
        reputation.log_failure(agent);
    }

    #[test]
    fn test_reputation_rating_can_be_updated() {
        let env = odra_test::env();
        let validator = env.get_account(0);
        let agent = env.get_account(1);

        let mut reputation = Reputation::deploy(
            &env,
            super::__reputation_test_parts::ReputationInitArgs { validator_address: validator }
        );

        env.set_caller(validator);
        reputation.set_rating(agent, 50);
        assert_eq!(reputation.get_rating(agent), 50);
        reputation.set_rating(agent, 90);
        assert_eq!(reputation.get_rating(agent), 90);
    }

    #[test]
    fn test_reputation_stats_are_per_agent() {
        let env = odra_test::env();
        let validator = env.get_account(0);
        let agent_a = env.get_account(1);
        let agent_b = env.get_account(2);

        let mut reputation = Reputation::deploy(
            &env,
            super::__reputation_test_parts::ReputationInitArgs { validator_address: validator }
        );

        env.set_caller(validator);
        reputation.log_success(agent_a);
        env.advance_block_time(Reputation::ATTESTATION_COOLDOWN_MS + 1);
        reputation.log_success(agent_a);
        env.advance_block_time(Reputation::ATTESTATION_COOLDOWN_MS + 1);
        reputation.log_failure(agent_b);

        let (succ_a, fail_a) = reputation.get_stats(agent_a);
        assert_eq!(succ_a, 2);
        assert_eq!(fail_a, 0);

        let (succ_b, fail_b) = reputation.get_stats(agent_b);
        assert_eq!(succ_b, 0);
        assert_eq!(fail_b, 1);
    }

    #[test]
    #[should_panic]
    fn test_reputation_attestation_cooldown_enforced() {
        let env = odra_test::env();
        let validator = env.get_account(0);
        let agent = env.get_account(1);

        let mut reputation = Reputation::deploy(
            &env,
            super::__reputation_test_parts::ReputationInitArgs { validator_address: validator }
        );

        env.set_caller(validator);
        reputation.log_success(agent);
        // Second attestation within the same block must revert.
        reputation.log_failure(agent);
    }

    #[test]
    fn test_reputation_attestation_cooldown_allows_after_window() {
        let env = odra_test::env();
        let validator = env.get_account(0);
        let agent = env.get_account(1);

        let mut reputation = Reputation::deploy(
            &env,
            super::__reputation_test_parts::ReputationInitArgs { validator_address: validator }
        );

        env.set_caller(validator);
        reputation.log_success(agent);
        // Advance block time past the cooldown window.
        env.advance_block_time(Reputation::ATTESTATION_COOLDOWN_MS + 1);
        reputation.log_failure(agent);

        let (succ, fail) = reputation.get_stats(agent);
        assert_eq!(succ, 1);
        assert_eq!(fail, 1);
    }
}

