use casper_event_standard::Event;
use odra::prelude::*;

#[derive(Event, Debug, PartialEq, Eq)]
pub struct Attest {
    pub agent: Address,
    pub verified: bool,
    pub uri: String,
    pub attester: Address,
}

#[derive(Event, Debug, PartialEq, Eq)]
pub struct RevokeAttestation {
    pub agent: Address,
    pub attester: Address,
}

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
        let previously_verified = self.verified_status.get(&agent).unwrap_or(false);
        self.verified_status.set(&agent, verified);
        self.attestation_uris.set(&agent, uri.clone());
        self.env().emit_event(Attest {
            agent,
            verified,
            uri,
            attester: caller,
        });
        if previously_verified && !verified {
            self.env().emit_event(RevokeAttestation {
                agent,
                attester: caller,
            });
        }
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
    use super::{Attest, Compliance, RevokeAttestation};
    use casper_event_standard::EventInstance;
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

        assert!(!compliance.is_compliant(agent));
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

        assert!(compliance.is_compliant(agent));
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

    #[test]
    fn test_compliance_attest_can_be_revoked() {
        let env = odra_test::env();
        let authority = env.get_account(0);
        let agent = env.get_account(1);

        let mut compliance = Compliance::deploy(
            &env,
            super::__compliance_test_parts::ComplianceInitArgs { authority }
        );

        env.set_caller(authority);
        compliance.attest_agent(agent, true, "ipfs://approve".to_string());
        assert!(compliance.is_compliant(agent));

        compliance.attest_agent(agent, false, "ipfs://revoke".to_string());
        assert!(!compliance.is_compliant(agent));
        assert_eq!(
            compliance.get_attestation_uri(agent),
            "ipfs://revoke".to_string()
        );
    }

    #[test]
    fn test_compliance_unattested_agent_defaults() {
        let env = odra_test::env();
        let authority = env.get_account(0);
        let agent = env.get_account(1);

        let compliance = Compliance::deploy(
            &env,
            super::__compliance_test_parts::ComplianceInitArgs { authority }
        );

        assert!(!compliance.is_compliant(agent));
        assert_eq!(compliance.get_attestation_uri(agent), String::new());
    }

    #[test]
    fn test_compliance_attest_emits_event() {
        let env = odra_test::env();
        let authority = env.get_account(0);
        let agent = env.get_account(1);

        let mut compliance = Compliance::deploy(
            &env,
            super::__compliance_test_parts::ComplianceInitArgs { authority }
        );

        env.set_caller(authority);
        compliance.attest_agent(agent, true, "ipfs://approved".to_string());

        assert!(
            env.emitted(&compliance, Attest::name().as_str()),
            "expected an Attest event to be emitted"
        );
    }

    #[test]
    fn test_compliance_revoke_emits_revoke_event() {
        let env = odra_test::env();
        let authority = env.get_account(0);
        let agent = env.get_account(1);

        let mut compliance = Compliance::deploy(
            &env,
            super::__compliance_test_parts::ComplianceInitArgs { authority }
        );

        env.set_caller(authority);
        compliance.attest_agent(agent, true, "ipfs://approved".to_string());
        compliance.attest_agent(agent, false, "ipfs://revoked".to_string());

        assert!(
            env.emitted(&compliance, RevokeAttestation::name().as_str()),
            "expected RevokeAttestation to be emitted after verified: true -> false"
        );
        // The second attest_agent emits both Attest + RevokeAttestation,
        // so we should see at least 3 events total: initial Attest,
        // second Attest, and the RevokeAttestation.
        let total_events = env.events_count(&compliance);
        assert!(
            total_events >= 3,
            "expected at least 3 events (2 Attest + 1 Revoke), got {}",
            total_events
        );
    }

    #[test]
    fn test_compliance_re_attest_does_not_emit_revoke_event() {
        let env = odra_test::env();
        let authority = env.get_account(0);
        let agent = env.get_account(1);

        let mut compliance = Compliance::deploy(
            &env,
            super::__compliance_test_parts::ComplianceInitArgs { authority }
        );

        env.set_caller(authority);
        // verified stays true -> no revoke event expected.
        compliance.attest_agent(agent, true, "ipfs://first".to_string());
        compliance.attest_agent(agent, true, "ipfs://second".to_string());

        assert!(
            !env.emitted(&compliance, RevokeAttestation::name().as_str()),
            "no revoke event should be emitted when verified stays true"
        );
    }

    #[test]
    fn test_compliance_initial_attest_does_not_emit_revoke_event() {
        let env = odra_test::env();
        let authority = env.get_account(0);
        let agent = env.get_account(1);

        let mut compliance = Compliance::deploy(
            &env,
            super::__compliance_test_parts::ComplianceInitArgs { authority }
        );

        env.set_caller(authority);
        // First attest from default-unverified -> only Attest, no Revoke.
        compliance.attest_agent(agent, true, "ipfs://first".to_string());

        assert!(
            !env.emitted(&compliance, RevokeAttestation::name().as_str()),
            "no revoke event should be emitted on initial attestation"
        );
    }
}
