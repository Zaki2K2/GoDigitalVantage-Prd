# GoDigitalVantage

A multi-tenant SaaS platform that helps local businesses turn customer feedback into repeat business and public reviews. A customer scans a QR code, gives feedback, and flows into a CRM. The platform then follows up with review requests and recovers missed calls.

## Features

- **QR feedback collection:** Each business gets QR-linked questionnaires. Versions are immutable, responses snapshot question labels, and anonymous responses have no linked contact.
- **CRM:** Contacts, individual responses and rewards are kept per business. Consent is recorded separately from feedback.
- **Review requests:** Customers are asked for a public review by SMS. There is no review gating.
- **Missed-call recovery:** Missed calls trigger an automated text-back.
- **Follow-up and campaigns:**
  - WhatsApp follow-up is owner-triggered, needs separate explicit consent, and honours STOP across businesses.
  - Marketing email campaigns need owner approval and use signed unsubscribe links.
  - Instant reward emails go to customers after feedback.
- **Privacy-first administration:** Super Admins cannot read tenant customer data by default. Access needs an owner-approved, time-limited support grant and is written to an append-only log.

## Architecture

A modular monolith.

| Layer | Technology |
|---|---|
| Web app | Angular 20 (`apps/web`) |
| API | Express + TypeScript (`apps/api`), Zod-validated input |
| Database | MongoDB |
| Async SMS (planned) | Redis + BullMQ |
| Email | Resend |
| Deployment | Vercel (separate API and web projects) |

SMS and voice use mock adapters, and delivery is never faked.

## Security principles

- Every private route checks tenant membership on the backend.
- Auth uses httpOnly access and refresh cookies with a CSRF header check. No tokens are stored in localStorage.
- Startup validates configuration and rejects placeholder, weak or reused secrets.
- Tests run against an isolated loopback MongoDB with external network calls denied.
- TypeScript is strict, with no `any`.

## Getting started

Requires Node 22.x and MongoDB.

```
cp apps/api/.env.example apps/api/.env   # then set independent random JWT secrets
npm run api:dev     # API on :3100
npm run web:dev     # Angular on :4200, proxies /api
npm run build
npm test
```

Generate each secret with:

```
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

## Documentation

- [Local development](docs/local-development.md)
- [Vercel deployment](docs/deployment-vercel.md)
- [Email (Resend)](docs/email-resend.md)
- [Requirements summary](docs/srs-summary.md)
- [Security hardening audit](docs/security/hardening-audit-2026-10-30.md)
