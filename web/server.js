// Thin HTTP wrapper around the same pipeline scripts/demo.sh runs:
// circom witness -> snarkjs Groth16 proof -> Soroban testnet verification.
// Each request gets its own temp directory so concurrent demos can't
// clobber each other's witness/proof files. The balance is used only to
// generate a witness in that temp dir and is never logged or persisted.
const express = require("express");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { execFileSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const CIRCUITS_DIR = path.join(ROOT, "circuits");
const SCRIPTS_DIR = path.join(ROOT, "scripts");

const CONTRACT_ID =
  process.env.CONTRACT_ID || "CB33TGWZROSRQRKFVZGZV74SKFGSDC6HOEN366PF2S2WD7ESRCHIR6VB";
const SOURCE = process.env.SOURCE || "proof-of-funds-deployer";
const NETWORK = process.env.NETWORK || "testnet";
const HORIZON_TESTNET = "https://horizon-testnet.stellar.org";
const STROOPS_PER_XLM = 10_000_000;

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

function isPositiveIntegerString(value) {
  return typeof value === "string" && /^[0-9]{1,18}$/.test(value);
}

function isStellarAccountId(value) {
  return typeof value === "string" && /^G[A-Z2-7]{55}$/.test(value);
}

// Fetches the real native (XLM) balance for a testnet account from
// Stellar's public Horizon API and converts it to stroops (the integer
// unit the circuit operates on). This is the only source of truth for
// "balance" in account mode — never something a human typed in.
async function fetchTestnetNativeBalanceStroops(accountId) {
  const resp = await fetch(`${HORIZON_TESTNET}/accounts/${accountId}`);
  if (!resp.ok) {
    throw new Error(`Horizon lookup failed (${resp.status}): account not found on testnet?`);
  }
  const data = await resp.json();
  const native = (data.balances || []).find((b) => b.asset_type === "native");
  if (!native) {
    throw new Error("Account has no native XLM balance on testnet");
  }
  return BigInt(Math.round(parseFloat(native.balance) * STROOPS_PER_XLM)).toString();
}

// Runs the full witness -> Groth16 proof -> on-chain verify pipeline for a
// given balance/threshold pair. balance never leaves this process — it is
// written only to a per-request temp dir, used to compute a witness, and
// the temp dir is deleted in `finally`.
function proveAndVerify(balance, threshold) {
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
      return {
        ok: true,
        verified: false,
        reason: "insufficient_balance",
        message: "No proof could be generated: balance does not meet the threshold.",
      };
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

    return {
      ok: true,
      verified,
      threshold,
      contractId: CONTRACT_ID,
      explorerUrl: `https://lab.stellar.org/r/testnet/contract/${CONTRACT_ID}`,
      message: verified
        ? `Verified on Stellar testnet: balance >= ${threshold}, without revealing the actual balance.`
        : "On-chain verification rejected the proof.",
    };
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

// Demo mode: the caller types in an arbitrary balance. Clearly disclosed
// in the UI as self-reported — proves the ZK mechanics, not real funds.
app.post("/api/prove", (req, res) => {
  const { balance, threshold } = req.body || {};
  if (!isPositiveIntegerString(balance) || !isPositiveIntegerString(threshold)) {
    return res.status(400).json({ ok: false, error: "balance and threshold must be non-negative integers" });
  }
  try {
    res.json(proveAndVerify(balance, threshold));
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err.message || err) });
  }
});

// Real mode: balance comes from Stellar testnet itself via Horizon, never
// from user input. Closes the self-reported-balance gap disclosed in the
// README, modulo trusting this server's Horizon fetch (independently
// re-checkable by anyone querying the same account).
app.post("/api/prove-from-account", async (req, res) => {
  const { accountId, threshold } = req.body || {};
  if (!isStellarAccountId(accountId)) {
    return res.status(400).json({ ok: false, error: "accountId must be a valid Stellar G... address" });
  }
  if (!isPositiveIntegerString(threshold)) {
    return res.status(400).json({ ok: false, error: "threshold must be a non-negative integer" });
  }
  try {
    const balanceStroops = await fetchTestnetNativeBalanceStroops(accountId);
    const result = proveAndVerify(balanceStroops, threshold);
    result.source = "stellar-testnet-horizon";
    result.accountId = accountId;
    res.json(result);
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err.message || err) });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Proof-of-funds demo server listening on http://localhost:${PORT}`);
});
