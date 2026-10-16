# GoDigitalVantage — Master Instructions

Multi-tenant SaaS: QR feedback → CRM → review SMS → missed-call recovery. Source of truth: the SRS PDF (condensed in [docs/srs-summary.md](docs/srs-summary.md)). Modular monolith: Angular 20 (`apps/web`) + Express/TS (`apps/api`) + MongoDB; Redis/BullMQ only for async SMS (M4+).

## Workflow (every task)

1. Read this file + only the relevant `.claude/brain/*` files (start with [change-impact](.claude/brain/change-impact.md), [progress](.claude/brain/progress.md)).
2. Locate the feature by module ID (`M-*`) → touch only linked files. Don't rescan the repo/PDF.
3. Smallest safe change; run test/typecheck/build in the affected app; never claim unverified results.
4. Update only affected brain entries + `progress.md` handoff.
5. Unclear requirement → log in [decisions](.claude/brain/decisions.md) or ask; don't invent rules.

## Brain index

[architecture](.claude/brain/architecture.md) · [modules](.claude/brain/modules.md) · [database](.claude/brain/database.md) · [api-map](.claude/brain/api-map.md) · [frontend-map](.claude/brain/frontend-map.md) · [flows](.claude/brain/flows.md) · [decisions](.claude/brain/decisions.md) · [progress](.claude/brain/progress.md) · [change-impact](.claude/brain/change-impact.md)

## Hard rules

- Tenant auth in backend on every private route (membership check on `businessId`; never trust a client id alone).
- Zod-validate all input; errors `{error:{code,message,details?}}`; lists `{data,pagination}`.
- Questionnaire versions immutable; responses snapshot labels; anonymous response ⇒ `contactId=null`.
- Consent separate from feedback; no review gating; mock SMS/voice adapters; never fake delivery.
- Auth: httpOnly cookies (access+refresh), CSRF header check; no tokens in localStorage.
- Node 22.19: Angular CLI pinned to v20; TS strict; no `any`.

## Commands

`npm run api:dev` (:3100) · `npm run web:dev` (:4200, proxies /api) · `npm run build` · `npm test`.
API env: `apps/api/.env` (see `.env.example`); dev Mongo `mongodb://localhost:27017/godigitalvantage`, tests use `gdv_test`.
Angular tests: `npm test -- --watch=false --browsers=ChromeHeadless` in `apps/web`.
