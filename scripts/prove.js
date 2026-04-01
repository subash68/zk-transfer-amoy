/**
 * prove.js — Generate and verify a Groth16 proof for PrivateTransfer.
 *
 * Usage:
 *   node scripts/prove.js
 *
 * Requires the circuit to be compiled and setup:
 *   npm run compile && npm run setup
 */

const snarkjs = require("snarkjs");
const { buildPoseidon } = require("circomlibjs");
const path = require("path");
const fs = require("fs");

const BUILD = path.join(__dirname, "../build");

async function main() {
  const poseidon = await buildPoseidon();
  const F = poseidon.F;

  // Helper: compute Poseidon hash and return BigInt
  function hash(...inputs) {
    return F.toObject(poseidon(inputs.map(BigInt)));
  }

  // --- Example transfer scenario ---
  const senderBalance   = 100n;
  const senderSecret    = 123456789n;   // sender's spending key (kept private)
  const senderNonce     = 111n;         // unique nonce for this note
  const transferAmount  = 30n;
  const newSenderNonce  = 222n;         // fresh nonce for updated sender note
  const recipientPubKey = 987654321n;   // recipient's public key / address
  const recipientNonce  = 333n;

  const newSenderBalance = senderBalance - transferAmount; // 70n

  // Compute public values (these go on-chain)
  const senderCommitment    = hash(senderBalance, senderSecret, senderNonce);
  const nullifier           = hash(senderSecret, senderNonce);
  const newSenderCommitment = hash(newSenderBalance, senderSecret, newSenderNonce);
  const recipientCommitment = hash(transferAmount, recipientPubKey, recipientNonce);

  console.log("=== Transfer Parameters ===");
  console.log(`  Sender balance     : ${senderBalance}`);
  console.log(`  Transfer amount    : ${transferAmount}`);
  console.log(`  New sender balance : ${newSenderBalance}`);
  console.log("\n=== Public Signals (on-chain) ===");
  console.log(`  sender_commitment    : ${senderCommitment}`);
  console.log(`  nullifier            : ${nullifier}`);
  console.log(`  new_sender_commitment: ${newSenderCommitment}`);
  console.log(`  recipient_commitment : ${recipientCommitment}`);

  // Build witness input
  const input = {
    // Private
    sender_balance:    senderBalance.toString(),
    sender_secret:     senderSecret.toString(),
    sender_nonce:      senderNonce.toString(),
    transfer_amount:   transferAmount.toString(),
    new_sender_nonce:  newSenderNonce.toString(),
    recipient_pub_key: recipientPubKey.toString(),
    recipient_nonce:   recipientNonce.toString(),
    // Public
    sender_commitment:     senderCommitment.toString(),
    nullifier:             nullifier.toString(),
    new_sender_commitment: newSenderCommitment.toString(),
    recipient_commitment:  recipientCommitment.toString(),
  };

  const wasmPath = path.join(BUILD, "private_transfer_js/private_transfer.wasm");
  const zkeyPath = path.join(BUILD, "private_transfer_0001.zkey");
  const vkeyPath = path.join(BUILD, "verification_key.json");

  // Generate proof
  console.log("\n==> Generating proof...");
  const { proof, publicSignals } = await snarkjs.groth16.fullProve(input, wasmPath, zkeyPath);
  console.log("    Proof generated.");

  // Save proof artifacts
  fs.writeFileSync(path.join(BUILD, "proof.json"), JSON.stringify(proof, null, 2));
  fs.writeFileSync(path.join(BUILD, "public.json"), JSON.stringify(publicSignals, null, 2));

  // Verify proof
  console.log("\n==> Verifying proof...");
  const vkey = JSON.parse(fs.readFileSync(vkeyPath));
  const valid = await snarkjs.groth16.verify(vkey, publicSignals, proof);

  if (valid) {
    console.log("    [OK] Proof is VALID — transfer verified without revealing balances.");
  } else {
    console.error("    [FAIL] Proof is INVALID.");
    process.exit(1);
  }

  // Export Solidity verifier calldata (for on-chain verification)
  const calldata = await snarkjs.groth16.exportSolidityCallData(proof, publicSignals);
  fs.writeFileSync(path.join(BUILD, "calldata.txt"), calldata);
  console.log("\n==> Solidity calldata saved to build/calldata.txt");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
