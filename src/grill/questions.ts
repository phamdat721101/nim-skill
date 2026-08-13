/**
 * src/grill/questions.ts
 * ----------------------
 * Built-in domain question banks for the two PRD specialisations plus a
 * generic security fallback. Each question includes an agent-recommended
 * architectural answer (the `recommendation` field) so the host agent can
 * surface it alongside the question without making a separate LLM call.
 *
 * Question IDs are stable: never renumber an existing question (the session
 * store references them by ID in JSONL answer records). Extend by appending
 * new questions with the next available index.
 */

import type { GrillQuestion } from './types.js';

type QuestionTemplate = Omit<GrillQuestion, 'resolved'>;

// ─── x402 Protocol Branch ────────────────────────────────────────────────────
// Three sub-branches: HTTP-Native Integration, ERC-3009/Permit2, Facilitator

export const X402_QUESTIONS: QuestionTemplate[] = [
  // HTTP-Native Integration
  {
    id: 'x402-001',
    branch: 'x402_protocol',
    text: 'How does your HTTP 402 challenge header encode payment amount, token address, and expiry in a machine-parseable format — and what prevents a malformed JSON payload from causing a silent payment skip?',
    recommendation:
      'Use a base64-encoded JSON schema with required `amount`, `token`, `chain_id`, `expiry_unix` fields. Validate server-side with Zod or AJV before processing. Return HTTP 400 on schema failure — never silently skip.',
  },
  {
    id: 'x402-002',
    branch: 'x402_protocol',
    text: 'When the HTTP 402 challenge expires mid-session, what is your renewal strategy — re-issue the challenge, redirect, or return a new 402? How does the client detect staleness?',
    recommendation:
      'Include an `expiry_unix` field in the challenge. Client should check expiry before sending payment. Server must reject payments against an expired challenge with a 402 + fresh challenge, never a 200 or silent accept.',
  },
  {
    id: 'x402-003',
    branch: 'x402_protocol',
    text: 'What is your rate-limit edge case for rapid machine-to-machine retries on a 402 response? Can a client hammer your endpoint with unsigned payment attempts and cause DoS?',
    recommendation:
      'Apply IP/agent-ID rate limiting at the gateway layer before challenge issuance. A challenge should require a valid client token or a prior Karma proof. Return 429 + backoff hint, not 402, on rate-limit breach.',
  },
  // ERC-3009 / Permit2 Authorization
  {
    id: 'x402-004',
    branch: 'x402_erc3009',
    text: 'Are you using ERC-3009 TransferWithAuthorization or Permit2 for payment authorization? What is your replay-attack prevention — per-transaction nonce or permit signature expiry?',
    recommendation:
      'ERC-3009 nonces are simpler for single-asset flows. Permit2 is better for multi-asset atomic approvals. Nonce MUST be verified on-chain before the facilitator relays. Never trust the facilitator\'s nonce claim alone.',
  },
  {
    id: 'x402-005',
    branch: 'x402_erc3009',
    text: 'How do you handle an invalid or already-used cryptographic signature in the ERC-3009 authorization payload? What is the client error surface — HTTP status, body, retry behaviour?',
    recommendation:
      'On-chain verification reverts with "invalid-signature" or "auth-used". Map this to HTTP 402 (not 500) with a `reason: "invalid_signature"` body field. Client must not retry the same payload — issue a new authorization.',
  },
  {
    id: 'x402-006',
    branch: 'x402_erc3009',
    text: 'If the stablecoin contract (USDC, EURC) is paused or the user\'s address is blocklisted mid-authorization, how does your gateway surface that failure — and does it retry or escalate?',
    recommendation:
      'Catch the on-chain `Paused()` or `Blocklisted(address)` revert. Map to HTTP 402 with `reason: "token_blocked"`. Do NOT retry — escalate to the operator. Blocklisted users must resolve with Circle/issuer out-of-band.',
  },
  // Trust-minimized Facilitator
  {
    id: 'x402-007',
    branch: 'x402_facilitator',
    text: 'What is your threat model for the x402 facilitator? Can a malicious facilitator substitute the payment destination, inflate the amount, or drop a legitimate payment silently?',
    recommendation:
      'The facilitator must be trust-minimized: the challenge must commit to destination and amount via a hash the payer signs. The facilitator cannot alter a signed ERC-3009 authorization without invalidating the signature.',
  },
  {
    id: 'x402-008',
    branch: 'x402_facilitator',
    text: 'How do you handle third-party RPC failures when the facilitator is relaying the payment transaction? What is your timeout, fallback, and reconciliation strategy?',
    recommendation:
      'Use a deadline-aware relay with a 30s timeout. On timeout: mark payment as "pending" (not confirmed), respond to client with HTTP 202 + polling URL. Reconcile by re-querying tx hash against multiple RPC endpoints.',
  },
  {
    id: 'x402-009',
    branch: 'x402_facilitator',
    text: 'How does your MCP architecture integrate with the x402 facilitator? Does the MCP server hold a hot wallet, or does it only forward signed authorizations?',
    recommendation:
      'The MCP server should NEVER hold a hot wallet. It forwards signed ERC-3009 authorizations to a dedicated facilitator service. Separate the signing surface from the relay surface for minimal blast radius.',
  },
  {
    id: 'x402-010',
    branch: 'x402_facilitator',
    text: 'What is your audit trail strategy for every x402 payment: who paid, what amount, which challenge hash, which block number? Where is this stored and for how long?',
    recommendation:
      'Append-only JSONL log keyed by challenge hash + tx hash. Include: payer address, amount, token, chain_id, challenge_hash, tx_hash, block_number, confirmed_at. Retain ≥90 days. Export to immutable storage for compliance.',
  },
  {
    id: 'x402-011',
    branch: 'x402_protocol',
    text: 'How does your x402 gateway handle a double-spend race: two near-simultaneous payment submissions for the same challenge from different clients?',
    recommendation:
      'The ERC-3009 nonce is the on-chain idempotency key — only one tx can consume it. First confirmed wins. Your gateway must check nonce consumption before crediting. Return 409 to the loser with `reason: "nonce_consumed"`.',
  },
  {
    id: 'x402-012',
    branch: 'x402_protocol',
    text: 'What is your denomination precision strategy for stablecoin amounts in HTTP 402 headers? How do you prevent truncation or floating-point drift between the challenge and the on-chain amount?',
    recommendation:
      'Always represent amounts as integer strings in the smallest unit (e.g. USDC "1000000" for $1.00). Never use floats in the challenge JSON. Compare on-chain uint256 directly — reject if it does not equal the challenge integer exactly.',
  },
];

