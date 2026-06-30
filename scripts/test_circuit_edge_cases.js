// Witness-only edge-case tests for circuits/proof_of_funds.circom. Fast
// (no Groth16 proving), checks the circuit's boundary behavior directly:
// each case asserts whether witness generation should succeed or fail.
// Run with: node scripts/test_circuit_edge_cases.js
const path = require("path");
const fs = require("fs");
const os = require("os");
const { execFileSync } = require("child_process");

const CIRCUITS_DIR = path.join(__dirname, "..", "circuits");
const WASM = process.env.CIRCUIT_WASM_PATH || path.join(CIRCUITS_DIR, "proof_of_funds_js", "proof_of_funds.wasm");
const GEN_WITNESS = path.join(CIRCUITS_DIR, "proof_of_funds_js", "generate_witness.js");

const MAX_U64 = (1n << 64n) - 1n;

const cases = [
  { name: "normal pass (5000 >= 1000)", balance: "5000", threshold: "1000", expect: "pass" },
  { name: "normal fail (500 < 1000)", balance: "500", threshold: "1000", expect: "fail" },
  { name: "boundary equal (1000 == 1000)", balance: "1000", threshold: "1000", expect: "pass" },
  { name: "zero balance, zero threshold", balance: "0", threshold: "0", expect: "pass" },
  { name: "zero balance, nonzero threshold", balance: "0", threshold: "1", expect: "fail" },
  { name: "max u64 boundary (2^64 - 1)", balance: MAX_U64.toString(), threshold: MAX_U64.toString(), expect: "pass" },
  {
    name: "overflow rejected: balance = 2^64 (one past max u64)",
    balance: (MAX_U64 + 1n).toString(),
    threshold: "5000",
    expect: "fail",
  },
  {
    name: "overflow rejected: threshold = 2^64",
    balance: MAX_U64.toString(),
    threshold: (MAX_U64 + 1n).toString(),
    expect: "fail",
  },
];

function witnessSucceeds(balance, threshold) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pof-edge-"));
  try {
    const inputPath = path.join(tmpDir, "input.json");
    const witnessPath = path.join(tmpDir, "witness.wtns");
    fs.writeFileSync(inputPath, JSON.stringify({ balance, threshold }));
    execFileSync("node", [GEN_WITNESS, WASM, inputPath, witnessPath], { stdio: "pipe" });
    return true;
  } catch {
    return false;
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

let failures = 0;
for (const c of cases) {
  const succeeded = witnessSucceeds(c.balance, c.threshold);
  const got = succeeded ? "pass" : "fail";
  const ok = got === c.expect;
  console.log(`${ok ? "OK  " : "FAIL"} ${c.name} (expected ${c.expect}, got ${got})`);
  if (!ok) failures++;
}

if (failures > 0) {
  console.error(`\n${failures} edge case(s) failed.`);
  process.exit(1);
}
console.log(`\nAll ${cases.length} edge cases passed.`);
