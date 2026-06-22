'use strict';

/**
 * Smoke test for scripts/e2e-testnet.mjs (--dryrun mode).
 *
 * Runs the script end-to-end and asserts:
 *   - exit code is 0 or 137 (137 = SIGKILL self-terminate, treated as success)
 *   - all 18 expected steps appear in the log
 *   - the negative-control "deploy_agent under pause" actually reverts
 *   - the events feed reports 2 Attest + 1 RevokeAttestation + 2 Burn
 *
 * Run:
 *   node scripts/__tests__/e2e-dryrun.test.mjs
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = dirname(dirname(HERE));
const SCRIPT = join(ROOT, "scripts", "e2e-testnet.mjs");

function runDryrun() {
  const tmp = mkdtempSync(join(tmpdir(), "e2e-dryrun-"));
  const logPath = join(tmp, "dryrun.log");
  const h = (ch) => "0".repeat(0) + ch + "a".repeat(64 - ch.length);
  const args = [
    SCRIPT,
    "--dryrun",
    "--factory", `hash-${h("a")}`,
    "--reputation", `hash-${h("b")}`,
    "--escrow", `hash-${h("c")}`,
    "--compliance", `hash-${h("d")}`,
    "--cep18", `hash-${h("e")}`,
    "--cep78", `hash-${h("f")}`,
    "--cspr-cloud", "http://mock.cspr.cloud",
    "--log", logPath,
  ];
  let proc;
  try {
    proc = execFileSync("node", args, { stdio: "pipe" });
  } catch (err) {
    // The script self-terminates with SIGKILL; node propagates that as a
    // non-zero exit (137) on some platforms. Accept it as a successful
    // run as long as the log file was fully written.
    if (err.status && err.status !== 137 && err.status !== 0) {
      throw new Error(`e2e dryrun exited with ${err.status}: ${err.stderr?.toString()}`);
    }
  }
  const log = readFileSync(logPath, "utf8");
  rmSync(tmp, { recursive: true, force: true });
  return log;
}

const log = runDryrun();

console.log("--- e2e dryrun log preview ---");
console.log(log.split("\n").slice(0, 5).join("\n"));
console.log("…");
console.log(log.split("\n").slice(-5).join("\n"));
console.log("--------------------------------");

// 1. Every step header is present.
const steps = [
  "## 1. register_agent",
  "## 2. attest_agent (Reputation)",
  "## 3. get_reputation (view)",
  "## 4. escrow_deposit",
  "## 5. escrow_payout",
  "## 6. Final state check",
  "## 7. compliance_attest",
  "## 8. compliance_revoke",
  "## 9. set_paused(true)",
  "## 10. deploy_agent under pause",
  "## 11. set_paused(false)",
  "## 12. deploy_agent → expect success",
  "## 13. transfer_ownership",
  "## 14b. set_paused(true) → deploy_agent reverts",
  "## 15. cep18_burn",
  "## 16. cep78_mint + cep78_burn",
  "## 17. escrow_set_treasury",
  "## 18. on-chain event verification",
];
for (const s of steps) {
  assert.ok(log.includes(s), `expected step missing: ${s}`);
}
console.log(`✔ all ${steps.length} step headers present`);

// 2. Negative control: deploy under pause reverts.
assert.ok(
  log.includes("deploy_agent(under_pause) reverted as expected: User: 0 reverted: Error::Paused"),
  "expected deploy-under-pause revert message",
);
assert.ok(
  log.includes("deploy_agent(under_pause_post_transfer) reverted as expected: User: 0 reverted: Error::Paused"),
  "expected post-transfer pause revert message",
);
console.log("✔ negative control: deploy under pause reverts with Error::Paused");

// 3. Event summary: 2 Attest, 1 RevokeAttestation, 2 Burn.
assert.match(log, /Emitted events \(mock\): \{"Attest":2,"RevokeAttestation":1,"Burn":2\}/);
console.log("✔ events feed: 2 Attest, 1 RevokeAttestation, 2 Burn");

// 4. Run finished line.
assert.ok(log.includes("Run finished."), "expected 'Run finished.' marker");
console.log("✔ run finished marker present");

console.log("\n✅ scripts/e2e-testnet.mjs --dryrun smoke test passed");
