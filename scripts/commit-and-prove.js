/**
 * commit-and-prove.js
 *
 * Demonstrates the full commit-then-prove flow on Polygon Amoy:
 *
 *   Step 1 — Compute commitment off-chain   (value + secret → hash)
 *   Step 2 — commit(hash)                  → store on-chain, get ID
 *   Step 3 — Generate ZK proof             → prove value >= threshold
 *   Step 4 — proveAboveThreshold(id, proof) → verified on-chain
 *   Step 5 — Third party reads provenAbove(id, threshold) → true
 *
 * Run: node scripts/commit-and-prove.js
 *
 * Requires:
 *   .env with PRIVATE_KEY and AMOY_RPC_URL
 *   build/deployment.json (from npm run deploy:amoy)
 *   build/prove_value_js/ + build/prove_value_0001.zkey
 */

require("dotenv").config();
const { ethers } = require("ethers");
const snarkjs = require("snarkjs");
const { buildPoseidon } = require("circomlibjs");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const BUILD = path.join(__dirname, "../build");
const ARTIFACTS = path.join(__dirname, "../artifacts/contracts");
const DEPLOYMENT = path.join(BUILD, "deployment.json");

function loadAbi(name) {
  const p = path.join(ARTIFACTS, `${name}.sol/${name}.json`);
  return JSON.parse(fs.readFileSync(p)).abi;
}

async function main() {
  // ---- Provider + signer ----
  const provider = new ethers.JsonRpcProvider(process.env.AMOY_RPC_URL);
  const signer = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
  console.log("Account:", signer.address, "\n");

  // ---- Load deployment ----
  if (!fs.existsSync(DEPLOYMENT)) {
    throw new Error(
      "build/deployment.json not found — run: npm run deploy:amoy",
    );
  }
  const deployment = JSON.parse(fs.readFileSync(DEPLOYMENT));
  const registryAddr = deployment.contracts.ValueRegistry;
  if (!registryAddr)
    throw new Error("ValueRegistry not in deployment.json — redeploy.");
  const registry = new ethers.Contract(
    registryAddr,
    loadAbi("ValueRegistry"),
    signer,
  );
  console.log("ValueRegistry at:", registryAddr, "\n");

  // ---- Poseidon hasher ----
  const poseidon = await buildPoseidon();
  const F = poseidon.F;
  const hash2 = (a, b) => F.toObject(poseidon([BigInt(a), BigInt(b)]));

  // ══════════════════════════════════════════════════════
  // STEP 1 — Define your private value and compute commitment
  // ══════════════════════════════════════════════════════
  const value = 742n; // e.g. FIAT Balance
  const secret = BigInt("0x" + crypto.randomBytes(31).toString("hex")); // blinding factor

  const commitment = hash2(value, secret);
  const commitmentHex = "0x" + commitment.toString(16).padStart(64, "0");
  const threshold = 700n; // public: "prove score >= 700"
  const maxValue = 2n ** 64n - 1n; // circuit upper bound

  console.log("=== Step 1: Commitment ===");
  console.log("  value      :", value.toString(), "  ← stays private forever");
  console.log("  threshold  :", threshold.toString(), " ← public");
  console.log("  commitment :", commitmentHex, "\n");

  // ══════════════════════════════════════════════════════
  // STEP 2 — Store commitment on-chain
  // ══════════════════════════════════════════════════════
  console.log("=== Step 2: Commit on-chain ===");
  const commitTx = await registry.commit(commitmentHex);
  console.log("  tx sent  :", commitTx.hash);
  const receipt = await commitTx.wait();

  // Parse the Committed event to get the assigned ID
  const event = receipt.logs
    .map((log) => {
      try {
        return registry.interface.parseLog(log);
      } catch {
        return null;
      }
    })
    .find((e) => e?.name === "Committed");
  const commitmentId = event.args.id;
  console.log("  confirmed. Commitment ID:", commitmentId.toString(), "\n");

  // ══════════════════════════════════════════════════════
  // STEP 3 — Generate ZK proof (off-chain)
  // ══════════════════════════════════════════════════════
  console.log("=== Step 3: Generate ZK proof ===");
  console.log(
    "  Proving: value >=",
    threshold.toString(),
    "without revealing",
    value.toString(),
  );

  const circuitInput = {
    // Private
    value: value.toString(),
    secret: secret.toString(),
    // Public
    commitment: commitment.toString(),
    threshold: threshold.toString(),
    max_value: maxValue.toString(),
  };

  const wasmPath = path.join(BUILD, "prove_value_js/prove_value.wasm");
  const zkeyPath = path.join(BUILD, "prove_value_0001.zkey");

  const { proof, publicSignals } = await snarkjs.groth16.fullProve(
    circuitInput,
    wasmPath,
    zkeyPath,
  );
  console.log("  proof generated.\n");

  // Format for Solidity
  const calldata = await snarkjs.groth16.exportSolidityCallData(
    proof,
    publicSignals,
  );
  const parsed = JSON.parse("[" + calldata + "]");
  const pA = parsed[0];
  const pB = parsed[1];
  const pC = parsed[2];
  const pubSignals = parsed[3]; // [commitment, threshold, max_value]

  // ══════════════════════════════════════════════════════
  // STEP 4 — Submit proof on-chain
  // ══════════════════════════════════════════════════════
  console.log("=== Step 4: Submit proof on-chain ===");
  const proveTx = await registry.proveAboveThreshold(
    commitmentId,
    pA,
    pB,
    pC,
    pubSignals,
  );
  console.log("  tx sent  :", proveTx.hash);
  const proveReceipt = await proveTx.wait();
  console.log("  confirmed in block:", proveReceipt.blockNumber);

  const proveEvent = proveReceipt.logs
    .map((log) => {
      try {
        return registry.interface.parseLog(log);
      } catch {
        return null;
      }
    })
    .find((e) => e?.name === "ProofVerified");
  if (proveEvent) {
    console.log("  ProofVerified event:");
    console.log("    id        :", proveEvent.args.id.toString());
    console.log("    threshold :", proveEvent.args.threshold.toString());
    console.log("    verifiedBy:", proveEvent.args.verifiedBy);
  }

  // ══════════════════════════════════════════════════════
  // STEP 5 — Third party reads the proof result
  // ══════════════════════════════════════════════════════
  console.log("\n=== Step 5: Third-party verification (read-only) ===");
  const proven = await registry.hasProvenAbove(commitmentId, threshold);
  console.log(
    `  registry.hasProvenAbove(${commitmentId}, ${threshold}) →`,
    proven,
  );
  console.log("  ✓ Any contract can now gate access on this result.");
  console.log("  ✓ The actual value", value.toString(), "was never revealed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
