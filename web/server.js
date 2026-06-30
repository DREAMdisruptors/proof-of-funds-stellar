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
const HORIZON_TESTNET = "https://horizon-testnet.stellar.org";
const STROOPS_PER_UNIT = 10_000_000;

// USDC issuer on Stellar testnet (Circle's test USDC)
const USDC_TESTNET_ISSUER =
  process.env.USDC_ISSUER || "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";

// In-memory proof store keyed by short random ID.
// Stores only the verification result — the private balance is never persisted.
const proofStore = new Map();
const PROOF_TTL_MS = 24 * 60 * 60 * 1000; // 24 h

function storeProof(data) {
  const id = crypto.randomBytes(6).toString("base64url");
  proofStore.set(id, { ...data, storedAt: Date.now() });
  // Lazy eviction: remove stale entries whenever a new proof is stored
  for (const [k, v] of proofStore) {
    if (Date.now() - v.storedAt > PROOF_TTL_MS) proofStore.delete(k);
  }
  return id;
}

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

function isPositiveIntegerString(value) {
  return typeof value === "string" && /^[0-9]{1,20}$/.test(value);
}

function isStellarAccountId(value) {
  return typeof value === "string" && /^G[A-Z2-7]{55}$/.test(value);
}

function maskAccountId(accountId) {
  return accountId.slice(0, 6) + "···" + accountId.slice(-4);
}

// Fetches the live balance for a testnet account from Horizon and converts
// to the integer "stroop" unit the circuit operates on.
// asset: "XLM" | "USDC"
async function fetchBalanceStroops(accountId, asset) {
  const resp = await fetch(`${HORIZON_TESTNET}/accounts/${accountId}`);
  if (!resp.ok) {
    throw new Error(`Horizon lookup failed (${resp.status}): account not found on testnet`);
  }
  const data = await resp.json();
  const balances = data.balances || [];

  let found;
  if (asset === "USDC") {
    found = balances.find(
      (b) =>
        b.asset_type === "credit_alphanum4" &&
        b.asset_code === "USDC" &&
        b.asset_issuer === USDC_TESTNET_ISSUER
    );
    if (!found) throw new Error("Account has no USDC balance on testnet");
  } else {
    found = balances.find((b) => b.asset_type === "native");
    if (!found) throw new Error("Account has no native XLM balance on testnet");
  }

  return BigInt(Math.round(parseFloat(found.balance) * STROOPS_PER_UNIT)).toString();
}

// Runs witness → Groth16 proof → on-chain verify for a balance/threshold pair.
// The private balance never leaves this process — it lives only in a per-request
// temp directory that is always deleted in `finally`.
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
      return { verified: false, reason: "insufficient_balance" };
    }

    execFileSync("snarkjs", [
      "groth16", "prove",
      path.join(CIRCUITS_DIR, "proof_of_funds_0001.zkey"),
      witnessPath, proofPath, publicPath,
    ]);

    execFileSync("node", [
      path.join(SCRIPTS_DIR, "proof_to_cli_args.js"),
      tmpDir, proofPath, publicPath,
    ]);

    const output = execFileSync("stellar", [
      "contract", "invoke",
      "--id", CONTRACT_ID,
      "--source", SOURCE,
      "--network", NETWORK,
      "--", "verify_proof",
      "--vk-file-path", path.join(tmpDir, "vk.json"),
      "--proof-file-path", path.join(tmpDir, "proof.json"),
      "--pub_signals-file-path", path.join(tmpDir, "pub_signals.json"),
    ]).toString();

    const verified = output.trim().split("\n").pop().trim() === "true";
    return { verified };
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

// Demo mode: self-reported balance (proves ZK mechanics, not real funds)
app.post("/api/prove", (req, res) => {
  const { balance, threshold } = req.body || {};
  if (!isPositiveIntegerString(balance) || !isPositiveIntegerString(threshold)) {
    return res.status(400).json({ ok: false, error: "balance and threshold must be non-negative integers" });
  }
  try {
    const { verified, reason } = proveAndVerify(balance, threshold);
    if (!verified) {
      return res.json({
        ok: true,
        verified: false,
        reason: reason || "verification_failed",
        message: "No proof could be generated: balance does not meet the threshold.",
      });
    }

    const record = {
      verified: true,
      threshold,
      asset: "XLM",
      source: "self-reported",
      contractId: CONTRACT_ID,
      explorerUrl: `https://lab.stellar.org/r/testnet/contract/${CONTRACT_ID}`,
    };
    const shareId = storeProof(record);

    res.json({
      ok: true,
      ...record,
      shareUrl: `/v/${shareId}`,
      message: `Verified on Stellar testnet: balance ≥ threshold, without revealing the actual balance.`,
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err.message || err) });
  }
});

// Real mode: balance is fetched live from Stellar testnet — never user-typed
app.post("/api/prove-from-account", async (req, res) => {
  const { accountId, threshold, asset = "XLM" } = req.body || {};
  if (!isStellarAccountId(accountId)) {
    return res.status(400).json({ ok: false, error: "accountId must be a valid Stellar G… address" });
  }
  if (!isPositiveIntegerString(threshold)) {
    return res.status(400).json({ ok: false, error: "threshold must be a non-negative integer" });
  }
  if (asset !== "XLM" && asset !== "USDC") {
    return res.status(400).json({ ok: false, error: "asset must be XLM or USDC" });
  }
  try {
    const balanceStroops = await fetchBalanceStroops(accountId, asset);
    const { verified, reason } = proveAndVerify(balanceStroops, threshold);

    if (!verified) {
      return res.json({
        ok: true,
        verified: false,
        reason: reason || "verification_failed",
        message: "Balance does not meet the threshold.",
        accountId: maskAccountId(accountId),
        asset,
      });
    }

    const record = {
      verified: true,
      threshold,
      asset,
      accountId: maskAccountId(accountId),
      source: "stellar-testnet-horizon",
      contractId: CONTRACT_ID,
      explorerUrl: `https://lab.stellar.org/r/testnet/contract/${CONTRACT_ID}`,
    };
    const shareId = storeProof(record);

    res.json({
      ok: true,
      ...record,
      shareUrl: `/v/${shareId}`,
      message: `Verified on Stellar testnet: ${asset} balance ≥ threshold, without revealing the actual balance.`,
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err.message || err) });
  }
});

// Returns stored proof data by share ID
app.get("/api/proof/:id", (req, res) => {
  const entry = proofStore.get(req.params.id);
  if (!entry) {
    return res.status(404).json({ ok: false, error: "Proof not found or expired" });
  }
  if (Date.now() - entry.storedAt > PROOF_TTL_MS) {
    proofStore.delete(req.params.id);
    return res.status(404).json({ ok: false, error: "Proof expired" });
  }
  res.json({ ok: true, ...entry });
});

// Verifier landing page — served for all /v/:id paths
app.get("/v/:id", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "verify.html"));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Proof-of-funds server → http://localhost:${PORT}`);
});
