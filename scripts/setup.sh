#!/usr/bin/env bash
# Trusted setup for Groth16 (powers of tau + circuit-specific phase 2).
# For production, use a real multi-party ceremony. This uses a local ceremony
# suitable for development/testing only.
set -e

BUILD_DIR="build"
PTAU="$BUILD_DIR/pot14_final.ptau"

# ---- Phase 1: Powers of Tau (circuit-independent) ----
if [ ! -f "$PTAU" ]; then
  echo "==> Phase 1: Powers of Tau ceremony (2^14 constraints max)"
  snarkjs powersoftau new bn128 14 "$BUILD_DIR/pot14_0000.ptau" -v
  snarkjs powersoftau contribute "$BUILD_DIR/pot14_0000.ptau" "$BUILD_DIR/pot14_0001.ptau" \
    --name="Dev contribution" -v -e="$(openssl rand -hex 32)"
  snarkjs powersoftau prepare phase2 "$BUILD_DIR/pot14_0001.ptau" "$PTAU" -v
  rm "$BUILD_DIR/pot14_0000.ptau" "$BUILD_DIR/pot14_0001.ptau"
  echo "==> Phase 1 complete: $PTAU"
else
  echo "==> Phase 1 already done, reusing: $PTAU"
fi

# ---- Phase 2: Circuit-specific setup (Groth16) ----
echo ""
echo "==> Phase 2: Circuit-specific key generation"
snarkjs groth16 setup "$BUILD_DIR/private_transfer.r1cs" "$PTAU" "$BUILD_DIR/private_transfer_0000.zkey"
snarkjs zkey contribute "$BUILD_DIR/private_transfer_0000.zkey" "$BUILD_DIR/private_transfer_0001.zkey" \
  --name="Dev contribution" -v -e="$(openssl rand -hex 32)"
snarkjs zkey export verificationkey "$BUILD_DIR/private_transfer_0001.zkey" "$BUILD_DIR/verification_key.json"
rm "$BUILD_DIR/private_transfer_0000.zkey"

echo ""
echo "==> Setup complete. Artifacts:"
echo "    Proving key  : $BUILD_DIR/private_transfer_0001.zkey"
echo "    Verif. key   : $BUILD_DIR/verification_key.json"
