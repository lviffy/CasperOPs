use odra::prelude::*;

#[odra::module]
pub struct AgentFactory {
    pub owner: Var<Address>,
    pub paused: Var<bool>,
    pub deployed_agents: Var<u32>,
    pub agent_owners: Mapping<Address, Address>,
}

#[odra::module]
impl AgentFactory {
    pub fn init(&mut self) {
        self.deployed_agents.set(0u32);
        self.owner.set(self.env().caller());
        self.paused.set(false);
    }

    pub fn deploy_agent(&mut self, agent_address: Address) {
        self.require_not_paused();
        let caller = self.env().caller();
        self.agent_owners.set(&agent_address, caller);
        let count = self.deployed_agents.get_or_default();
        self.deployed_agents.set(count + 1);
    }

    pub fn transfer_ownership(&mut self, new_owner: Address) {
        self.require_owner();
        self.owner.set(new_owner);
    }

    pub fn set_paused(&mut self, paused: bool) {
        self.require_owner();
        self.paused.set(paused);
    }

    pub fn get_owner(&self) -> Address {
        self.owner.get_or_revert_with(Error::NotInitialized)
    }

    pub fn is_paused(&self) -> bool {
        self.paused.get_or_default()
    }

    pub fn get_agent_owner(&self, agent_address: Address) -> Option<Address> {
        self.agent_owners.get(&agent_address)
    }

    pub fn get_deployed_count(&self) -> u32 {
        self.deployed_agents.get_or_default()
    }
}

impl AgentFactory {
    fn require_owner(&self) {
        let caller = self.env().caller();
        let owner = self.owner.get_or_revert_with(Error::NotInitialized);
        if caller != owner {
            self.env().revert(Error::Unauthorized);
        }
    }

    fn require_not_paused(&self) {
        if self.paused.get_or_default() {
            self.env().revert(Error::Paused);
        }
    }
}

#[odra::odra_error]
pub enum Error {
    Unauthorized = 1,
    NotInitialized = 2,
    Paused = 3,
}

#[cfg(test)]
mod tests {
    use super::AgentFactory;
    use odra::host::{Deployer, NoArgs};

    #[test]
    fn test_agent_factory_initial_count() {
        let env = odra_test::env();
        let factory = AgentFactory::deploy(&env, NoArgs);
        assert_eq!(factory.get_deployed_count(), 0);
        assert!(!factory.is_paused());
        assert_eq!(factory.get_owner(), env.get_account(0));
    }

    #[test]
    fn test_deploy_agent_increments_count() {
        let env = odra_test::env();
        let mut factory = AgentFactory::deploy(&env, NoArgs);
        let agent = env.get_account(1);
        factory.deploy_agent(agent);
        assert_eq!(factory.get_deployed_count(), 1);
    }

    #[test]
    fn test_get_agent_owner() {
        let env = odra_test::env();
        let mut factory = AgentFactory::deploy(&env, NoArgs);
        let owner = env.get_account(0);
        let agent = env.get_account(1);
        env.set_caller(owner);
        factory.deploy_agent(agent);
        assert_eq!(factory.get_agent_owner(agent), Some(owner));
    }

    #[test]
    fn test_deploy_multiple_agents_tracks_count_and_owners() {
        let env = odra_test::env();
        let mut factory = AgentFactory::deploy(&env, NoArgs);
        let owner_a = env.get_account(0);
        let owner_b = env.get_account(2);
        let agent_a = env.get_account(1);
        let agent_b = env.get_account(3);

        env.set_caller(owner_a);
        factory.deploy_agent(agent_a);
        env.set_caller(owner_b);
        factory.deploy_agent(agent_b);

        assert_eq!(factory.get_deployed_count(), 2);
        assert_eq!(factory.get_agent_owner(agent_a), Some(owner_a));
        assert_eq!(factory.get_agent_owner(agent_b), Some(owner_b));
    }

    #[test]
    fn test_get_agent_owner_unknown_returns_none() {
        let env = odra_test::env();
        let factory = AgentFactory::deploy(&env, NoArgs);
        let unknown = env.get_account(5);
        assert_eq!(factory.get_agent_owner(unknown), None);
    }

    #[test]
    fn test_transfer_ownership_changes_owner() {
        let env = odra_test::env();
        let mut factory = AgentFactory::deploy(&env, NoArgs);
        let new_owner = env.get_account(2);
        factory.transfer_ownership(new_owner);
        assert_eq!(factory.get_owner(), new_owner);
    }

    #[test]
    #[should_panic]
    fn test_transfer_ownership_unauthorized() {
        let env = odra_test::env();
        let mut factory = AgentFactory::deploy(&env, NoArgs);
        let attacker = env.get_account(2);
        env.set_caller(attacker);
        factory.transfer_ownership(attacker);
    }

    #[test]
    fn test_set_paused_blocks_deploy_agent() {
        let env = odra_test::env();
        let mut factory = AgentFactory::deploy(&env, NoArgs);
        factory.set_paused(true);
        assert!(factory.is_paused());
        let agent = env.get_account(1);
        env.set_caller(env.get_account(0));
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            factory.deploy_agent(agent);
        }));
        assert!(result.is_err());
        assert_eq!(factory.get_deployed_count(), 0);
    }

    #[test]
    fn test_set_paused_resume_allows_deploy_agent() {
        let env = odra_test::env();
        let mut factory = AgentFactory::deploy(&env, NoArgs);
        factory.set_paused(true);
        factory.set_paused(false);
        let agent = env.get_account(1);
        env.set_caller(env.get_account(0));
        factory.deploy_agent(agent);
        assert_eq!(factory.get_deployed_count(), 1);
    }

    #[test]
    #[should_panic]
    fn test_set_paused_unauthorized() {
        let env = odra_test::env();
        let mut factory = AgentFactory::deploy(&env, NoArgs);
        let attacker = env.get_account(2);
        env.set_caller(attacker);
        factory.set_paused(true);
    }
}
