pragma circom 2.1.6;

include "../node_modules/circomlib/circuits/poseidon.circom";
include "../node_modules/circomlib/circuits/comparators.circom";

/*
 * PrivateTransfer Circuit
 * =======================
 * Proves a valid token transfer between two parties without revealing balances.
 *
 * Commitment scheme:
 *   note_commitment = Poseidon(balance, secret, nonce)
 *   nullifier       = Poseidon(secret, nonce)
 *
 * The nullifier is published on-chain when a note is spent to prevent
 * double-spending, while keeping the balance private.
 *
 * What the circuit proves:
 *   1. Sender owns a valid note (knows preimage of sender_commitment)
 *   2. Sender has sufficient balance (sender_balance >= transfer_amount)
 *   3. Transfer amount is positive (transfer_amount > 0)
 *   4. New sender note is correctly formed (balance conservation)
 *   5. Recipient note is correctly formed
 *   6. Nullifier correctly derived (prevents double-spend)
 */
template PrivateTransfer() {

    // -------------------------
    // Private inputs (hidden)
    // -------------------------
    signal input sender_balance;     // Sender's current token balance
    signal input sender_secret;      // Sender's secret (like a spending key)
    signal input sender_nonce;       // Nonce bound to the current sender note
    signal input transfer_amount;    // Number of tokens to transfer
    signal input new_sender_nonce;   // Fresh nonce for the updated sender note
    signal input recipient_pub_key;  // Recipient's public key / address
    signal input recipient_nonce;    // Nonce for the recipient's new note

    // -------------------------
    // Public inputs (revealed)
    // -------------------------
    signal input sender_commitment;      // Poseidon(sender_balance, sender_secret, sender_nonce)
    signal input nullifier;              // Poseidon(sender_secret, sender_nonce) — marks note spent
    signal input new_sender_commitment;  // Poseidon(new_balance, sender_secret, new_sender_nonce)
    signal input recipient_commitment;   // Poseidon(transfer_amount, recipient_pub_key, recipient_nonce)

    // -------------------------
    // 1. Verify sender owns the note
    //    sender_commitment == Poseidon(sender_balance, sender_secret, sender_nonce)
    // -------------------------
    component h_sender = Poseidon(3);
    h_sender.inputs[0] <== sender_balance;
    h_sender.inputs[1] <== sender_secret;
    h_sender.inputs[2] <== sender_nonce;
    sender_commitment === h_sender.out;

    // -------------------------
    // 2. Derive nullifier to prevent double-spending
    //    nullifier == Poseidon(sender_secret, sender_nonce)
    // -------------------------
    component h_nullifier = Poseidon(2);
    h_nullifier.inputs[0] <== sender_secret;
    h_nullifier.inputs[1] <== sender_nonce;
    nullifier === h_nullifier.out;

    // -------------------------
    // 3. Enforce positive transfer amount (transfer_amount >= 1)
    //    Uses GreaterThan: transfer_amount > 0
    // -------------------------
    component gt_zero = GreaterThan(64);
    gt_zero.in[0] <== transfer_amount;
    gt_zero.in[1] <== 0;
    gt_zero.out === 1;

    // -------------------------
    // 4. Enforce sufficient balance (sender_balance >= transfer_amount)
    //    Uses GreaterEqThan: sender_balance >= transfer_amount
    // -------------------------
    component gte_balance = GreaterEqThan(64);
    gte_balance.in[0] <== sender_balance;
    gte_balance.in[1] <== transfer_amount;
    gte_balance.out === 1;

    // -------------------------
    // 5. Compute new sender balance (no overflow possible given constraint 4)
    // -------------------------
    signal new_sender_balance;
    new_sender_balance <== sender_balance - transfer_amount;

    // -------------------------
    // 6. Verify new sender commitment
    //    new_sender_commitment == Poseidon(new_sender_balance, sender_secret, new_sender_nonce)
    // -------------------------
    component h_new_sender = Poseidon(3);
    h_new_sender.inputs[0] <== new_sender_balance;
    h_new_sender.inputs[1] <== sender_secret;
    h_new_sender.inputs[2] <== new_sender_nonce;
    new_sender_commitment === h_new_sender.out;

    // -------------------------
    // 7. Verify recipient commitment
    //    recipient_commitment == Poseidon(transfer_amount, recipient_pub_key, recipient_nonce)
    // -------------------------
    component h_recipient = Poseidon(3);
    h_recipient.inputs[0] <== transfer_amount;
    h_recipient.inputs[1] <== recipient_pub_key;
    h_recipient.inputs[2] <== recipient_nonce;
    recipient_commitment === h_recipient.out;
}

// Public signals declared explicitly — everything else is private
component main {public [
    sender_commitment,
    nullifier,
    new_sender_commitment,
    recipient_commitment
]} = PrivateTransfer();