// ─── XLS-65 Vault Branch ─────────────────────────────────────────────────────
// Three sub-branches: MPT ownership, VaultCreate/Set/Deposit, Lending decoupling

export const XLS65_QUESTIONS: QuestionTemplate[] = [
  // MPT Ownership / XLS-33
  {
    id: 'xls65-001',
    branch: 'xls65_vault',
    text: 'When VaultDeposit fails mid-flight due to a third-party RPC timeout, how do you guard against partial MPT share issuance? Do you use a lock or two-phase commit?',
    recommendation:
      'XRPL VaultDeposit is atomic at the ledger level — a timeout means the tx never committed. Verify via `tx_result` ("tesSUCCESS") before updating off-chain state. Never credit shares based on off-chain state alone.',
  },
  {
    id: 'xls65-002',
    branch: 'xls65_vault',
    text: 'How do you represent fractional ownership shares in your XLS-65 vault? Are MPT amounts denominated in the underlying asset or in vault-specific share units?',
    recommendation:
      'Use vault-specific share units (MPT amount = vault shares, not underlying asset). Maintain a separate exchange-rate ledger. Prevents share-dilution attacks when the vault asset accrues yield.',
  },
  {
    id: 'xls65-003',
    branch: 'xls65_vault',
    text: 'What is your strategy for preventing MPT share manipulation if the vault\'s underlying asset price is updated while a VaultDeposit is in-flight?',
    recommendation:
      'Use a commit-reveal or block-number check: record the exchange rate at the time of the deposit tx\'s ledger sequence number, not at processing time. Reject deposits whose rate deviates >X% from the committed rate.',
  },
  // VaultCreate / VaultSet / VaultDeposit
  {
    id: 'xls65-004',
    branch: 'xls65_transactions',
    text: 'What validation protocol do you run after VaultCreate to confirm the vault\'s on-chain parameters (asset, max_amount, fee) match your off-chain schema before opening deposits?',
    recommendation:
      'After VaultCreate: read the vault object from the XRPL ledger via `account_objects`, compare all fields to your deployment manifest, and gate the "open for deposits" flag behind this check. Log mismatches as critical alerts.',
  },
  {
    id: 'xls65-005',
    branch: 'xls65_transactions',
    text: 'How does your VaultSet update strategy handle in-flight deposits during a fee or parameter change? Can a depositor get the old parameters applied to a deposit that lands after the VaultSet?',
    recommendation:
      'Use a two-ledger window: VaultSet schedules changes for `current_ledger + 2`. Any deposit with a `LastLedgerSequence ≤ current_ledger + 1` uses old params. Deposits landing in the new ledger use new params. Never apply retroactively.',
  },
  {
    id: 'xls65-006',
    branch: 'xls65_transactions',
    text: 'What is your VaultDeposit amount floor and ceiling validation? How do you prevent dust attacks (tiny deposits that bloat MPT state) or over-capacity deposits?',
    recommendation:
      'Set a minimum deposit of 1 XRP equivalent in the underlying asset. Enforce `max_deposit_per_tx` ≤ vault `max_amount`. Reject deposits that would push `total_deposited > max_amount`. Return a descriptive error, not a silent fail.',
  },
  {
    id: 'xls65-007',
    branch: 'xls65_transactions',
    text: 'How does your vault handle a VaultWithdraw when liquidity is temporarily locked in a downstream lending protocol? Do you queue, partially fill, or reject?',
    recommendation:
      'Queue the withdrawal request with a timestamp and notify the depositor. Partially fill up to available liquidity. Reject only when the queue is older than `max_withdrawal_delay` (configurable, default 48h). Never silently drop.',
  },
  // Lending decoupling
  {
    id: 'xls65-008',
    branch: 'xls65_lending',
    text: 'How is your XLS-65 vault\'s liquidity provision logic decoupled from the specific on-chain lending protocol it currently serves? Can you swap lending adapters without redeploying the vault?',
    recommendation:
      'Use the adapter pattern: the vault only knows about `deposit(amount)`, `withdraw(amount)`, `available_liquidity()` on an abstract LendingAdapter interface. The concrete adapter (Aave, Compound, XRPL-native) is injected at startup, not hardcoded.',
  },
  {
    id: 'xls65-009',
    branch: 'xls65_lending',
    text: 'What is your failure mode if the downstream lending protocol becomes insolvent or pauses withdrawals? How do you notify depositors and protect MPT share value?',
    recommendation:
      'Implement a circuit-breaker on the LendingAdapter: pause new deposits if `available_liquidity() < threshold`. Snapshot MPT share value at the pause point. Notify depositors via on-chain memo + off-chain alert. Do not allow new minting during the pause.',
  },
  {
    id: 'xls65-010',
    branch: 'xls65_lending',
    text: 'How do you price the exchange rate between MPT shares and the underlying asset when the lending protocol reports unrealised yield? Do you mark to market or amortise?',
    recommendation:
      'Amortise yield: update the exchange rate at fixed intervals (e.g. each epoch/ledger batch) rather than continuously. Prevents front-running on yield events. Publish the schedule so depositors can predict rate snapshots.',
  },
];

