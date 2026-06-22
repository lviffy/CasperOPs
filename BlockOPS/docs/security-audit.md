# Odra Smart-Contract Security Audit Checklist

This document tracks security considerations for the BlockOps Odra contracts.
Review before each mainnet deploy. The "v1.0 additions" section at the bottom
captures what was shipped in Phase 17.

## Common patterns

- **Authorization**: every entry point checks `self.env().caller()` against a
  stored allowlist (`authorized_backend`, `authority`, `attester`). Tests in
  `src/*::tests::*_unauthorized` confirm unauthorized callers revert.
- **Reentrancy**: the Escrow `execute_payout` and `refund` entry points are
  marked `#[odra(payable)]` and call `self.env().transfer_tokens(&treasury, &amount)`
  *after* zeroing out the deposit. Odra's host runtime does not currently
  support reentrancy, but we still follow checks-effects-interactions
  defensively.
- **Integer math**: amounts use `U256` / `U512` (no overflow risk on Casper).
  The Reputation contract caps `score` at `u8` (0–100) to prevent overflow.
- **Owner-only mint**: `Cep78Nft::mint` is gated by the configured `minter`
  address (set at `init`). The contract itself can also mint for proxy flows.
  Users call a separate `transfer` entry point instead.
- **Events**: Compliance emits `Attest` and `RevokeAttestation` events via
  `casper_event_standard` so off-chain indexers can build a real-time feed.
  `Cep18Token::burn` and `Cep78Nft::burn` each emit a `Burn` event.
- **Attestation cooldown**: Reputation enforces a 1 hour minimum gap between
  two attestations from the same attester (`ATTESTATION_COOLDOWN_MS`).

## Per-contract findings

### AgentFactory

| Concern              | Status | Notes                                                |
| -------------------- | ------ | ---------------------------------------------------- |
| `register_agent`     | OK     | Idempotent on `agent_id`; uses `Mapping` not `Vec`.  |
| Ownership update     | OK     | `transfer_ownership(new_owner)` is owner-only (Phase 17). |
| Pause                | OK     | `set_paused(bool)` is owner-only (Phase 17).         |

### Reputation

| Concern              | Status | Notes                                                |
| -------------------- | ------ | ---------------------------------------------------- |
| Attester allowlist   | OK     | Only `authority` can log success/failure.            |
| Score range          | OK     | `u8` (0–100).                                        |
| Per-agent history    | OK     | Separate `Mapping<agent, Stats>` prevents cross-agent contamination. |
| Update rate limit    | OK     | 1-hour cooldown per attester (Phase 17).             |

### Escrow

| Concern              | Status | Notes                                                |
| -------------------- | ------ | ---------------------------------------------------- |
| Reentrancy           | OK     | State zeroed before `transfer_tokens`.                |
| Backend only payout  | OK     | `execute_payout` and `refund` check `caller == backend`. |
| Treasury misconfig   | OK     | `set_treasury(new_treasury)` lets the backend rotate the treasury address (Phase 17). |
| Insolvency           | OK     | Will revert if contract CSPR balance < payout.        |

### Compliance

| Concern              | Status | Notes                                                |
| -------------------- | ------ | ---------------------------------------------------- |
| Attester allowlist   | OK     | Only `authority` can attest.                          |
| Revocation           | OK     | `attest_agent(verified=false)` revokes; emits `RevokeAttestation`. |
| Audit trail          | OK     | `Attest` and `RevokeAttestation` events via `casper_event_standard` (Phase 17). |

### Cep18Token

| Concern              | Status | Notes                                                |
| -------------------- | ------ | ---------------------------------------------------- |
| Allowance race       | OK     | Allowance set to `old - amount` before transfer.      |
| `transfer_from` auth | OK     | Requires `allowance >= amount`.                       |
| Mint                 | OK     | No mint entry point; total supply is fixed at init.   |
| Burn                 | OK     | `burn(amount)` holder-only; emits `Burn` event (Phase 17). |

### Cep78Nft

| Concern              | Status | Notes                                                |
| -------------------- | ------ | ---------------------------------------------------- |
| Mint authority       | OK     | Only the `minter` (set at init) or the contract itself can mint. |
| Approvals            | OK     | `approve` and `set_approval_for_all` both gated.       |
| Burn                 | OK     | `burn(token_id)` owner/operator-only; emits `Burn` event (Phase 17). |

## v1.0 additions (shipped in Phase 17)

- **Pause switch** on `AgentFactory` (`set_paused(bool)`, owner-only).
- **Ownership transfer** on `AgentFactory` (`transfer_ownership(new_owner)`, owner-only).
- **Treasury update** on `Escrow` (`set_treasury(new_treasury)`, backend-only).
- **Attestation rate limit** on `Reputation` (1 hour cooldown per attester).
- **On-chain events** via `casper_event_standard`:
  - `Compliance`: `Attest`, `RevokeAttestation`.
  - `Cep18Token`: `Burn`.
  - `Cep78Nft`: `Burn`.
- **Burn entry points** on `Cep18Token` and `Cep78Nft`.

## Open follow-ups (not shipped in v1.0)

- **Merkle-proof allowlist** for Compliance so updating the attester list is
  gas-cheap without rotating the contract.
- **Bug-bounty program** hosted on Cantina or Code4rena before any mainnet
  contract manages real CSPR.
- **Upgrade pattern** — current contracts are immutable. If a future
  governance model requires upgrades, switch to Odra's upgradeable module
  pattern and audit the migration entry point.

## Tooling

- `cargo test` runs the current 64 unit tests (all passing).
- `cargo clippy --all-targets --all-features -- -D warnings` for lint.
- `cargo odra build --release` for the deployable WASM (6 contracts).
- A future `cargo audit` step will check for dependency CVEs.
