# Flows (module chains)
1. **Onboarding** (built through M-QR; finish is server-verified): register/login [M-AUTH] → business profile+slug [M-BIZ] → edit base questionnaire, publish v1 [M-FORM] → QR/public URL [M-QR] → dashboard checklist [M-DASH].
2. **Customer feedback** (built in M3 except SMS enqueue = M4): scan `/r/:slug` [M-QR scan event] → load published version [M-PUB→M-FORM] → submit with idempotency key → response snapshot [M-RESP] → contact upsert only if phone/email [M-CRM] → consent event [M-CONSENT] → optional review SMS enqueue [M-SMS] → thank-you + review link for everyone.
3. **Review SMS**: eligible (phone + consent + review URL) → persist sms_message pending → BullMQ → adapter → provider webhook updates status.
4. **Missed call (P1)**: signed voice webhook → dedupe providerCallId → eligibility/quiet hours/caps → SMS → status webhook.
5. **Export**: owner → tenant-checked streamed CSV (formula-guarded) → audit log.
