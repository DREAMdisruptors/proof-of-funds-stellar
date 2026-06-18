// Converts snarkjs Groth16 output (decimal field-element coordinates) into
// the big-endian hex format the Soroban BLS12-381 host type expects:
// G1 = x(48 bytes) || y(48 bytes). G2 coordinates are Fp2 = c0 + c1*u, and
// snarkjs's JSON gives each as [c0, c1] — but ark-ff's CanonicalSerialize
// for Fp2 writes c1 before c0, so the on-chain byte order is
// x.c1 || x.c0 || y.c1 || y.c0. Confirmed empirically against the Rust
// ark-bls12-381 serialize_uncompressed output used in verifier/src/test.rs.
const fs = require("fs");
const path = require("path");

function feHex(decimalStr) {
  return BigInt(decimalStr).toString(16).padStart(96, "0");
}

function g1Hex([x, y]) {
  return feHex(x) + feHex(y);
}

function g2Hex([[x0, x1], [y0, y1]]) {
  return feHex(x1) + feHex(x0) + feHex(y1) + feHex(y0);
}

function main() {
  const circuitsDir = path.join(__dirname, "..", "circuits");
  const outDir = process.argv[2] || "/tmp/proof-of-funds-cli";
  fs.mkdirSync(outDir, { recursive: true });

  const vk = JSON.parse(fs.readFileSync(path.join(circuitsDir, "verification_key.json")));
  const proof = JSON.parse(fs.readFileSync(path.join(circuitsDir, "proof.json")));
  const publicSignals = JSON.parse(fs.readFileSync(path.join(circuitsDir, "public.json")));

  const vkArg = {
    alpha: g1Hex(vk.vk_alpha_1),
    beta: g2Hex(vk.vk_beta_2),
    gamma: g2Hex(vk.vk_gamma_2),
    delta: g2Hex(vk.vk_delta_2),
    ic: vk.IC.map(g1Hex),
  };
  const proofArg = {
    a: g1Hex(proof.pi_a),
    b: g2Hex(proof.pi_b),
    c: g1Hex(proof.pi_c),
  };

  fs.writeFileSync(path.join(outDir, "vk.json"), JSON.stringify(vkArg));
  fs.writeFileSync(path.join(outDir, "proof.json"), JSON.stringify(proofArg));
  fs.writeFileSync(path.join(outDir, "pub_signals.json"), JSON.stringify(publicSignals));

  console.log(outDir);
}

main();
