#!/usr/bin/env bash
# Proves balance >= threshold off-chain (Circom + snarkjs) and verifies the
# resulting Groth16 proof on Stellar testnet, without ever revealing balance
# on-chain. Usage: ./demo.sh <balance> <threshold>
set -euo pipefail

if [ $# -ne 2 ]; then
  echo "Usage: $0 <balance> <threshold>"
  exit 1
fi

BALANCE="$1"
THRESHOLD="$2"

CONTRACT_ID="${CONTRACT_ID:-CB33TGWZROSRQRKFVZGZV74SKFGSDC6HOEN366PF2S2WD7ESRCHIR6VB}"
SOURCE="${SOURCE:-proof-of-funds-deployer}"
NETWORK="${NETWORK:-testnet}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CIRCUITS_DIR="$SCRIPT_DIR/../circuits"
OUT_DIR="${OUT_DIR:-/tmp/proof-of-funds-cli}"

echo "Proving balance=<private> >= threshold=$THRESHOLD ..."
echo "{\"balance\": \"$BALANCE\", \"threshold\": \"$THRESHOLD\"}" > "$CIRCUITS_DIR/input.json"

if ! node "$CIRCUITS_DIR/proof_of_funds_js/generate_witness.js" \
  "$CIRCUITS_DIR/proof_of_funds_js/proof_of_funds.wasm" \
  "$CIRCUITS_DIR/input.json" "$CIRCUITS_DIR/witness.wtns" 2>/tmp/witness_err.log; then
  echo "Could not generate a witness: the circuit's balance >= threshold constraint is unsatisfiable."
  echo "This is expected, by design, when balance < threshold — no proof can exist."
  exit 2
fi

snarkjs groth16 prove "$CIRCUITS_DIR/proof_of_funds_0001.zkey" \
  "$CIRCUITS_DIR/witness.wtns" "$CIRCUITS_DIR/proof.json" "$CIRCUITS_DIR/public.json" >/dev/null

echo "Off-chain sanity check (snarkjs):"
snarkjs groth16 verify "$CIRCUITS_DIR/verification_key.json" \
  "$CIRCUITS_DIR/public.json" "$CIRCUITS_DIR/proof.json"

node "$SCRIPT_DIR/proof_to_cli_args.js" "$OUT_DIR" >/dev/null

echo "Verifying on Stellar testnet (contract $CONTRACT_ID) ..."
RESULT=$(stellar contract invoke \
  --id "$CONTRACT_ID" --source "$SOURCE" --network "$NETWORK" \
  -- verify_proof \
  --vk-file-path "$OUT_DIR/vk.json" \
  --proof-file-path "$OUT_DIR/proof.json" \
  --pub_signals-file-path "$OUT_DIR/pub_signals.json" 2>/dev/null | tail -1)

if [ "$RESULT" = "true" ]; then
  echo "On-chain verification: PASSED"
  echo "Proven: balance >= $THRESHOLD, without revealing the actual balance."
else
  echo "On-chain verification: FAILED (unexpected — proof should have been valid)"
  exit 1
fi