// ─── Generic security fallback ────────────────────────────────────────────────

export const GENERIC_QUESTIONS: QuestionTemplate[] = [
  {
    id: 'generic-001',
    branch: 'security',
    text: 'What is your threat model for this system? Who are the adversaries, what are the trust boundaries, and what is the blast radius of a full compromise of the most privileged component?',
    recommendation:
      'Write a one-page threat model before any implementation. Identify: external attackers, malicious insiders, compromised dependencies, and protocol-level adversaries. Quantify blast radius in USD and data records.',
  },
  {
    id: 'generic-002',
    branch: 'security',
    text: 'How does your system handle a dependency supply-chain attack (malicious npm/PyPI package)? What is your lockfile strategy and your incident response playbook?',
    recommendation:
      'Use lockfiles (package-lock.json, poetry.lock). Pin all transitive dependencies. Run `npm audit` in CI. Maintain a dependency inventory. Have a "hot-swap dependency" runbook ready for critical CVEs.',
  },
  {
    id: 'generic-003',
    branch: 'architecture',
    text: 'What is your data retention and deletion strategy? How do you comply with right-to-erasure requests for any personally identifiable information stored in your system?',
    recommendation:
      'Classify data by sensitivity at ingestion. Store PII in a separately keyed namespace with a TTL index. Deletion jobs run within 30 days of a verified erasure request. Audit trail of deletion events retained for compliance.',
  },
];

// ─── Domain registry ─────────────────────────────────────────────────────────

export const DOMAIN_QUESTIONS: Record<string, QuestionTemplate[]> = {
  x402: X402_QUESTIONS,
  xls65: XLS65_QUESTIONS,
  custom: GENERIC_QUESTIONS,
};

/** Load questions for a domain, initialising `resolved: false` on each. */
export function loadQuestionsForDomain(domain: string): GrillQuestion[] {
  const bank = DOMAIN_QUESTIONS[domain] ?? GENERIC_QUESTIONS;
  return bank.map((q) => ({ ...q, resolved: false }));
}
