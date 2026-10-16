# GoDigitalVantage product and experience plan

Updated 16 October 2026. This plan is grounded in the existing Angular 20 / Express / MongoDB implementation. The repository contains no reference website/video analysis or source SRS PDF; `srs-summary.md` is the available requirements index. No visual or functional claims are attributed to an unavailable reference.

## Product intent

Help an owner publish a useful feedback form, put its QR code in front of customers, and understand real responses with minimal setup. Help customers finish on a phone without creating an account. Give staff actionable work only after assignment, permission, and response-delivery mechanisms exist.

The smallest valuable journey is: sign in → select a business → publish a questionnaire → download QR → anonymous customer submits → owner sees the stored response and actual totals. Keeping that journey reliable takes priority over adding more navigation destinations.

## What exists

| Capability | Current implementation | Boundary |
| --- | --- | --- |
| Authentication | Register, login, session restore, refresh rotation, logout, CSRF | Password reset and email verification are not implemented |
| Business setup | Four-step resumable wizard, owner profile edits, immutable public slug, membership authorization | Owner/member roles exist; staff invitation and location management do not |
| Questionnaires | One questionnaire per business; draft, live preview, publish, immutable versions; five question types | No survey collection, conditional branching, or response editing |
| QR and public feedback | Local PNG/SVG generation, download/print/link, anonymous published form, validation, idempotency, success state | Phone needs a reachable local server; no store-and-forward submission when that server is unreachable |
| Responses and contacts | Real paginated search/filter/detail views; anonymous responses; optional contact and consent capture | No outbound replies, assignments, incident workflow, or export |
| Dashboard | Real scans, responses, contacts, average rating, rating distribution, date-bucket trends, recent feedback | Google review metrics, benchmarks, and SMS delivery metrics are unavailable |
| Redesign work | Shared Bootstrap foundations, themes, business switcher, settings, accessible dashboard and public-form improvements | Current verification is recorded in `.claude/brain/progress.md`; this plan is not test evidence |

## Priorities

Effort is relative: small = existing API/UI extension; medium = new persistence or workflow; large = multiple services or authorization changes. These are implementation recommendations, not validated demand estimates.

| Priority | Audience and need | Practical feature | Value / effort | Dependency or acceptance boundary |
| --- | --- | --- | --- | --- |
| MVP | Owners: get a working collection point quickly | Refined onboarding, clear draft/published state, preview, stable printable QR | High / small | Existing versioning and server-verified onboarding retained |
| MVP | Customers: finish confidently on a phone | Anonymous mobile form, visible required fields, meaningful ratings, progress, useful errors, submission confirmation | High / small | All five existing question types; real API acknowledgment |
| MVP | Owners: know what changed | Real KPI cards, transparent Smile Score, rating distribution, trends with table alternative, searchable response details | High / small | Derive from existing aggregates; show empty states and denominators |
| MVP | Owners with several businesses: avoid mixing records | Explicit current-business selector with selection persisted per signed-in user | High / small | API membership checks remain authoritative; reload views on selection |
| MVP | Every user: navigate and read comfortably | Consistent responsive shell, keyboard access, light/dark/system appearance, loading/error/empty states | High / small | No external fonts, images, icons, or QR services at runtime |
| MVP | Local operators: collect feedback without internet | Configurable public LAN URL, relative API proxy, local database, QR decode/submission checks, phone instructions | High / small | App, API, MongoDB, and phone must communicate on the LAN |
| Important | Owners: recover account access | Password reset and email verification | High / medium | Token lifecycle, delivery provider, expiration and anti-abuse tests |
| Important | Owners: share useful evidence | Filtered CSV response/contact export | High / medium | Tenant checks, formula escaping, contact privacy, audit record |
| Important | Staff: act on low ratings without losing work | Invitations, explicit staff permissions, inbox with open/assigned/resolved status and internal notes | High / large | Membership management, assignment model, audit history; never modify original response snapshots |
| Important | Staff and owners: receive relevant alerts | Opt-in in-app notifications, then digest delivery and notification preferences | Medium / medium | Real event records, unread state, delivery status; no decorative notification badge |
| Important | Owners: make collection easier | Reusable questionnaire starter templates and optional local logo upload | Medium / medium | Copy into ordinary drafts; validate/upload safely; accessible fallback brand |
| Important | Multi-site owners: understand each location | Locations under one business with location-tagged QR codes and filters | High / large | Explicit location model, membership scope, attribution and migration plan |
| Important | Customers: communicate where needed | Consent-aware follow-up replies and a clear withdrawal path | High / large | Authenticated responder, messaging adapter/queue, delivery failures, suppression/STOP processing |
| Advanced | Owners: compare performance responsibly | Saved reports, scheduled summaries, meaningful period comparisons | Medium / large | Stable metric definitions, timezone handling, enough historical data |
| Advanced | Staff: triage a larger response volume | Suggested tags, summaries and draft replies with human review | Medium / large | Opt-in AI provider, privacy controls, evaluation, explicit cost and offline boundary |
| Advanced | Owners: benchmark fairly | Comparable segment benchmarks and goals | Conditional / large | Sufficient consented aggregate sample, cohort rules, privacy thresholds; never invented targets |
| Advanced | Growing businesses: automate outreach | SMS automation, missed-call recovery, campaigns, billing | Conditional / large | Redis/queue, provider webhooks, consent/suppression, service costs and audit trail |

