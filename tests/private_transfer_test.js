/**
 * private_transfer_test.js
 *
 * Integration tests for the PrivateTransfer circuit.
 * Tests both valid proofs and expected constraint violations.
 *
 * Run: npm test
 * (requires: npm run compile && npm run setup first)
 */

const snarkjs = require("snarkjs");
const { buildPoseidon } = require("circomlibjs");
const path = require("path");
const fs = require("fs");

const BUILD = path.join(__dirname, "../build");
const WASM  = path.join(BUILD, "private_transfer_js/private_transfer.wasm");
const ZKEY  = path.join(BUILD, "private_transfer_0001.zkey");
const VKEY  = path.join(BUILD, "verification_key.json");

// ---- Minimal test runner ----
let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`  [PASS] ${name}`);
    passed++;
  } catch (err) {
    console.error(`  [FAIL] ${name}`);
    console.error(`         ${err.message || err}`);
    failed++;
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message || "Assertion failed");
}

// ---- Helpers ----
let poseidon, F;

function hash(...inputs) {
  return F.toObject(poseidon(inputs.map(BigInt)));
}

function buildInput({
  senderBalance   = 100n,
  senderSecret    = 123456789n,
  senderNonce     = 111n,
  transferAmount  = 30n,
  newSenderNonce  = 222n,
  recipientPubKey = 987654321n,
  recipientNonce  = 333n,
} = {}) {
  const newSenderBalance = senderBalance - transferAmount;
  return {
    // Public
    sender_commitment:     hash(senderBalance, senderSecret, senderNonce).toString(),
    nullifier:             hash(senderSecret, senderNonce).toString(),
    new_sender_commitment: hash(newSenderBalance, senderSecret, newSenderNonce).toString(),
    recipient_commitment:  hash(transferAmount, recipientPubKey, recipientNonce).toString(),
    // Private
    sender_balance:    senderBalance.toString(),
    sender_secret:     senderSecret.toString(),
    sender_nonce:      senderNonce.toString(),
    transfer_amount:   transferAmount.toString(),
    new_sender_nonce:  newSenderNonce.toString(),
    recipient_pub_key: recipientPubKey.toString(),
    recipient_nonce:   recipientNonce.toString(),
  };
}

async function prove(input) {
  return snarkjs.groth16.fullProve(input, WASM, ZKEY);
}

async function verify(proof, publicSignals) {
  const vkey = JSON.parse(fs.readFileSync(VKEY));
  return snarkjs.groth16.verify(vkey, publicSignals, proof);
}

// ---- Check build artifacts exist ----
function checkArtifacts() {
  if (!fs.existsSync(WASM) || !fs.existsSync(ZKEY) || !fs.existsSync(VKEY)) {
    console.error("\nBuild artifacts not found. Please run first:");
    console.error("  npm run compile && npm run setup\n");
    process.exit(1);
  }
}

// ---- Tests ----
async function runTests() {
  poseidon = await buildPoseidon();
  F = poseidon.F;

  checkArtifacts();

  console.log("\nPrivateTransfer Circuit Tests\n" + "=".repeat(40));

  // --- Happy path ---
  await test("Valid transfer: 100 -> send 30 -> balance 70", async () => {
    const input = buildInput({ senderBalance: 100n, transferAmount: 30n });
    const { proof, publicSignals } = await prove(input);
    const valid = await verify(proof, publicSignals);
    assert(valid, "Proof should be valid");
  });

  await test("Valid transfer: full balance (send everything)", async () => {
    const input = buildInput({ senderBalance: 50n, transferAmount: 50n });
    const { proof, publicSignals } = await prove(input);
    const valid = await verify(proof, publicSignals);
    assert(valid, "Proof should be valid");
  });

  await test("Valid transfer: minimum amount (1 token)", async () => {
    const input = buildInput({ senderBalance: 100n, transferAmount: 1n });
    const { proof, publicSignals } = await prove(input);
    const valid = await verify(proof, publicSignals);
    assert(valid, "Proof should be valid");
  });

  // --- Constraint violations (should throw / fail to prove) ---
  await test("Invalid: transfer exceeds balance (overdraft rejected)", async () => {
    let threw = false;
    try {
      // balance=50, amount=100 — should fail constraint
      const input = buildInput({ senderBalance: 50n, transferAmount: 100n });
      await prove(input);
    } catch (_) {
      threw = true;
    }
    assert(threw, "Should have thrown for overdraft");
  });

  await test("Invalid: tampered sender commitment (wrong balance claimed)", async () => {
    let threw = false;
    try {
      const input = buildInput();
      // Lie about the commitment — claim balance=200 but use real balance=100
      input.sender_commitment = hash(200n, 123456789n, 111n).toString();
      await prove(input);
    } catch (_) {
      threw = true;
    }
    assert(threw, "Should have thrown for tampered commitment");
  });

  await test("Invalid: tampered nullifier", async () => {
    let threw = false;
    try {
      const input = buildInput();
      input.nullifier = hash(999n, 999n).toString(); // wrong nullifier
      await prove(input);
    } catch (_) {
      threw = true;
    }
    assert(threw, "Should have thrown for wrong nullifier");
  });

  await test("Invalid: wrong new_sender_commitment (balance mismatch)", async () => {
    let threw = false;
    try {
      const input = buildInput({ senderBalance: 100n, transferAmount: 30n });
      // Lie: claim new balance is 80 instead of 70
      input.new_sender_commitment = hash(80n, 123456789n, 222n).toString();
      await prove(input);
    } catch (_) {
      threw = true;
    }
    assert(threw, "Should have thrown for wrong new sender commitment");
  });

  // --- Summary ---
  console.log("\n" + "=".repeat(40));
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

runTests().catch((err) => {
  console.error(err);
  process.exit(1);
});
