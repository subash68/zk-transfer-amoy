/**
 * submit-transfer.js
 *
 * End-to-end demonstration of a private token transfer on Polygon Amoy:
 *
 *   Step 1 — Compute commitments + nullifier off-chain (never sent to chain)
 *   Step 2 — deposit(commitment)           → locks MATIC, registers sender note
 *   Step 3 — Generate ZK proof             → proves valid transfer in zero-knowledge
 *   Step 4 — transfer(proof, publicSignals) → verifies proof on-chain, updates notes
 *   Step 5 — withdraw(preimage)            → recipient redeems their note
 *
 * Run: node scripts/submit-transfer.js
 *
 * Requires:
 *   .env with PRIVATE_KEY and AMOY_RPC_URL
 *   build/deployment.json (from npm run deploy:amoy)
 *   build/private_transfer_0001.zkey + build/private_transfer_js/
 */

require("dotenv").config();
const { ethers }      = require("ethers");
const snarkjs         = require("snarkjs");
const { buildPoseidon } = require("circomlibjs");
const fs              = require("fs");
const path            = require("path");

const BUILD      = path.join(__dirname, "../build");
const ARTIFACTS  = path.join(__dirname, "../artifacts/contracts");
const DEPLOYMENT = path.join(BUILD, "deployment.json");

// ── ABI helpers ─────────────────────────────────────────────────────────────
function loadAbi(name) {
  const p = path.join(ARTIFACTS, `${name}.sol/${name}.json`);
  return JSON.parse(fs.readFileSync(p)).abi;
}

