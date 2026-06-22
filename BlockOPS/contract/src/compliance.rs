use odra::prelude::*;

#[odra::module]
pub struct Compliance {
    pub verified_status: Mapping<Address, bool>,
    pub attestation_uris: Mapping<Address, String>,
    pub compliance_authority: Var<Address>,
}

#[odra::module]
impl Compliance {
    pub fn init(&mut self, authority: Address) {
        self.compliance_authority.set(authority);
    }

    pub fn attest_agent(&mut self, agent: Address, verified: bool, uri: String) {
        let caller = self.env().caller();
        let authority = self.compliance_authority.get_or_revert_with(Error::Unauthorized);
        if caller != authority {
            self.env().revert(Error::Unauthorized);
        }
        self.verified_status.set(&agent, verified);
        self.attestation_uris.set(&agent, uri);
    }

    pub fn is_compliant(&self, agent: Address) -> bool {
        self.verified_status.get(&agent).unwrap_or(false)
    }

    pub fn get_attestation_uri(&self, agent: Address) -> String {
        self.attestation_uris.get(&agent).unwrap_or_default()
    }
}

#[odra::odra_error]
pub enum Error {
    Unauthorized = 1,
}

#[cfg(test)]
mod tests {
    use super::Compliance;
    use odra::host::Deployer;

    #[test]
    fn test_compliance_initial_state() {
        let env = odra_test::env();
        let authority = env.get_account(0);
        let agent = env.get_account(1);
        let compliance = Compliance::deploy(
            &env,
            super::__compliance_test_parts::ComplianceInitArgs { authority }
        );
        
        assert_eq!(compliance.is_compliant(agent), false);
        assert_eq!(compliance.get_attestation_uri(agent), String::new());
    }

    #[test]
    fn test_compliance_attest() {
        let env = odra_test::env();
        let authority = env.get_account(0);
        let agent = env.get_account(1);
        
        let mut compliance = Compliance::deploy(
            &env,
            super::__compliance_test_parts::ComplianceInitArgs { authority }
        );
        
        env.set_caller(authority);
        compliance.attest_agent(agent, true, "ipfs://some_hash".to_string());

        assert_eq!(compliance.is_compliant(agent), true);
        assert_eq!(compliance.get_attestation_uri(agent), "ipfs://some_hash".to_string());
    }

    #[test]
    #[should_panic]
    fn test_compliance_unauthorized() {
        let env = odra_test::env();
        let authority = env.get_account(0);
        let non_authority = env.get_account(2);
        let agent = env.get_account(1);
        
        let mut compliance = Compliance::deploy(
            &env,
            super::__compliance_test_parts::ComplianceInitArgs { authority }
        );
        
        env.set_caller(non_authority);
        compliance.attest_agent(agent, true, "ipfs://unauthorized".to_string());
    }
}