## Cohesive experience

- **Foundation:** Bootstrap 5 and Bootstrap Icons with Angular standalone components. Retain useful existing utility classes during the redesign; use shared tokens for colors, spacing, radii, surfaces, and motion rather than mixing templates. Prefer native accessible controls over adding a component dependency without a need.
- **Visual language:** clear Outfit typography, quiet neutral surfaces, navy and emerald with restrained blue accents, soft elevation, and generous space. Use one strong page title, a short description, and a primary action. Data stays more prominent than decoration.
- **Navigation:** dashboard; responses and contacts; questionnaire, QR, business profile, settings. Keep the current business visible. Mobile navigation is a dismissible, keyboard-accessible drawer. Unavailable modules belong in a clearly marked roadmap/settings explanation.
- **Forms:** label every input, identify optional contact details, keep consent separate and unticked, show validation beside its field, preserve answers after errors, and prevent duplicate clicks while a request is pending. Publish and save are distinct actions.
- **States:** skeletons mirror real content; empty states explain the next useful action; errors offer a working retry where appropriate. Success means the backend acknowledged persistence. Honeypot handling remains an internal abuse defense.
- **Charts:** show actual data with units, time window, timezone, and accessible table/text alternatives. A period selector controls only the metrics it actually filters. A zero is a measured zero; an unavailable score is shown as unavailable.
- **Assets:** bundle fonts and Bootstrap icons locally, retain their licenses, and use purposeful original vector graphics where practical. Any stock image added must be downloaded, optimized, and accompanied by its source/license in the asset notice. No remote runtime imagery or decorative stock photos are required for data tables.
- **Accessibility and performance:** visible focus, logical heading order, labeled icon buttons, reduced-motion support, sufficient touch targets, responsive tables, lazy routes, and no essential information conveyed by color alone. Verify desktop and phone layouts in a browser.

## Data and trust rules

Smile Score is the percentage of rated responses scored 4 or 5 out of all rated responses, not a Google score or an industry benchmark. State the formula and sample size. Existing dashboard total cards and rating distribution are all-time; its trend window follows business timezone. Scan counts measure deduplicated visitor windows, not unique people or guaranteed camera scans. Do not label responses divided by scans as a conversion rate: visitors may open a direct link, and scan deduplication changes the denominator.

Every private request remains authorized by authenticated business membership. The selected business ID is a UI preference, never authorization. Contacts, responses, questionnaires, and analytics remain scoped by business. Public responses stay anonymous unless the customer supplies contact information, and a review link remains available regardless of rating.

## Verification and next milestone

Complete builds, TypeScript, lint, existing automated tests, real MongoDB submission tests, QR decoding, and browser journeys before marking the redesign verified. Test a second business and an unauthorized tenant ID. Exercise the phone-sized public form over HTTP LAN addressing because browser cryptographic/clipboard APIs behave differently outside secure contexts. Block external network requests during an end-to-end run while keeping LAN services available; this is distinct from turning off all networking.

Record exact results and limitations in [progress](../.claude/brain/progress.md), and local startup/phone instructions in `docs/local-development.md`. After the reliable MVP, prioritize account recovery, safe export, and staff membership/inbox design before AI, benchmarks, or campaigns.
