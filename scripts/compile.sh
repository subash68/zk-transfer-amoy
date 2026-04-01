#!/usr/bin/env bash
set -e

CIRCUIT="circuits/private_transfer.circom"
BUILD_DIR="build"

echo "==> Compiling circuit: $CIRCUIT"
circom "$CIRCUIT" \
  --r1cs \
  --wasm \
  --sym \
  --output "$BUILD_DIR" \
  -l node_modules

echo ""
echo "==> Compilation artifacts:"
ls -lh "$BUILD_DIR"/

echo ""
echo "==> Circuit stats:"
snarkjs r1cs info "$BUILD_DIR/private_transfer.r1cs"
