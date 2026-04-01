/**
 * export-contracts.js
 *
 * Generates Solidity contracts from build artifacts:
 *   1. contracts/Verifier.sol — Groth16 proof verifier (from snarkjs)
 *
 * PoseidonT4 is NOT generated as Solidity — circomlibjs produces raw EVM bytecode,
 * not Solidity source. It is deployed directly from bytecode in deploy.js.
 * contracts/IPoseidonT4.sol only contains the interface for type-safe calls.
 *
 * Run AFTER: npm run compile && npm run setup
 * Then run:  npm run compile:contracts
 */

const snarkjs = require("snarkjs");
const fs = require("fs");
const path = require("path");

const BUILD = path.join(__dirname, "../build");
const CONTRACTS = path.join(__dirname, "../contracts");

async function main() {
  // ---- 1. Export Groth16 Verifier ----
  console.log("==> Exporting Verifier.sol...");
  const zkey = path.join(BUILD, "private_transfer_0001.zkey");
  if (!fs.existsSync(zkey)) {
    throw new Error(`Proving key not found: ${zkey}\nRun: npm run compile && npm run setup`);
  }

  // snarkjs locks its exports map, so read the template directly from node_modules
  const templatePath = path.join(__dirname, "../node_modules/snarkjs/templates/verifier_groth16.sol.ejs");
  const verifierCode = await snarkjs.zKey.exportSolidityVerifier(zkey, {
    groth16: fs.readFileSync(templatePath, "utf-8"),
  });
  fs.writeFileSync(path.join(CONTRACTS, "Verifier.sol"), verifierCode);
  console.log("    Written: contracts/Verifier.sol");

  console.log("    Note: PoseidonT4 is deployed from bytecode in deploy.js (not Solidity).");
  console.log("\nDone. Next: npm run compile:contracts");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
