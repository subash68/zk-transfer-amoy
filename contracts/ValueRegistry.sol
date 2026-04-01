// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title ValueRegistry
 * @notice Stores private value commitments on-chain and verifies ZK proofs
 *         that the committed value satisfies a given threshold — without
 *         revealing the actual value.
 *
 * Flow
 * ────
 *  1. Owner calls commit(commitment)
 *       → stores Poseidon(value, secret) on-chain
 *       → value and secret never touch the chain
 *
 *  2. Owner (or anyone holding the ZK proof) calls proveAboveThreshold(...)
 *       → contract verifies: committed value >= threshold
 *       → emits ProofVerified so third parties can observe/react
 *       → actual value remains hidden forever
 *
 * Use cases
 * ─────────
 *  - Credit score gates:    prove score >= 700 to access a lending pool
 *  - Age verification:      prove age >= 18 to access a dApp
 *  - Sealed bid auctions:   commit bid, later prove bid >= reserve price
 *  - KYC tiers:             prove AUM >= $10k without revealing exact amount
 */

interface IProveValueVerifier {
    function verifyProof(
        uint[2]    calldata _pA,
        uint[2][2] calldata _pB,
        uint[2]    calldata _pC,
        uint[3]    calldata _pubSignals   // [commitment, threshold, max_value]
    ) external view returns (bool);
}

contract ValueRegistry {
    IProveValueVerifier public immutable verifier;

    struct CommitmentRecord {
        bytes32 commitment;   // Poseidon(value, secret)
        address owner;        // who committed this value
        uint256 committedAt;  // block timestamp
        bool    exists;
    }

    // commitmentId → record
    mapping(uint256 => CommitmentRecord) public records;
    uint256 public nextId;

    // Track which (commitmentId, threshold) pairs have been proven
    // so third parties can query on-chain without re-verifying
    mapping(uint256 => mapping(uint256 => bool)) public provenAbove;

    event Committed(uint256 indexed id, bytes32 indexed commitment, address indexed owner);
    event ProofVerified(uint256 indexed id, uint256 threshold, address indexed verifiedBy);

    error CommitmentNotFound(uint256 id);
    error NotOwner(uint256 id);
    error CommitmentMismatch();
    error InvalidProof();

    constructor(address _verifier) {
        verifier = IProveValueVerifier(_verifier);
    }

    // ─────────────────────────────────────────────────────────────
    // Step 1 — Commit
    // ─────────────────────────────────────────────────────────────

    /**
     * @notice Store a value commitment on-chain.
     * @dev Compute off-chain: commitment = Poseidon(value, secret)
     *      Keep (value, secret) private.
     * @param commitment  Poseidon(value, secret)
     * @return id  The commitment ID — use this in future proof submissions
     */
    function commit(bytes32 commitment) external returns (uint256 id) {
        id = nextId++;
        records[id] = CommitmentRecord({
            commitment:  commitment,
            owner:       msg.sender,
            committedAt: block.timestamp,
            exists:      true
        });
        emit Committed(id, commitment, msg.sender);
    }

    // ─────────────────────────────────────────────────────────────
    // Step 2 — Prove
    // ─────────────────────────────────────────────────────────────

    /**
     * @notice Submit a ZK proof that the committed value is >= threshold.
     * @dev Public signals layout (must match circuit):
     *        _pubSignals[0] = commitment
     *        _pubSignals[1] = threshold
     *        _pubSignals[2] = max_value
     *
     * @param id         The commitment ID from commit()
     * @param _pA        Proof point A
     * @param _pB        Proof point B
     * @param _pC        Proof point C
     * @param _pubSignals [commitment, threshold, max_value]
     */
    function proveAboveThreshold(
        uint256    id,
        uint[2]    calldata _pA,
        uint[2][2] calldata _pB,
        uint[2]    calldata _pC,
        uint[3]    calldata _pubSignals
    ) external {
        CommitmentRecord storage rec = records[id];
        if (!rec.exists) revert CommitmentNotFound(id);

        // Ensure the proof is for the commitment we stored, not a different one
        if (bytes32(_pubSignals[0]) != rec.commitment) revert CommitmentMismatch();

        // Verify the ZK proof
        if (!verifier.verifyProof(_pA, _pB, _pC, _pubSignals)) revert InvalidProof();

        uint256 threshold = _pubSignals[1];
        provenAbove[id][threshold] = true;

        emit ProofVerified(id, threshold, msg.sender);
    }

    // ─────────────────────────────────────────────────────────────
    // View helpers for third-party integrations
    // ─────────────────────────────────────────────────────────────

    /**
     * @notice Check if a committed value has been proven >= threshold.
     * @dev Use this in other contracts to gate access:
     *        require(registry.hasProvenAbove(id, 700), "Score too low");
     */
    function hasProvenAbove(uint256 id, uint256 threshold) external view returns (bool) {
        return provenAbove[id][threshold];
    }

    function getCommitment(uint256 id) external view returns (bytes32, address, uint256) {
        CommitmentRecord storage rec = records[id];
        if (!rec.exists) revert CommitmentNotFound(id);
        return (rec.commitment, rec.owner, rec.committedAt);
    }
}
