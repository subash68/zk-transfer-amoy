# ZK Private Token Transfer

A zero-knowledge circuit that proves a valid token transfer between two parties **without revealing any balances**.

## How it works

Balances are never stored in plaintext. Instead, each account holds a **note commitment**:

```text
commitment = Poseidon(balance, secret, nonce)
```

To transfer tokens, the sender generates a ZK proof that:

1. They own a valid note (`sender_commitment` matches their private balance + secret)
2. Their balance is sufficient (`sender_balance >= transfer_amount`)
3. The transfer amount is positive
4. The new sender note is correctly formed (balance conservation)
5. The recipient note is correctly formed
6. The **nullifier** is correctly derived — this is published on-chain to prevent double-spending

```text
nullifier = Poseidon(secret, nonce)
```

The verifier (smart contract) only sees: `sender_commitment`, `nullifier`, `new_sender_commitment`, `recipient_commitment` — **never the actual balances**.

## Circuit design

```text
Private inputs          Public inputs (on-chain)
──────────────          ────────────────────────
sender_balance    ──►   sender_commitment
sender_secret     ──►   nullifier
sender_nonce      ──►   new_sender_commitment
transfer_amount         recipient_commitment
new_sender_nonce
recipient_pub_key
recipient_nonce
```

## Project structure

```text
circuits/
  private_transfer.circom   # Main ZK circuit (Circom 2)
scripts/
  install-circom.sh         # Install circom + snarkjs
  compile.sh                # Compile circuit → r1cs + wasm
  setup.sh                  # Trusted setup (Powers of Tau + Groth16 keys)
  prove.js                  # Generate & verify a sample proof
tests/
  private_transfer_test.js  # Integration tests (valid + invalid cases)
build/                      # Compilation artifacts (gitignored)
```

## Quick start

### 1. Install tools

```bash
# Install circom (requires Rust/cargo)
npm run install:circom

# Install JS dependencies
npm install
```

### 2. Compile the circuit

```bash
npm run compile
```

This produces `build/private_transfer.r1cs`, `.wasm`, and `.sym`.

### 3. Trusted setup (Groth16)

```bash
npm run setup
```

Generates `build/private_transfer_0001.zkey` (proving key) and `build/verification_key.json`.

> **Note:** This runs a local ceremony suitable for development only. Production deployments require a multi-party ceremony.

### 4. Generate and verify a proof

```bash
npm run prove
```

### 5. Run tests

```bash
npm test
```

## Technology

- **Circom 2** — circuit language
- **SnarkJS** — proof generation and verification (Groth16 / BN128)
- **Poseidon hash** — ZK-friendly hash function from circomlib
- **Groth16** — proving system (constant-size proofs, fast on-chain verification)

## On-chain integration

After running `npm run prove`, `build/calldata.txt` contains the ABI-encoded calldata for the Solidity verifier. Export the verifier contract with:

```bash
npx snarkjs zkey export solidityverifier build/private_transfer_0001.zkey build/Verifier.sol
```
