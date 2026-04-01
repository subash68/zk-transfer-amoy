#!/usr/bin/env bash
set -e

echo "==> Installing circom from GitHub..."
cargo install --git https://github.com/iden3/circom.git circom

echo "==> Installing snarkjs globally..."
npm install -g snarkjs

echo "==> Versions:"
circom --version
snarkjs --version

echo "Done. You can now run: npm run compile"
