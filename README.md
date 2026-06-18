# Proof of Funds on Stellar

Prove that an account holds at least a given amount — without revealing the
actual balance — using a Groth16 zero-knowledge proof verified on-chain by a
Soroban smart contract on Stellar testnet.

Built for the Stellar ZK hackathon (DoraHacks). Submission category: **Mild**
(proof-of-balance / proof-of-funds — "a perfect first ZK project," per the
hackathon's own resource page).

## What this actually proves

> I hold a balance ≥ `threshold`, without telling you what the balance is.

`threshold` is public. `balance` is a private witness that never leaves your
machine in plaintext — only a cryptographic proof of the comparison is sent
on-chain.

The circuit (`circuits/proof_of_funds.circom`) enforces `balance >= threshold`
as a hard constraint, not a boolean output you could ignore. If the balance
doesn't meet the threshold, **no valid witness or proof can be generated at
all** — there's no "false" result to fake, the proving step itself fails.

## Known limitation — read this before judging

**The balance is self-reported, not attested.** The circuit takes `balance`
as a private input the prover types in; it is not cryptographically bound to
a real Stellar account's actual XLM/USDC balance. This means the current
demo proves "I know a number ≥ threshold," not "my real on-chain balance is
≥ threshold."

Closing that gap requires an oracle or signer that reads the real account
balance and signs it, so the circuit can also verify that signature against
a known public key. That's a well-scoped follow-up, deliberately cut from
this submission to keep the 12-day build honest and shippable — per the
hackathon's own guidance: *"if something's unfinished or you used mock data
in places, just say so in the README."*

## Architecture

```
balance, threshold  →  Circom circuit  →  Groth16 proof (snarkjs, BLS12-381)
                                                │
                                                ▼
                              Soroban verifier contract (Stellar testnet)
                              — checks the proof via the bls12_381 host
                                functions, returns true/false
```

- **Circuit**: `circuits/proof_of_funds.circom` — one comparator constraint
  (`GreaterEqThan`, from circomlib), compiled for the BLS12-381 scalar field
  (`circom --prime bls12381`) to match Soroban's native pairing support.
- **Verifier contract**: `verifier/` — forked from Stellar's official
  [`soroban-examples/groth16_verifier`](https://github.com/stellar/soroban-examples/tree/main/groth16_verifier).
  The Rust contract logic is fully generic (a Groth16 pairing check); only
  the verification key and proof data are circuit-specific. No contract code
  was changed beyond what the upstream example provides.
- **Trusted setup**: a fresh powers-of-tau + Groth16 phase-2 ceremony was run
  specifically for this circuit (see `circuits/pot_*.ptau`,
  `circuits/proof_of_funds_0001.zkey`) — it does not reuse the upstream
  example's multiplier-circuit keys.

## Deployed contract (Stellar testnet)

```
CB33TGWZROSRQRKFVZGZV74SKFGSDC6HOEN366PF2S2WD7ESRCHIR6VB
```

https://lab.stellar.org/r/testnet/contract/CB33TGWZROSRQRKFVZGZV74SKFGSDC6HOEN366PF2S2WD7ESRCHIR6VB

## Running the demo

Requires: `circom` 2.2+, `snarkjs`, Node.js, `stellar-cli` 27+, an
`stellar keys` identity funded on testnet.

```bash
./scripts/demo.sh <balance> <threshold>

# Example: prove a balance of 5000 meets a threshold of 1000
./scripts/demo.sh 5000 1000
# -> generates the witness + Groth16 proof off-chain, verifies it locally
#    with snarkjs, then submits it to the live testnet contract and prints
#    the on-chain verification result.

# Example: a balance that doesn't meet the threshold
./scripts/demo.sh 500 1000
# -> fails at witness generation. No proof exists to submit — this is the
#    security guarantee, not a bug.
```

`CONTRACT_ID`, `SOURCE`, and `NETWORK` env vars override the defaults in
`scripts/demo.sh` if you redeploy your own copy of the contract.

## Rebuilding the contract / redeploying

```bash
cd verifier
stellar contract build
stellar keys generate <your-alias> --network testnet --fund
stellar contract deploy \
  --wasm target/wasm32v1-none/release/proof_of_funds_verifier.wasm \
  --source <your-alias> --network testnet
```

## Why Circom + Groth16, not Noir

The hackathon's own listed Noir resource, "How To Verify Noir Ultrahonk
Circuits In A Stellar Contract" (James Bachini), states that on-chain
Ultrahonk verification is "right on the borderline of CPU instruction
limits" and currently requires a local `stellar/quickstart` network with
budget limits disabled — it isn't deployable to real testnet today.
Circom + Groth16 (BLS12-381) is the path Stellar's own engineering team used
to ship Stellar Private Payments, with a measured cost of ~41M CPU
instructions per pairing check against a 100M instruction budget —
comfortably within real network limits. That's why this project uses it.

## What was *not* built (out of scope for this submission)

- Balance attestation oracle (see "Known limitation" above).
- A general-purpose UI — the demo is a CLI script
  (`scripts/demo.sh`) by design, to keep the build surface small in a
  12-day window.
- Support for proof types beyond the single comparison constraint
  (no Merkle membership, no recursive/aggregated proofs, no pool/state
  model).
