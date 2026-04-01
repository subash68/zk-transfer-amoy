pragma circom 2.1.6;

include "../node_modules/circomlib/circuits/poseidon.circom";
include "../node_modules/circomlib/circuits/comparators.circom";

/*
 * ProveValue Circuit
 * ==================
 * Proves a fact about a private committed value without revealing it.
 *
 * Commitment scheme:
 *   commitment = Poseidon(value, secret)
 *
 * Use cases:
 *   - "My credit score is >= 700" (without revealing 742)
 *   - "I am older than 18"        (without revealing age)
 *   - "My bid is within budget"   (sealed auction)
 *   - "My balance meets KYC tier" (DeFi compliance)
 *
 * The circuit proves ALL of the following simultaneously:
 *   1. You know (value, secret) such that Poseidon(value, secret) == commitment
 *   2. value >= threshold         (range check — threshold is public)
 *   3. value <= max_value         (upper bound — prevents overflow tricks)
 *
 * To prove simple knowledge of preimage only (no range check),
 * set threshold = 0 and max_value = 2^64-1 in the inputs.
 */
template ProveValue(BITS) {
    // -------------------------
    // Private inputs (hidden)
    // -------------------------
    signal input value;     // The secret value being committed to
    signal input secret;    // Blinding factor — prevents brute-force of commitment

    // -------------------------
    // Public inputs (on-chain)
    // -------------------------
    signal input commitment;  // Poseidon(value, secret) — stored on-chain
    signal input threshold;   // Public lower bound: value >= threshold
    signal input max_value;   // Public upper bound:  value <= max_value

    // -------------------------
    // 1. Verify commitment
    //    commitment == Poseidon(value, secret)
    // -------------------------
    component h = Poseidon(2);
    h.inputs[0] <== value;
    h.inputs[1] <== secret;
    commitment === h.out;

    // -------------------------
    // 2. value >= threshold
    // -------------------------
    component gte = GreaterEqThan(BITS);
    gte.in[0] <== value;
    gte.in[1] <== threshold;
    gte.out === 1;

    // -------------------------
    // 3. value <= max_value
    //    i.e. max_value >= value
    // -------------------------
    component lte = GreaterEqThan(BITS);
    lte.in[0] <== max_value;
    lte.in[1] <== value;
    lte.out === 1;
}

// 64-bit values — supports numbers up to ~1.8 × 10^19
// Increase BITS if you need larger values (costs more constraints)
component main {public [commitment, threshold, max_value]} = ProveValue(64);
