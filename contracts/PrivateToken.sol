// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./IPoseidonT4.sol";

/**
 * @title PrivateToken
 * @notice Privacy-preserving MATIC transfers on Polygon using ZK proofs.
 *
 * Privacy model
 * ─────────────
 * • Deposit   — amount is PUBLIC (MATIC locked, commitment stored on-chain)
 * • Transfer  — fully PRIVATE (ZK proof; balances never leave the circuit)
 * • Withdraw  — amount revealed by the note owner (preimage disclosed)
 *
 * Commitment scheme (matches the circuit)
 * ────────────────────────────────────────
 *   commitment = Poseidon(balance, secret, nonce)
 *   nullifier  = Poseidon(secret, nonce)          ← prevents double-spend
 *
 * On-chain state
 * ──────────────
 *   commitments[h] = true   → note h exists and is unspent
 *   nullifiers[n]  = true   → note was already spent
 */

interface IVerifier {
    function verifyProof(
        uint[2] calldata _pA,
        uint[2][2] calldata _pB,
        uint[2] calldata _pC,
        uint[4] calldata _pubSignals
    ) external view returns (bool);
}

contract PrivateToken {
    IVerifier   public immutable verifier;
    IPoseidonT4 public immutable poseidon;

    /// @notice All unspent note commitments
    mapping(bytes32 => bool) public commitments;

    /// @notice Spent nullifiers — each can only be used once
    mapping(bytes32 => bool) public nullifiers;

    event Deposited(bytes32 indexed commitment, uint256 amount);
    event Transferred(
        bytes32 indexed nullifier,
        bytes32 indexed newSenderCommitment,
        bytes32 indexed recipientCommitment
    );
    event Withdrawn(bytes32 indexed commitment, address indexed recipient, uint256 amount);

    error CommitmentAlreadyExists(bytes32 commitment);
    error CommitmentNotFound(bytes32 commitment);
    error NullifierAlreadySpent(bytes32 nullifier);
    error InvalidProof();
    error InvalidNotePreimage();
    error InsufficientPoolBalance(uint256 requested, uint256 available);
    error TransferFailed();

    constructor(address _verifier, address _poseidon) {
        verifier = IVerifier(_verifier);
        poseidon = IPoseidonT4(_poseidon);
    }

    // ─────────────────────────────────────────────────────────────
    // Deposit
    // ─────────────────────────────────────────────────────────────

    /**
     * @notice Deposit MATIC and register a note commitment.
     * @dev Compute commitment off-chain:
     *        commitment = Poseidon(msg.value_in_wei, secret, nonce)
     *      Keep (secret, nonce) private — they are your spending key for this note.
     * @param commitment Poseidon hash of (amount, secret, nonce)
     */
    function deposit(bytes32 commitment) external payable {
        if (msg.value == 0) revert InsufficientPoolBalance(0, 0);
        if (commitments[commitment]) revert CommitmentAlreadyExists(commitment);

        commitments[commitment] = true;
        emit Deposited(commitment, msg.value);
    }

    // ─────────────────────────────────────────────────────────────
    // Transfer (ZK proof)
    // ─────────────────────────────────────────────────────────────

    /**
     * @notice Transfer tokens privately using a Groth16 ZK proof.
     * @dev Public signals layout (must match circuit declaration order):
     *        _pubSignals[0] = sender_commitment
     *        _pubSignals[1] = nullifier
     *        _pubSignals[2] = new_sender_commitment
     *        _pubSignals[3] = recipient_commitment
     *
     * @param _pA  Proof component A
     * @param _pB  Proof component B
     * @param _pC  Proof component C
     * @param _pubSignals  The four public signals from the ZK proof
     */
    function transfer(
        uint[2]    calldata _pA,
        uint[2][2] calldata _pB,
        uint[2]    calldata _pC,
        uint[4]    calldata _pubSignals
    ) external {
        bytes32 senderCommitment    = bytes32(_pubSignals[0]);
        bytes32 nullifier           = bytes32(_pubSignals[1]);
        bytes32 newSenderCommitment = bytes32(_pubSignals[2]);
        bytes32 recipientCommitment = bytes32(_pubSignals[3]);

        // Pre-checks (gas-efficient ordering: cheap checks first)
        if (!commitments[senderCommitment])  revert CommitmentNotFound(senderCommitment);
        if (nullifiers[nullifier])           revert NullifierAlreadySpent(nullifier);

        // Verify the ZK proof (most expensive — do last)
        if (!verifier.verifyProof(_pA, _pB, _pC, _pubSignals)) revert InvalidProof();

        // Spend the sender note
        nullifiers[nullifier]      = true;
        delete commitments[senderCommitment];

        // Register the two output notes
        commitments[newSenderCommitment] = true;
        commitments[recipientCommitment] = true;

        emit Transferred(nullifier, newSenderCommitment, recipientCommitment);
    }

    // ─────────────────────────────────────────────────────────────
    // Withdraw
    // ─────────────────────────────────────────────────────────────

    /**
     * @notice Withdraw MATIC by revealing the note preimage.
     * @dev The contract verifies Poseidon(amount, secret, nonce) == commitment
     *      on-chain, then transfers `amount` wei to `recipient`.
     *      Revealing (secret, nonce) invalidates the note — never reuse them.
     *
     * @param commitment  The note commitment to spend
     * @param amount      Balance encoded in the note (in wei)
     * @param secret      Spending secret
     * @param nonce       Note nonce
     * @param recipient   Address to receive the MATIC
     */
    function withdraw(
        bytes32        commitment,
        uint256        amount,
        uint256        secret,
        uint256        nonce,
        address payable recipient
    ) external {
        if (!commitments[commitment]) revert CommitmentNotFound(commitment);

        // Verify preimage matches commitment using on-chain Poseidon
        uint256 expected = poseidon.poseidon([amount, secret, nonce]);
        if (bytes32(expected) != commitment) revert InvalidNotePreimage();

        if (address(this).balance < amount)
            revert InsufficientPoolBalance(amount, address(this).balance);

        delete commitments[commitment];
        emit Withdrawn(commitment, recipient, amount);

        (bool ok, ) = recipient.call{value: amount}("");
        if (!ok) revert TransferFailed();
    }

    receive() external payable {}
}
