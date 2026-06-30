pragma circom 2.0.0;

include "../node_modules/circomlib/circuits/comparators.circom";
include "../node_modules/circomlib/circuits/bitify.circom";

// Proves that a private balance is >= a public threshold, without
// revealing the balance. n is the bit width of both values (64 bits
// comfortably covers any USDC stroop amount).
template ProofOfFunds(n) {
    signal input balance;   // private
    signal input threshold; // public
    signal output ok;

    // GreaterEqThan(n) only constrains the *difference* of its inputs to
    // n+1 bits, not each input individually to n bits — so without this,
    // a value >= 2^n could still be accepted as long as the difference
    // happens to land back in range. Not exploitable today (balance isn't
    // bound to anything external yet, and real Stellar balances never
    // approach 2^64 stroops), but it's a landmine for whoever adds
    // attestation later, so it's range-checked explicitly here.
    component balanceBits = Num2Bits(n);
    balanceBits.in <== balance;
    component thresholdBits = Num2Bits(n);
    thresholdBits.in <== threshold;

    component geq = GreaterEqThan(n);
    geq.in[0] <== balance;
    geq.in[1] <== threshold;

    ok <== geq.out;

    // Force the constraint system to be unsatisfiable (no proof can be
    // generated) unless balance >= threshold actually holds.
    ok === 1;
}

component main {public [threshold]} = ProofOfFunds(64);
