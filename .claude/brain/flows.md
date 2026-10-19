# Flows (module chains)
1. **Onboarding** (built through M-QR; finish is server-verified): register/login [M-AUTH] → business profile+slug [M-BIZ] → edit base questionnaire, publish v1 [M-FORM] → QR/public URL [M-QR] → dashboard checklist [M-DASH].
2. **Customer feedback** (built in M3 except SMS enqueue = M4): scan `/r/:slug` [M-QR scan event] → load published version [M-PUB→M-FORM] → submit with idempotency key → response snapshot [M-RESP] → contact upsert only if phone/email [M-CRM] → consent event [M-CONSENT] → optional review SMS enqueue [M-SMS] → thank-you + review link for everyone.
3. **Review SMS**: eligible (phone + consent + review URL) → persist sms_message pending → BullMQ → adapter → provider webhook updates status.
4. **Missed call (P1)**: signed voice webhook → dedupe providerCallId → eligibility/quiet hours/caps → SMS → status webhook.
5. **Export**: owner → tenant-checked streamed CSV (formula-guarded) → audit log.

## Instant Rewards lifecycle

Admin -> Create (idempotency UUID) -> Email (Resend idempotency; SENT after provider acceptance) -> authenticated recipient opens scrubbed fragment link -> separate emailed Recipient Verification when required -> atomic Claim + receipt -> Audit. Authentic Resend receipt can add DELIVERED; existing proof/claimed/disabled/expired/revoked statuses never regress. DISABLED restores saved state only while valid; REVOKED is permanent; CLAIMED cannot be cancelled. Server expiry is enforced independently of lazy status synchronization. A later-registered matching account can bind an unbound reward after email proof. Existing business recovery rewards are separate.

## Shared email provider (2026-10-19)

Template + stable operation ID -> disabled/configuration/domain verification gates -> Resend acceptance -> signed receipt ledger -> reward lifecycle reconciliation. Early receipts replay after acceptance is persisted. Claim atomicity and email proof/expiry are unchanged.
