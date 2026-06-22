use odra::prelude::*;

#[odra::module]
pub struct AgentFactory {
    pub deployed_agents: Var<u32>,
    pub agent_owners: Mapping<Address, Address>,
}

#[odra::module]
impl AgentFactory {
    pub fn init(&mut self) {
        self.deployed_agents.set(0u32);
    }

    pub fn deploy_agent(&mut self, agent_address: Address) {
        let caller = self.env().caller();
        self.agent_owners.set(&agent_address, caller);
        let count = self.deployed_agents.get_or_default();
        self.deployed_agents.set(count + 1);
    }

    pub fn get_agent_owner(&self, agent_address: Address) -> Option<Address> {
        self.agent_owners.get(&agent_address)
    }

    pub fn get_deployed_count(&self) -> u32 {
        self.deployed_agents.get_or_default()
    }
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
}
