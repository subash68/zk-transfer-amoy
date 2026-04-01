#!/usr/bin/env bash
set -e

BUILD_DIR="build"

compile_circuit() {
  local CIRCUIT="$1"
  local NAME="$2"
  echo "==> Compiling: $CIRCUIT"
  circom "$CIRCUIT" \
    --r1cs \
    --wasm \
    --sym \
    --output "$BUILD_DIR" \
    -l node_modules
  echo "    Stats:"
  snarkjs r1cs info "$BUILD_DIR/${NAME}.r1cs"
  echo ""
}

compile_circuit "circuits/private_transfer.circom" "private_transfer"
compile_circuit "circuits/prove_value.circom"      "prove_value"

echo "==> All circuits compiled. Artifacts in $BUILD_DIR/"
ls -lh "$BUILD_DIR"/*.r1cs
