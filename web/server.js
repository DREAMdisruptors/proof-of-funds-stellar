// Thin HTTP wrapper around the same pipeline scripts/demo.sh runs:
// circom witness -> snarkjs Groth16 proof -> Soroban testnet verification.
// Each request gets its own temp directory so concurrent demos can't
// clobber each other's witness/proof files. The balance is used only to
// generate a witness in that temp dir and is never logged or persisted.
const express = require("express");
const path = require("path");
const fs = require("fs");
const os = require("os");
const crypto = require("crypto");
const { execFileSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const CIRCUITS_DIR = path.join(ROOT, "circuits");
const SCRIPTS_DIR = path.join(ROOT, "scripts");

const CONTRACT_ID =
  process.env.CONTRACT_ID || "CB33TGWZROSRQRKFVZGZV74SKFGSDC6HOEN366PF2S2WD7ESRCHIR6VB";
const SOURCE = process.env.SOURCE || "proof-of-funds-deployer";
const NETWORK = process.env.NETWORK || "testnet";

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

function isPositiveIntegerString(value) {
  return typeof value === "string" && /^[0-9]{1,18}$/.test(value);
}

app.post("/api/prove", (req, res) => {
  const { balance, threshold } = req.body || {};
  if (!isPositiveIntegerString(balance) || !isPositiveIntegerString(threshold)) {
    return res.status(400).json({ ok: false, error: "balance and threshold must be non-negative integers" });
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "proof-of-funds-"));
  try {
    const inputPath = path.join(tmpDir, "input.json");
    const witnessPath = path.join(tmpDir, "witness.wtns");
    const proofPath = path.join(tmpDir, "proof.json");
    const publicPath = path.join(tmpDir, "public.json");

    fs.writeFileSync(inputPath, JSON.stringify({ balance, threshold }));

    try {
      execFileSync("node", [
        path.join(CIRCUITS_DIR, "proof_of_funds_js", "generate_witness.js"),
        path.join(CIRCUITS_DIR, "proof_of_funds_js", "proof_of_funds.wasm"),
        inputPath,
        witnessPath,
      ]);
    } catch {
      // The circuit's balance >= threshold constraint is unsatisfiable —
      // by design, no witness/proof can exist in this case.
      return res.json({
        ok: true,
        verified: false,
        reason: "insufficient_balance",
        message: "No proof could be generated: balance does not meet the threshold.",
      });
    }

    execFileSync("snarkjs", [
      "groth16",
      "prove",
      path.join(CIRCUITS_DIR, "proof_of_funds_0001.zkey"),
      witnessPath,
      proofPath,
      publicPath,
    ]);

    execFileSync("node", [
      path.join(SCRIPTS_DIR, "proof_to_cli_args.js"),
      tmpDir,
      proofPath,
      publicPath,
    ]);

    const output = execFileSync("stellar", [
      "contract",
      "invoke",
      "--id",
      CONTRACT_ID,
      "--source",
      SOURCE,
      "--network",
      NETWORK,
      "--",
      "verify_proof",
      "--vk-file-path",
      path.join(tmpDir, "vk.json"),
      "--proof-file-path",
      path.join(tmpDir, "proof.json"),
      "--pub_signals-file-path",
      path.join(tmpDir, "pub_signals.json"),
    ]).toString();

    const lastLine = output.trim().split("\n").pop().trim();
    const verified = lastLine === "true";

    res.json({
      ok: true,
      verified,
      threshold,
      contractId: CONTRACT_ID,
      explorerUrl: `https://lab.stellar.org/r/testnet/contract/${CONTRACT_ID}`,
      message: verified
        ? `Verified on Stellar testnet: balance >= ${threshold}, without revealing the actual balance.`
        : "On-chain verification rejected the proof.",
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err.message || err) });
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Proof-of-funds demo server listening on http://localhost:${PORT}`);
});
