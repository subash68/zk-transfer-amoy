// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @notice Interface for the circomlibjs-generated PoseidonT4 contract (3 inputs).
/// Deployed from raw bytecode in deploy.js — no Solidity source available.
interface IPoseidonT4 {
    function poseidon(uint256[3] calldata inputs) external pure returns (uint256);
}
