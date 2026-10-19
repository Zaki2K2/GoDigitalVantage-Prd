# Architecture
```
Browser(Angular) ──/api/v1──▶ Express app (apps/api/src/app.ts)
                               helmet · cors · json(100kb) · cookies
                               modules/* (routes→controller→service→model) ──▶ MongoDB (Mongoose)
                               errorHandler (Zod/AppError → envelope)
BullMQ worker (apps/api/src/jobs, M4) ◀── Redis ◀── messaging service ──▶ SMS adapter (mock → provider)
```
Chain per feature: **UI → Component → web Service → API route → controller → service → model → DB**.
- API module layout: `modules/<name>/{<name>.routes,controller,service,model,schemas}.ts` (add files only when needed).
- Shared: `config/env.ts` (zod-validated env), `shared/errors.ts` (AppError), `middleware/error-handler.ts`.
- Web layout: `core/` (auth, interceptors, guards), `shared/` (only truly repeated UI), `features/<name>/`.
- Dev: web proxies relative `/api` → 127.0.0.1:3100 (`apps/web/proxy.conf.json`). LAN mode binds Angular :4200 to `0.0.0.0`; phones access only the Angular origin. Local MongoDB stays on the computer; no external service is required for feedback collection. See [local development](../../docs/local-development.md).
- Module IDs: [modules.md](modules.md).

## Instant Rewards service boundary

Domain transition helpers -> Mongoose reward/event schemas -> InstantRewardsService (ownership, token/transport orchestration, revision CAS claims, outbox audit) -> thin Zod-validated routes. Injectable RewardMailer uses real Resend in production and an in-memory adapter only in tests. New recipient/admin permissions never bypass existing business membership middleware.

## Shared email provider (2026-10-19)

Shared modules/email owns templates, sender policy, gated Resend transport and generic delivery receipt model. Instant Rewards reuses it while retaining domain rules and hashed tokens. Both raw signed webhook aliases run before JSON/CSRF, then append generic events and reconcile reward lifecycle.

## Restricted email testing

Email transport has two explicit modes under the disabled-by-default master switch: verified custom-domain production, or account-email-only Resend onboarding testing. Both retain the same templates, provider idempotency, signed receipts and reward security.