// ── Poseidon helper ──────────────────────────────────────────────────────────
async function buildHasher() {
  const poseidon = await buildPoseidon();
  const F = poseidon.F;
  return (...inputs) => F.toObject(poseidon(inputs.map(BigInt)));
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  // ---- Setup provider + signer ----
  const provider = new ethers.JsonRpcProvider(process.env.AMOY_RPC_URL);
  const signer   = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
  console.log("Account:", signer.address);
  console.log("Balance:", ethers.formatEther(await provider.getBalance(signer.address)), "MATIC\n");

  // ---- Load deployment ----
  if (!fs.existsSync(DEPLOYMENT)) {
    throw new Error("build/deployment.json not found — run: npm run deploy:amoy");
  }
  const deployment  = JSON.parse(fs.readFileSync(DEPLOYMENT));
  const tokenAddr   = deployment.contracts.PrivateToken;
  const token       = new ethers.Contract(tokenAddr, loadAbi("PrivateToken"), signer);
  console.log("PrivateToken at:", tokenAddr, "\n");

  const hash = await buildHasher();

  // ══════════════════════════════════════════════════════════════════
  // STEP 1 — Define sender note (all values kept private off-chain)
  // ══════════════════════════════════════════════════════════════════
  const senderBalance   = 10_000_000_000_000_000n; // 0.01 MATIC in wei
  const senderSecret    = BigInt("0x" + require("crypto").randomBytes(31).toString("hex"));
  const senderNonce     = BigInt("0x" + require("crypto").randomBytes(31).toString("hex"));

  const senderCommitment = hash(senderBalance, senderSecret, senderNonce);
  const nullifier        = hash(senderSecret, senderNonce);

  console.log("=== Step 1: Sender note ===");
  console.log("  balance   :", senderBalance.toString(), "wei (0.01 MATIC)");
  console.log("  commitment:", "0x" + senderCommitment.toString(16).padStart(64, "0"));
  console.log("  nullifier :", "0x" + nullifier.toString(16).padStart(64, "0"), "\n");

  // ══════════════════════════════════════════════════════════════════
  // STEP 2 — Deposit: lock MATIC, register sender note on-chain
  // ══════════════════════════════════════════════════════════════════
  console.log("=== Step 2: Deposit ===");
  const commitmentBytes = "0x" + senderCommitment.toString(16).padStart(64, "0");
  const depositTx = await token.deposit(commitmentBytes, { value: senderBalance });
  console.log("  tx sent  :", depositTx.hash);
  await depositTx.wait();
  console.log("  confirmed. Commitment registered on-chain.\n");

  // ══════════════════════════════════════════════════════════════════
  // STEP 3 — Define transfer parameters + generate ZK proof
  // ══════════════════════════════════════════════════════════════════
  const transferAmount  = 3_000_000_000_000_000n; // 0.003 MATIC
  const newSenderNonce  = BigInt("0x" + require("crypto").randomBytes(31).toString("hex"));
  const recipientPubKey = BigInt(signer.address); // demo: send to self
  const recipientNonce  = BigInt("0x" + require("crypto").randomBytes(31).toString("hex"));

  const newSenderBalance    = senderBalance - transferAmount;
  const newSenderCommitment = hash(newSenderBalance, senderSecret, newSenderNonce);
  const recipientCommitment = hash(transferAmount, recipientPubKey, recipientNonce);

  console.log("=== Step 3: Generate ZK proof ===");
  console.log("  transfer amount :", transferAmount.toString(), "wei");
  console.log("  new sender bal  :", newSenderBalance.toString(), "wei");

  const circuitInput = {
    // Private inputs
    sender_balance:    senderBalance.toString(),
    sender_secret:     senderSecret.toString(),
    sender_nonce:      senderNonce.toString(),
    transfer_amount:   transferAmount.toString(),
    new_sender_nonce:  newSenderNonce.toString(),
    recipient_pub_key: recipientPubKey.toString(),
    recipient_nonce:   recipientNonce.toString(),
    // Public inputs
    sender_commitment:     senderCommitment.toString(),
    nullifier:             nullifier.toString(),
    new_sender_commitment: newSenderCommitment.toString(),
    recipient_commitment:  recipientCommitment.toString(),
  };

  const wasmPath = path.join(BUILD, "private_transfer_js/private_transfer.wasm");
  const zkeyPath = path.join(BUILD, "private_transfer_0001.zkey");

  const { proof, publicSignals } = await snarkjs.groth16.fullProve(circuitInput, wasmPath, zkeyPath);
  console.log("  proof generated.\n");

  // Format proof for Solidity calldata
  const calldata = await snarkjs.groth16.exportSolidityCallData(proof, publicSignals);
  // calldata = '["0x...","0x..."],[ ["0x...","0x..."],["0x...","0x..."] ],["0x...","0x..."],["0x...","0x...","0x...","0x..."]'
  const parsed = JSON.parse("[" + calldata + "]");
  const pA          = parsed[0];
  const pB          = parsed[1];
  const pC          = parsed[2];
  const pubSignals  = parsed[3];

  // ══════════════════════════════════════════════════════════════════
  // STEP 4 — Submit transfer transaction to chain
  // ══════════════════════════════════════════════════════════════════
  console.log("=== Step 4: Submit transfer tx ===");
  const transferTx = await token.transfer(pA, pB, pC, pubSignals);
  console.log("  tx sent  :", transferTx.hash);
  const receipt = await transferTx.wait();
  console.log("  confirmed in block:", receipt.blockNumber);

  // Parse the Transferred event
  const event = receipt.logs
    .map(log => { try { return token.interface.parseLog(log); } catch { return null; } })
    .find(e => e?.name === "Transferred");
  if (event) {
    console.log("  Transferred event:");
    console.log("    nullifier            :", event.args.nullifier);
    console.log("    newSenderCommitment  :", event.args.newSenderCommitment);
    console.log("    recipientCommitment  :", event.args.recipientCommitment);
  }
  console.log("  Balances remain PRIVATE — on-chain only sees commitments.\n");

  // ══════════════════════════════════════════════════════════════════
  // STEP 5 — Withdraw (recipient redeems their note)
  // ══════════════════════════════════════════════════════════════════
  console.log("=== Step 5: Withdraw recipient note ===");
  const recipientCommitmentBytes = "0x" + recipientCommitment.toString(16).padStart(64, "0");
  const withdrawTx = await token.withdraw(
    recipientCommitmentBytes,
    transferAmount,
    recipientPubKey,  // secret used in this demo = recipientPubKey (real apps use a random secret)
    recipientNonce,
    signer.address
  );
  console.log("  tx sent  :", withdrawTx.hash);
  await withdrawTx.wait();
  console.log("  confirmed. MATIC sent to:", signer.address);
  console.log("\nDone — private transfer complete.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
