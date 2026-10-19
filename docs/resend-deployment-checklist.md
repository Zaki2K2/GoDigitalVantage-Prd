# Resend test-mode deployment readiness

## Verified locally

- 43 provider/reward tests passed; API typecheck and both production builds passed.
- EMAIL_ENABLED defaults false; EMAIL_TEST_MODE defaults false. Missing account/credentials/signing secret or wrong sender fails closed. Exact normalized recipient match only; aliases/multiple recipients are blocked before any Resend call, never redirected.
- Only onboarding@resend.dev is accepted in test mode. Production mode retains mail.godigitalvantage.com verification. Blocked reward email cannot grant sent/delivered/verification/claim state. Signed webhook, token expiry, ownership, claim CAS/idempotency and audit remain unchanged.

## Deployment checklist — pending approval

- [ ] Confirm the Vercel project owning `go-digital-vantage-api-roan.vercel.app`, root `apps/api`; repository frontend rewrite targets this host. Project ID, deployed commit and environment values require dashboard confirmation (no local Vercel project binding available).
- [ ] API settings: Other, Node 22.x, install `npm ci`, build `npm run build`, output `public`; existing api/index function and rewrites unchanged.
- [ ] Keep EMAIL_ENABLED=false during preparation. Set EMAIL_PROVIDER=resend, EMAIL_TEST_MODE=true, RESEND_TEST_EMAIL to the exact Resend account email, and RESEND_TEST_FROM_EMAIL to `GoDigitalVantage <onboarding@resend.dev>` only with approval.
- [ ] PUBLIC_APP_BASE_URL and CORS_ORIGIN: `https://go-digital-vantage-prd.vercel.app`. Preserve existing RESEND_API_KEY, RESEND_WEBHOOK_SECRET, INSTANT_REWARDS_TOKEN_SECRET, authentication and MongoDB secrets. Do not rotate or reveal them. RATE_LIMIT_STORE=mongo as existing production convention.
- [ ] After approval, deploy the reviewed API revision containing the test recipient gate and raw webhook registration. No deployment or settings changes were performed by this readiness review.
- [ ] Configure/confirm Resend endpoint `https://go-digital-vantage-api-roan.vercel.app/api/v1/webhooks/resend`; events email.delivered, email.failed, email.bounced, email.complained, email.suppressed. Verify raw bodies/Svix headers reach signature verification before browser CSRF. Do not disable CSRF globally.
- [ ] Verify direct and frontend-proxied /api/v1/health consistently return 200 with db=up. An unsigned empty webhook should be rejected by signature verification with 401 INVALID_WEBHOOK_SIGNATURE, not CSRF_INVALID. Confirm signing secret matches this endpoint without exposing it.
- [ ] Obtain explicit approval for restricted sending before EMAIL_ENABLED=true. Keep EMAIL_TEST_MODE=true throughout; customer addresses remain blocked. Restore EMAIL_ENABLED=false after testing, through the approved deployment/configuration process.

## Live observations (2026-10-19)

Frontend-proxied health returned 200, status ok, db up. Direct API health initially returned 503 twice, later 200 with db up; investigate stability before the test. The direct shared webhook returned 403 CSRF_INVALID to an unsigned empty JSON probe. This does not match this checkout's raw signature-verification handler; the deployed revision/routing is not confirmed ready. Do not weaken security or send a real email to diagnose it. No valid webhook event, actual email, deployment, settings or secrets were created/changed.

## Safe end-to-end plan — execute only after approval

1. Choose one active application account whose normalized email equals RESEND_TEST_EMAIL; use a separate browser session for that recipient and an authorized admin session. Use a harmless test-only title/code and short future expiration. Create exactly one DRAFT (sendImmediately=false), verificationRequired=true; record its ID and creation UUID without tokens.
2. Confirm fail-closed behavior using the automated negative tests (already passed); no real negative-recipient emails are necessary. Enable only restricted test sending through the approved configuration process.
3. Send the draft once with a stable request UUID. Expect the same reward ID, one accepted provider message, EMAIL_REQUESTED/EMAIL_SENT audit and SENT. Retry an uncertain send only with the same UUID; do not recreate the reward or rotate links automatically. Never infer delivery from acceptance.
4. Confirm a signed email.delivered receipt in email_delivery_events and EMAIL_DELIVERED/deliveredAt in reward history. Provider failures must remain visible, not reported as delivered. Delivery may arrive after verification/claim and must not regress those states.
5. Open the reward link from the account inbox and sign in as the matching recipient; no other account may view/claim it. Request the separate verification email, open it before its TTL, and expect VERIFIED with verifiedAt and VERIFICATION_COMPLETED. A used challenge must fail on replay. This full-verification test requires **two emails total: one Instant Reward email plus one verification email**. If approval covers exactly one email, stop before requesting verification and obtain approval for the second; do not silently turn off verification.
6. Claim once using one request UUID. Expect CLAIMED, claimedAt, one receipt, and exactly one REWARD_CLAIMED audit. Replaying the same actor/request UUID returns the same receipt; a new claim UUID returns REWARD_ALREADY_CLAIMED. The UI may suppress duplicate clicks; API idempotency checks must retain CSRF and the recipient session.
7. Check created/sent/delivered/verified/claimed timestamps and matching audit actions without logging email tokens, cookies or secrets. Signed receipt replays must not duplicate events. Expired/disabled/revoked/other-user rejection is covered by automated tests; do not issue additional real rewards/emails for those checks unless separately approved.
8. Restore EMAIL_ENABLED=false, retain test evidence and the claimed record/audit history. Production customer delivery remains prohibited until a separately approved verified-domain rollout.
