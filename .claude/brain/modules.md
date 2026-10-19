# Modules
API dirs under `apps/api/src/modules/`, web dirs under `apps/web/src/app/features/`.

| ID | Module | API dir / web dir | Depends | SRS | Status |
|---|---|---|---|---|---|
| M-CORE | env, app, errors, health | `config/`,`middleware/`,`shared/`,`modules/health` | – | M0 | done |
| M-AUTH | register/login/refresh/logout (reset + email verify deferred) | `auth` / `auth`,`core` | M-CORE | AUTH-01 | done |
| M-BIZ | business profile, slug, onboarding, membership | `businesses` / `onboarding`,`business` | M-AUTH | BUS-01 | done (finish verified server-side) |
| M-FORM | questionnaire draft/publish/versions | `questionnaires` / `questionnaire` | M-BIZ | FORM-01 | done |
| M-QR | QR asset, public URL, scan events (`qr_events`) | `qr` / `qr` | M-BIZ, M-FORM | QR-01 | done |
| M-PUB | public form + submit | `public-forms` / `public-feedback` | M-FORM, M-RESP, M-CRM, M-CONSENT | PUB-01, REV-01 | done (M3) |
| M-CONSENT | consent events (grants only; withdrawal/suppression = M4) | `contacts` | M-BIZ | CONSENT-01 | capture done (M3) |
| M-CRM | contacts, matching (CSV export not yet) | `contacts` / `contacts` | M-BIZ | CRM-01, EXPORT-01 | list/detail done (M3) |
| M-RESP | responses (immutable snapshots) | `responses` / `responses` | M-FORM | RESP-01 | done (M3) |
| M-DASH | dashboard KPIs | `analytics` / `dashboard` | M-RESP, M-CRM, M-QR | DASH-01 | done (SMS cards = M4) |
| M-REWARD | complaint recovery: rules, incidents, rewards, redemption, audit | `rewards` / `rewards` | M-RESP, M-CRM, M-BIZ | (extension) | done (manual share only; provider delivery = M4) |
| M-SMS | review SMS, queue, webhooks, adapters | `messaging`,`jobs` / `automations` | M-CRM, M-CONSENT | SMS-01 | pending (M4) |
| M-CALL | missed-call responder | `calls` / `calls` | M-SMS | CALL-01 | pending (P1) |
| M-CAMP | campaigns | `messaging` / `campaigns` | M-SMS | CAM-01 | pending (P1) |
| M-BILL | subscription/trial | `billing` / `settings` | M-BIZ | BILL-01 | pending (P1) |
| M-AUDIT | audit_logs | `shared/audit` | M-BIZ | – | pending |

- M-ADMIN implemented: explicit platform authorization, separate admin data scope, audited moderation and safe inspection. Full map: [admin](admin.md).
