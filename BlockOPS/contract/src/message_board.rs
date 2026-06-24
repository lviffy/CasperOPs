use odra::prelude::*;
use casper_event_standard::Event;

#[derive(Event, Debug, PartialEq, Eq)]
pub struct MessagePosted {
    pub topic: String,
    pub writer: Address,
    pub message: String,
}

#[odra::module]
pub struct MessageBoard {
    pub messages: Mapping<String, String>,
    pub writers: Mapping<String, Address>,
}

#[odra::module]
impl MessageBoard {
    pub fn post_message(&mut self, topic: String, message: String) {
        let caller = self.env().caller();
        self.messages.set(&topic, message.clone());
        self.writers.set(&topic, caller);
        self.env().emit_event(MessagePosted {
            topic,
            writer: caller,
            message,
        });
    }

    pub fn get_message(&self, topic: String) -> String {
        self.messages.get(&topic).unwrap_or_default()
    }

    pub fn get_writer(&self, topic: String) -> Option<Address> {
        self.writers.get(&topic)
    }
}

#[cfg(test)]
mod tests {
    use super::MessageBoard;
    use odra::host::Deployer;

    #[test]
    fn test_post_and_get_message() {
        let env = odra_test::env();
        let writer = env.get_account(0);
        let mut board = MessageBoard::deploy(&env, odra::host::NoArgs);

        env.set_caller(writer);
        board.post_message("risk-assessment".to_string(), "risk level low".to_string());

        assert_eq!(board.get_message("risk-assessment".to_string()), "risk level low".to_string());
        assert_eq!(board.get_writer("risk-assessment".to_string()), Some(writer));
    }
}
