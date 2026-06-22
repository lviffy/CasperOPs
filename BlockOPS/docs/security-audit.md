# Odra Smart-Contract Security Audit Checklist

This document tracks security considerations for the four BlockOps Odra
contracts. Review before each mainnet deploy.

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
- **Owner-only mint**: `Cep78Nft::mint` is gated by `self.env().self_address()`
  — only the contract itself can mint. Users call a separate `transfer`
  entry point instead.

## Per-contract findings

### AgentFactory

| Concern              | Status | Notes                                                |
| -------------------- | ------ | ---------------------------------------------------- |
| `register_agent`     | OK     | Idempotent on `agent_id`; uses `Mapping` not `Vec`.  |
| Ownership update     | TODO   | No `transfer_ownership` entry point yet — owner is fixed. |
| Pause                | TODO   | No emergency pause; add `set_paused(bool)` for v1.0.  |

### Reputation

| Concern              | Status | Notes                                                |
| -------------------- | ------ | ---------------------------------------------------- |
| Attester allowlist   | OK     | Only `authority` can log success/failure.            |
| Score range          | OK     | `u8` (0–100).                                        |
| Per-agent history    | OK     | Separate `Mapping<agent, Stats>` prevents cross-agent contamination. |
| Update rate limit    | TODO   | No cooldown; an attester could spam attestations.    |

### Escrow

| Concern              | Status | Notes                                                |
| -------------------- | ------ | ---------------------------------------------------- |
| Reentrancy           | OK     | State zeroed before `transfer_tokens`.                |
| Backend only payout  | OK     | `execute_payout` and `refund` check `caller == backend`. |
| Treasury misconfig   | TODO   | Treasury address is immutable after `init`; consider a `set_treasury` for v1.0. |
| Insolvency           | OK     | Will revert if contract CSPR balance < payout.        |

### Compliance

| Concern              | Status | Notes                                                |
| -------------------- | ------ | ---------------------------------------------------- |
| Attester allowlist   | OK     | Only `authority` can attest.                          |
| Revocation           | OK     | `revoke_attestation` exists; covered by test.         |
| Audit trail          | TODO   | No on-chain event emission; add for v1.0.             |

### Cep18Token

| Concern              | Status | Notes                                                |
| -------------------- | ------ | ---------------------------------------------------- |
| Allowance race       | OK     | Allowance set to `old - amount` before transfer.      |
| `transfer_from` auth | OK     | Requires `allowance >= amount`.                       |
| Mint                 | OK     | No mint entry point; total supply is fixed at init.   |
| Burn                 | TODO   | No burn entry point; add for v1.0 if needed.          |

### Cep78Nft

| Concern              | Status | Notes                                                |
| -------------------- | ------ | ---------------------------------------------------- |
| Mint authority       | OK     | Only `self_address` can mint.                         |
| Approvals            | OK     | `approve` and `set_approval_for_all` both gated.       |
| Burn                 | TODO   | No burn entry point; add for v1.0 if needed.          |

## Recommended v1.0 additions

- **Pause switches** on every contract (operator-only `set_paused(bool)`).
- **On-chain events** via `casper_event_standard` for Reputation, Escrow,
  and Compliance (so off-chain indexers can build a real-time activity feed).
- **Merkle-proof allowlist** for the Compliance contract so updating the
  attester list is gas-cheap.
- **Bug-bounty program** hosted on Cantina or Code4rena before any mainnet
  contract manages real CSPR.

## Tooling

- `cargo test` runs the existing 24 unit tests (all passing).
- `cargo clippy --all-targets --all-features` for lint.
- `cargo odra build --release` for the deployable WASM.
- A future `cargo audit` step will check for dependency CVEs.
