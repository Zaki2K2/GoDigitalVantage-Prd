# Frontend map (Angular standalone, `apps/web/src/app`)
Implemented: `App` root; `/api` proxied in dev (to 127.0.0.1:3100).
- `core/auth/`: `auth.service.ts` (in-memory signals, CSRF bootstrap, shared refresh), `auth.interceptor.ts` (401 → refresh once → replay), `auth.guard.ts` (`authGuard`, `guestGuard`); session restore via `provideAppInitializer` in `app.config.ts`; Angular XSRF config maps cookie `gdv_csrf` → header `X-CSRF-Token`.
- `core/business/business.service.ts` (`BusinessApi`, types). `features/onboarding/`: route-scoped `OnboardingStore` (server-persisted progress; step guards; `/onboarding` resumes saved step), wizard shell + `business-step`, `questionnaire-step`, `confirm-step`, `qr-step` (last two honest entry points). `features/business/`: shared `BusinessForm`, `/business` profile view/edit. 
- M2: `core/questionnaire/questionnaire.service.ts` (`QuestionnaireApi` incl. qr + anonymous `publicForm`); `features/questionnaire/` (`QuestionnaireBuilder` = FormArray editor + `QuestionEditor`, `question-form.ts` helpers, read-only `QuestionnaireFormView` used for preview + public page, `/questionnaire` page); `features/qr/` (`QrPanel`, `/qr`); `features/public/` (`/r/:slug`, anonymous, no session probe); `features/shell/` (nav shell) + `features/dashboard/`; `core/business/onboarded.guard.ts` gates the shell (fail-closed to `/onboarding`). Wizard steps 2 and 4 embed builder / QR panel; step 4 "Finish setup" calls the server.
- M3: `core/feedback/feedback.service.ts` (`FeedbackApi`: submit, scan, responses, response, contacts, contact, dashboard); `features/public/` is now the interactive form (signals state, client validation mirrors server, one idempotency key per page load, honeypot, consent unticked + disabled until a phone is typed, thank-you + review link for any rating); `features/responses/` (`ResponsesPage`: search/filters/pagination/detail; spec `crm-pages.spec.ts` also covers contacts + dashboard), `features/contacts/` (`ContactsPage`), `features/dashboard/` (real stats, CSS trend bars, recent feedback, Google note). Shell nav + routes `/responses`, `/contacts`. `QuestionnaireFormView` is now preview-only. Shared list styles live in `styles.scss`.
- `features/auth/`: `/login`, `/register` (lazy). `/` is the implemented `features/dashboard/` page behind `authGuard` and `onboardedGuard`.

Planned routes (SRS §7) → feature dir → API module:
- `/onboarding/{business,questionnaire,confirm}` → onboarding → M-BIZ, M-FORM
- `/app/business` → business → M-BIZ
- `/app/questionnaire` → questionnaire → M-FORM
- `/app/qr` → qr → M-QR
- `/app/contacts[/:id]` → contacts → M-CRM
- `/app/responses[/:id]` → responses → M-RESP
- `/app/automations` → automations → M-SMS
- `/app/settings` → settings → M-AUTH, M-BILL
- `/r/:slug` (public) → public-feedback → M-PUB

Guards (UX only) live in `core/`; backend enforces authz.

Styling: design tokens (`--c-*`, `--radius`, `--shadow-*`) + shared classes (`.btn`, `.card`, `.field`, `.toolbar`, `.list-row`, `.skeleton`) live in `src/styles.scss`; component scss must not reuse these global class names with different meaning.

## Current UI architecture (2026-10-16; supersedes older style/route notes above)

