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

// ─── Insurance partner onboarding (Liventy BA→dev pipeline) ─────────────────
// Grounded in the real §1-§10 Confluence onboarding structure (General Setup,
// Product, Migration, Contract Import, Partner/Customer Portal, Claim Report &
// Flow, Fulfilment, Accounting & Reporting, Testing & GoLive Acceptance).

export const ONBOARDING_QUESTIONS: QuestionTemplate[] = [
  {
    id: 'onboarding-001',
    branch: 'general_setup',
    text: 'General Setup (§1) captures domains, login mode, and organization data through free-text/N-A table cells with no importer or validation UI. What confirms a filled-in field was actually applied to the partner config (e.g. IDP role scoping, portalId creation), rather than just recorded on the doc?',
    recommendation:
      'Treat the §1 table as a spec, not a source of truth for what shipped. Require the engineer who performs the manual DB-insert/Groovy-constant step to link back the applied config (migration/commit/DB row) on the page itself, so "Requirement Specified" status cannot silently drift from "Actually configured".',
  },
  {
    id: 'onboarding-002',
    branch: 'contract_import',
    text: 'Contract Import (§4) interface (CSV over SFTP vs API) is still being negotiated with the partner mid-onboarding, with format details (delimiter, BOM, ext-refs for market/product) unresolved. If the interface changes after Migration (§3) has already run once, what is the reconciliation/re-import story for records already loaded under the old assumption?',
    recommendation:
      'Do not run a production Migration/Contract Import pass until the interface contract (format + ext-ref mapping) is signed off in writing on the page, not just "clarifying with Miro". Treat the first import as a dry run against a disposable dataset until the contract is frozen.',
  },
  {
    id: 'onboarding-003',
    branch: 'claim_flow',
    text: 'Claim Report & Flow (§7) rejection-reason catalogs list ~20-30 manual rejection templates per product group, and most rows say "Please provide CMS keys... de/fr/it" — i.e. the translation keys are not yet created. What blocks go-live if an agent hits a rejection reason with no CMS translation deployed for the customer\'s language?',
    recommendation:
      'Do not let "the CMS key doesn\'t exist yet" surface as a runtime error to a claim agent or customer. Either gate go-live on 100% of listed rejection templates having live CMS keys in de/fr/it, or add an explicit fallback template (e.g. generic rejection notice) so an incomplete catalog degrades gracefully instead of failing silently.',
  },
  {
    id: 'onboarding-004',
    branch: 'claim_flow',
    text: 'The Coverage Confirmation checkbox default was just changed to unchecked as a "NEW Requirement" specifically for Lipo CH, changing whether a customer notification e-mail fires when an agent submits. Is this a per-tenant config flag or a global behavior change to the shared Coverage Confirmation function used by other partners?',
    recommendation:
      'If Coverage Confirmation is a shared component (used by other Licus partners beyond Lipo CH), this default MUST be tenant-scoped config, not a global code change - otherwise other partners silently stop sending confirmation e-mails. Verify blast radius before shipping; if it truly must be global, that is a cross-tenant regression risk requiring sign-off beyond this partner\'s onboarding.',
  },
  {
    id: 'onboarding-005',
    branch: 'fulfilment',
    text: 'The repair-partner routing table (§7.4.2.3) hardcodes real bank account/IBAN details per external repair partner (Elser.Swiss, Sertronics, De Longhi, Jura) directly in the onboarding doc. Where does this banking data actually get consumed downstream (banking-service payment file generation, manual AP entry, or elsewhere), and is the Confluence table itself the system of record or just a one-time input?',
    recommendation:
      'A Confluence table should never be the long-term system of record for payment routing/IBAN data used in production payouts. Confirm this gets loaded into a proper partner/vendor master (with the same access controls as tools-banking-service SEPA config) during onboarding, not left as a doc someone copy-pastes from at payout time.',
  },
  {
    id: 'onboarding-006',
    branch: 'testing_golive',
    text: 'Testing & GoLive Acceptance (§10) is a completely empty page (version 1, no content at all) while §1/§4/§7 are already at "Requirement Specified" and mid-negotiation. What is the actual go/no-go gate for Lipo CH\'s 2026-08-24 due date if no acceptance criteria have been written down anywhere?',
    recommendation:
      'Treat an empty §10 as a hard blocker, not a placeholder to fill in later - a due date without written acceptance criteria means "done" is whoever remembers to check, not a verifiable gate. At minimum, define: which of §1-§9 must be "Requirement Specified" -> "Implemented" -> "Verified" before go-live, and who signs off.',
  },
  {
    id: 'onboarding-007',
    branch: 'general_setup',
    text: 'Every onboarding artifact for this partner (org/product setup, claim-flow config, migration, contract import) is filled in by hand via a different manual mechanism (direct DB insert + Groovy constants for org/product, YAML for claim-flow rules, a Groovy subclass for claim-report rendering, CSV/SFTP still undecided for contract import) with no unified importer across any of them. For a Swiss partner with de/fr/it + BDX reporting requirements layered on top, where is a single engineer most likely to silently drop a required field because it lives in a 4th different mechanism than the other 3?',
    recommendation:
      'Build (or reuse) a single onboarding checklist that cross-references all 4 mechanisms\' required fields for this partner (languages, BDX scheme/treaty, CMS keys, repair-partner bank data) so nothing falls in the gap between "that is not my mechanism to fill in". Do not rely on tribal knowledge of which of the 4 places a given field lives.',
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
  onboarding: ONBOARDING_QUESTIONS,
};

/** Load questions for a domain, initialising `resolved: false` on each. */
export function loadQuestionsForDomain(domain: string): GrillQuestion[] {
  const bank = DOMAIN_QUESTIONS[domain] ?? GENERIC_QUESTIONS;
  return bank.map((q) => ({ ...q, resolved: false }));
}
