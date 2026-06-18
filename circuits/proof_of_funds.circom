pragma circom 2.0.0;

include "../node_modules/circomlib/circuits/comparators.circom";

// Proves that a private balance is >= a public threshold, without
// revealing the balance. n is the bit width of both values (64 bits
// comfortably covers any USDC stroop amount).
template ProofOfFunds(n) {
    signal input balance;   // private
    signal input threshold; // public
    signal output ok;

    component geq = GreaterEqThan(n);
    geq.in[0] <== balance;
    geq.in[1] <== threshold;

    ok <== geq.out;

    // Force the constraint system to be unsatisfiable (no proof can be
    // generated) unless balance >= threshold actually holds.
    ok === 1;
}

component main {public [threshold]} = ProofOfFunds(64);