- Actual routes: `/login`, `/register`, `/onboarding/{business,questionnaire,confirm,qr}`, `/`, `/responses`, `/contacts`, `/questionnaire`, `/qr`, `/business`, `/settings`, and anonymous `/r/:slug`. There is no `/app` route prefix, and there are no incident, notification, AI, or location screens pretending to be implemented.
- `src/bootstrap.scss` imports only needed Bootstrap 5 Sass foundations; `src/styles.css` holds shared components, responsive utilities, theme tokens, skeletons, and motion. Existing TailAdmin-derived utility/layout styling predates this pass and is retained; no new template import. The Angular build serves both styles locally. `shared/icon.ts` renders the local Bootstrap Icons sprite; Outfit is bundled through `@fontsource-variable/outfit`.
- `shared/theme.service.ts` persists light/dark/system preference and responds to system color-scheme changes, updating both `.dark` and `data-bs-theme`. `features/settings/settings.page.ts` implements appearance, actual account details, business-profile navigation, and clearly marked planned modules.
- `features/shell/` provides sidebar/header navigation, current-business context, theme control, account menu, and mobile drawer. `BusinessApi.select/list` stores the selected ID under a per-user browser preference and orders authorized API results accordingly. Selection is never an authorization mechanism; the backend still enforces membership on every private business endpoint.
- `shared/request-id.ts` generates UUID-formatted random IDs with `crypto.getRandomValues`, which is available on HTTP LAN origins where `crypto.randomUUID` may be unavailable. Used by business creation, question/choice IDs, and public submission idempotency.
- Dashboard uses real `FeedbackApi` totals/distribution/trends. Smile Score is the all-time percentage of rated responses with 4 or 5 stars, with sample size and empty state. Date filters affect the activity window; all-time cards remain labeled accordingly. Chart values have a table alternative.
- Locally bundled assets and license notes: `public/assets/`. Product priorities: `docs/product-plan.md`. LAN startup/phone testing: `docs/local-development.md`.

- M-REWARD: `core/rewards/rewards.service.ts` (`RewardsApi`, types, `discountLabel`); `shared/reward-card.ts` (customer coupon card, also on the thank-you page); `features/public/reward-link.page.ts` (`/reward/:token`, anonymous); `features/rewards/` routed under `/rewards`: `rewards.page` (tabs) -> `rewards-overview`, `rewards-issued` (list + drawer: approve/reject/cancel/share), `rewards-incidents` (complaints, issue/resolve), `rewards-redeem` (verify + redeem, one requestId per verified code), `rewards-rules` (templates, create/edit/enable). Shell nav item "Rewards". Icons `gift`, `ticket`, `send` were appended to `public/assets/bootstrap-icons.svg` + `IconName`.

## Platform administration
`/admin/:section[/:id]` is guarded independently of onboarding and reuses AppShell with admin navigation. Supported: dashboard/businesses/users/forms/responses/contacts/promotions/activity/system/search. Shared RecordDetails, existing BusinessForm, QuestionnaireFormView and DialogFocus. No parallel design system. See [admin](admin.md).

- Admin user list/detail now exposes Block/Unblock and Revoke Sessions, with platform-role control on detail. Members and memberships tabs expose role/status/removal through each row businessId. Shared confirmations, notifications and styles are reused.

- Admin dashboard presentation is extracted to features/admin/admin-dashboard.ts/html, receiving metrics and averageRating from AdminPage. It groups real platform data without new endpoints or mock charts; admin lists, permissions and normal business dashboard remain unchanged.

## Instant Rewards

`features/instant-rewards`: shared typed API, reward details/timeline, admin list/filter/summary/create/edit/confirm/audit screens; My Rewards; scrubbed-token landing with inline existing LoginPage. Routes: `/admin/instant-rewards`, delegated `/rewards-admin`, personal `/my-rewards`, public landing `/instant-reward`. Personal routes skip business onboarding/data queries. Existing AppShell, CSS controls/cards/tables, Icon and DialogFocus reused. Backend allowedActions drives controls. Super Admin user details can toggle the permission with existing confirmation flow.

## Campaign Management Engine

M-CAMP: `/campaigns` and `/admin/campaigns` share CampaignsPage, CampaignApi and the five-step modal builder using existing shell/styles. ContactCampaignProfile is embedded in the existing Contacts drawer. See [campaigns](campaigns.md).


## Shared dropdown system (2026-10-20)

All 28 feature selects and BusinessForm's two editable datalists use AppSelect (`shared/app-select.ts`) and one OnPush SelectControl renderer/CVA. Native form accessors, values, validation and original events are preserved. Admin/Campaign/account action menus use shared ActionMenu; DropdownPanel uses the native top layer with viewport clamping, upward placement and logical modal ancestry. Appearance lives in `src/dropdowns.css` using existing tokens. Public answer choices, Settings cards, chart/config disclosures and authorized paginated CampaignPicker are intentionally retained. Architecture, API, examples, audit and testing: [dropdowns](dropdowns.md).
