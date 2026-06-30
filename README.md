# Proof of Funds on Stellar

> **Prove you can pay. Without showing what you have.**

Generate a zero-knowledge proof that a Stellar wallet holds at least a given
balance — verified on-chain by a Soroban smart contract, balance never
revealed. Share a single link. The recipient clicks it and sees the truth.

Built for the Stellar ZK Hackathon (DoraHacks). Submission category: **Mild**
(proof-of-balance / proof-of-funds).

## How it works

1. Enter a Stellar wallet address and a minimum balance.
2. The server fetches the real balance from Stellar testnet (Horizon) — the
   number is never shown, never typed, never logged.
3. A Groth16 zero-knowledge proof is generated off-chain, then verified by a
   Soroban smart contract on-chain.
4. You get a shareable link: `https://your-server/v/abc123`. Anyone who clicks
   it sees a single verified fact — **"holds ≥ X XLM/USDC"** — without the
   underlying balance ever leaving the prover's machine.

## What the circuit actually proves

> I hold a balance ≥ `threshold`. The balance itself is a private witness.

`threshold` is public. `balance` is private — only a ZK proof of the
comparison goes on-chain. The circuit (`circuits/proof_of_funds.circom`)
enforces `balance >= threshold` as a hard constraint:

- If the balance doesn't meet the threshold, **no valid witness or proof can be
  generated at all**. There's no "false" result to fake; the proving step fails.
- Both `balance` and `threshold` are range-checked to 64 bits via
  `Num2Bits(64)` — values ≥ 2^64 are rejected at the constraint level, not just
  at the input layer. The circuit has 193 non-linear constraints (up from 65 in
  the initial version without range checks).

## Known limitation

The circuit only sees `balance` as a private witness — it has no way to verify
where that number came from. This server closes most of the practical gap by
fetching the balance live from Horizon (the prover can no longer assert an
arbitrary number), but **full cryptographic attestation** — an in-circuit
hash/signature check binding the proof to a signed Horizon response — is a
deliberate follow-up, not included in this submission.

The gap: you trust this server's Horizon fetch, not a signature verified inside
the circuit. A proper fix would hash a signed balance commitment inside the
circuit, but circomlib's Poseidon/EdDSA templates hardcode BN128 round
constants and can't be used on BLS12-381 without regenerating them. SHA256 (a
field-agnostic alternative) would work but adds non-trivial constraint count.
Deliberately left out per the hackathon guidance: *"if something's unfinished
or you used mock data in places, just say so in the README."*

## Architecture

```
Stellar Horizon API
       │  (real balance, never displayed)
       ▼
balance, threshold  →  Circom circuit  →  Groth16 proof (snarkjs, BLS12-381)
                                                │
                                                ▼
                              Soroban verifier contract (Stellar testnet)
                              bls12_381_multi_pairing_check host function
                                                │
                                                ▼
                                     /v/:id  — shareable proof link
```

- **Circuit** `circuits/proof_of_funds.circom` — `GreaterEqThan(64)` +
  `Num2Bits(64)` range checks for both inputs. Compiled with
  `--prime bls12381` to match Soroban's native pairing host functions.
- **Verifier contract** `verifier/` — forked from Stellar's official
  [`soroban-examples/groth16_verifier`](https://github.com/stellar/soroban-examples/tree/main/groth16_verifier).
  Generic Groth16 pairing check; no contract code modified beyond the upstream.
- **Trusted setup** — fresh powers-of-tau + Groth16 phase-2 ceremony run
  specifically for this circuit (`circuits/pot_*.ptau`,
  `circuits/proof_of_funds_0001.zkey`).

## Deployed contract (Stellar testnet)

```
CB33TGWZROSRQRKFVZGZV74SKFGSDC6HOEN366PF2S2WD7ESRCHIR6VB
```

https://lab.stellar.org/r/testnet/contract/CB33TGWZROSRQRKFVZGZV74SKFGSDC6HOEN366PF2S2WD7ESRCHIR6VB

## Running locally

**Requirements:** `circom` 2.2+, `snarkjs`, Node.js 18+, `stellar-cli` 27+,
a `stellar keys` identity funded on testnet.

### Web server

```bash
cd web
node server.js
# → http://localhost:3000
```

**Real wallet mode** — enter a Stellar G… address and a minimum balance
(in stroops). Supports XLM and USDC. The balance is fetched live from Horizon,
never displayed, and used only in-memory to generate a witness in a per-request
temp directory.

**After a successful proof**, a shareable `/v/:id` URL is returned. Send that
link to anyone — they see the verified result with zero crypto knowledge
required. Links expire after 24 hours.

**Demo mode** — type any numbers directly to exercise the ZK mechanics without
a real Stellar account.

### Command-line demo

```bash
./scripts/demo.sh <balance> <threshold>

# Prove 5000 meets a threshold of 1000
./scripts/demo.sh 5000 1000

# A balance that doesn't meet the threshold → proof generation fails by design
./scripts/demo.sh 500 1000
```

### Circuit edge-case tests

```bash
node scripts/test_circuit_edge_cases.js
# Runs 8 witness-only cases: normal pass/fail, boundary equal, zero cases,
# max u64, and overflow rejection (values ≥ 2^64 must be rejected by
# the Num2Bits range checks).
```

### Rust contract tests

```bash
cd verifier && cargo test --release
# 2 tests: balance=5000/threshold=1000 (pass + tamper check),
#          balance=1000/threshold=1000 (boundary equality pass).
```

## Rebuilding from scratch

```bash
# Recompile the circuit
circom circuits/proof_of_funds.circom --wasm --r1cs --prime bls12381 --output circuits/

# New trusted setup (if circuit changed)
snarkjs powersoftau new bls12381 10 circuits/pot0000.ptau
snarkjs powersoftau contribute circuits/pot0000.ptau circuits/pot0001.ptau
snarkjs powersoftau prepare phase2 circuits/pot0001.ptau circuits/pot_final.ptau
snarkjs groth16 setup circuits/proof_of_funds.r1cs circuits/pot_final.ptau circuits/proof_of_funds_0000.zkey
snarkjs zkey contribute circuits/proof_of_funds_0000.zkey circuits/proof_of_funds_0001.zkey
snarkjs zkey export verificationkey circuits/proof_of_funds_0001.zkey circuits/verification_key.json

# Redeploy the contract
cd verifier
stellar contract build
stellar contract deploy \
  --wasm target/wasm32v1-none/release/proof_of_funds_verifier.wasm \
  --source <your-alias> --network testnet
```

## Why Groth16 + BLS12-381, not Noir

The hackathon's Noir resource ("How To Verify Noir Ultrahonk Circuits In A
Stellar Contract") states that on-chain Ultrahonk verification is "right on the
borderline of CPU instruction limits" and currently requires `stellar/quickstart`
with budget limits disabled — not deployable to real testnet today.

Circom + Groth16 over BLS12-381 is the path Stellar's own engineering team used
for Stellar Private Payments, with ~41M CPU instructions per pairing check
against a 100M instruction budget — comfortably within real network limits.
