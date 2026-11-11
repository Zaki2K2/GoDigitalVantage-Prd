# Graph Report - GoDigitalVantage-Prd  (2026-11-11)

## Corpus Check
- 302 files · ~181,021 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 20 file(s) not represented in the graph (top: (none) 11, .scss 3, .css 3)

## Summary
- 2210 nodes · 5713 edges · 114 communities (84 shown, 30 thin omitted)
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 95 edges (avg confidence: 0.83)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- Email Delivery (Resend)
- Campaign Audience & Indexes
- Admin Models & Support Grants
- Business Service & Onboarding
- Questionnaire Service
- QR & Instant Rewards UI
- Feedback Service & Dashboard API
- Rewards Service (Web)
- Support Access UI
- App Core & CSRF
- Reward Service (API)
- Campaign Templates UI
- Login Page
- Auth Interceptor & Service
- Admin Page
- Select Control
- Follow-up Model
- Support Access Authorization
- Routes & Guards
- Rewards API Client
- Contact & Consent
- Web Tooling Config
- Dashboard & Consent Events
- Env & Passwords
- Admin Actions & Locks
- Reward Model & Incidents
- API Tooling Config
- Auth Schemas
- Campaign API Client
- Require-Auth & Auth Routes
- Public Form
- Questionnaire Model
- Admin Dashboard
- DB & WhatsApp Mock
- Business Permissions
- Admin & Reward Schemas
- Admin Service
- Image Model & Routes
- Reward Routes & Schemas
- CI Workflow
- Community 40
- Community 41
- Community 42
- Community 43
- Community 44
- Community 45
- Community 46
- Community 47
- Community 48
- Community 49
- Community 50
- Community 51
- Community 52
- Community 53
- Community 54
- Community 55
- Community 56
- Community 57
- Community 58
- Community 59
- Community 60
- Community 61
- Community 62
- Community 63
- Community 64
- Community 65
- Community 66
- Community 67
- Community 68
- Community 69
- Community 70
- Community 71
- Community 72
- Community 73
- Community 74
- Community 75
- Community 76
- Community 77
- Community 78
- Community 79
- Community 80
- Community 81
- Community 82
- Community 83
- Community 84
- Community 85
- Community 86
- Community 87
- Community 88
- Community 89
- Community 90
- Community 91
- Community 92
- Community 93
- Community 94
- Community 95
- Community 96
- Community 97
- Community 98
- Community 99
- Community 100
- Community 101
- Community 102
- Community 103
- Community 104
- Community 105
- Community 106
- Community 107
- Community 108
- Community 109
- Community 110
- Community 111
- Community 112

## God Nodes (most connected - your core abstractions)
1. `apiErrorMessage()` - 115 edges
2. `@angular/core` - 94 edges
3. `AppError` - 85 edges
4. `mongoose` - 65 edges
5. `@angular/common` - 55 edges
6. `notFound()` - 51 edges
7. `createApp()` - 48 edges
8. `@angular/router` - 41 edges
9. `CampaignsPage` - 39 edges
10. `AuthService` - 38 edges

## Surprising Connections (you probably didn't know these)
- `Privacy-first Super Admin (default-deny customer data)` --semantically_similar_to--> `Consent model (separate from feedback, explicit grants only)`  [INFERRED] [semantically similar]
  .claude/brain/admin.md → .claude/brain/decisions.md
- `GoDigitalVantage Master Instructions` --references--> `API map (/api/v1)`  [EXTRACTED]
  CLAUDE.md → .claude/brain/api-map.md
- `GoDigitalVantage Master Instructions` --references--> `Database collections (MongoDB/Mongoose)`  [EXTRACTED]
  CLAUDE.md → .claude/brain/database.md
- `GoDigitalVantage Master Instructions` --references--> `Decisions log`  [EXTRACTED]
  CLAUDE.md → .claude/brain/decisions.md
- `GoDigitalVantage Master Instructions` --references--> `Module flows`  [EXTRACTED]
  CLAUDE.md → .claude/brain/flows.md

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Default-deny customer data with owner-approved support access** — claude_brain_admin_privacy_first_super_admin, claude_brain_admin_support_grants, claude_brain_admin_reauth, claude_brain_admin_owner_approval [EXTRACTED 0.95]
- **Shared dropdown/menu component system** — claude_brain_dropdowns_app_select, claude_brain_dropdowns_action_menu, claude_brain_dropdowns_dropdown_panel [EXTRACTED 0.95]
- **Campaign engine core: collections, worker, scheduler, locks** — claude_brain_campaigns_collections, claude_brain_campaigns_execution_worker, claude_brain_campaigns_cron_scheduler, claude_brain_campaigns_no_ttl_locks [EXTRACTED 0.95]
- **Resend sending readiness chain** — docs_email_resend_sending_domain, docs_dns_handover_resend_dns_records, docs_specs_email_provider_webhook_verify, docs_email_resend_email_enabled [INFERRED 0.85]
- **Admin audit, locking and session revocation controls** — docs_admin_panel_admin_audit, docs_admin_panel_admin_mutation_locks, docs_admin_panel_session_version, docs_admin_panel_last_owner_protection [EXTRACTED 0.85]
- **Campaign send safety controls** — docs_campaign_production_marketing_consent, docs_campaign_production_retry_policy, docs_campaign_production_campaign_locks, docs_campaign_production_unsubscribe_flow [EXTRACTED 0.85]

## Communities (114 total, 30 thin omitted)

### Community 0 - "Email Delivery (Resend)"
Cohesion: 0.06
Nodes (57): createResendMailer(), deliverResendEmail(), domains, EmailMessage, emailSender(), fail(), SENDING_DOMAIN, sendResendEmail() (+49 more)

### Community 1 - "Campaign Audience & Indexes"
Cohesion: 0.08
Nodes (66): main(), main(), audienceFilter(), estimateAudience(), interactionEligible(), AUDIENCES, CAMPAIGN_STATUSES, CAMPAIGN_TEMPLATES (+58 more)

### Community 2 - "Admin Models & Support Grants"
Cohesion: 0.06
Nodes (47): AdminAudit, schema, AdminReauth, SupportGrant, RefreshToken, refreshTokenSchema, User, USER_STATUSES (+39 more)

### Community 3 - "Business Service & Onboarding"
Cohesion: 0.06
Nodes (18): Business, BusinessInput, ListEntry, Onboarding, ONBOARDING_STEPS, OnboardingStep, BusinessForm, CATEGORIES (+10 more)

### Community 4 - "Questionnaire Service"
Cohesion: 0.07
Nodes (23): AnswerView, Choice, isChoiceType(), PublishIssue, Question, QUESTION_TYPE_LABELS, QUESTION_TYPES, QuestionnaireApi (+15 more)

### Community 5 - "QR & Instant Rewards UI"
Cohesion: 0.08
Nodes (25): RewardSummary, RewardForm, FILTERS, REASON, TEXT, TONE, PAD, RewardsPage (+17 more)

### Community 6 - "Feedback Service & Dashboard API"
Cohesion: 0.06
Nodes (19): ContactBrief, ContactDetail, ContactItem, Dashboard, FeedbackApi, ResponseDetail, ResponseItem, Submission (+11 more)

### Community 7 - "Rewards Service (Web)"
Cohesion: 0.07
Nodes (21): ContactBrief, CustomerReward, Discount, discountLabel(), DiscountType, IncidentStatus, RewardDetail, RewardRule (+13 more)

### Community 8 - "Support Access UI"
Cohesion: 0.06
Nodes (10): apiErrorMessage(), SupportAccess, RegisterPage, InstantRewardLandingPage, QrPage, QuestionnairePage, RewardsRedeemPage, Avatar (+2 more)

### Community 9 - "App Core & CSRF"
Cohesion: 0.11
Nodes (32): createApp(), csrfProtection(), equal(), SAFE_METHODS, errorHandler(), notFoundHandler(), MembershipLookup, requireBusinessAccess() (+24 more)

### Community 10 - "Reward Service (API)"
Cohesion: 0.11
Nodes (43): lastDays(), approveReward(), audit(), Brief, briefs(), byCode(), cancelReward(), createRule() (+35 more)

### Community 11 - "Campaign Templates UI"
Cohesion: 0.09
Nodes (4): Campaign, CampaignTemplate, GlobalTemplate, CampaignsPage

### Community 12 - "Login Page"
Cohesion: 0.08
Nodes (9): LoginPage, InstantRewardDetails, InstantReward, InstantRewardsApi, RewardHistory, RewardPage, list, reward (+1 more)

### Community 13 - "Auth Interceptor & Service"
Cohesion: 0.10
Nodes (14): authInterceptor(), AuthUser, CSRF_COOKIE_NAME, RegisterPayload, UserResponse, ok, setup(), USER (+6 more)

### Community 16 - "Follow-up Model"
Cohesion: 0.12
Nodes (31): FollowUp, FOLLOWUP_CHANNELS, FOLLOWUP_STATUSES, FollowUpChannel, FollowUpDoc, followUpSchema, FollowUpStatus, createFollowUpRouter() (+23 more)

### Community 17 - "Support Access Authorization"
Cohesion: 0.12
Nodes (29): authorizeBusinessWrite(), authorizeGrant(), effectiveStatus(), GrantLike, hasRecentReauth(), HIGH_RISK_SCOPES, isLive(), logAccess() (+21 more)

### Community 18 - "Routes & Guards"
Cohesion: 0.13
Nodes (12): routes, adminGuard(), authGuard(), businessUserGuard(), guestGuard(), instantRewardAdminGuard(), AuthService, onboardedGuard() (+4 more)

### Community 19 - "Rewards API Client"
Cohesion: 0.07
Nodes (3): Incident, RewardsApi, RewardsIncidentsPage

### Community 20 - "Contact & Consent"
Cohesion: 0.15
Nodes (28): ConsentPurpose, CONSENT_WORDING_VERSION, consentWording(), contactDto(), ContactInput, createContact(), createContactBody, getContact() (+20 more)

### Community 21 - "Web Tooling Config"
Cohesion: 0.08
Nodes (31): devDependencies, angular-eslint@^22.6.0, eslint@^10.12.0, eslint-config-prettier@^10.1.8, @eslint/js@^10.0.1, globals@^17.13.0, prettier@^3.9.10, typescript@~5.9.2 (+23 more)

### Community 22 - "Dashboard & Consent Events"
Cohesion: 0.10
Nodes (27): DayCount, CONSENT_PURPOSES, ConsentEvent, ConsentEventDoc, consentSchema, Contact, ContactDoc, contactSchema (+19 more)

### Community 23 - "Env & Passwords"
Cohesion: 0.09
Nodes (18): env, EnvError, parsed, derive(), hashPassword(), OPTIONS, CampaignSchedulerState, app (+10 more)

### Community 24 - "Admin Actions & Locks"
Cohesion: 0.16
Nodes (27): AdminMutationLock, businessState(), emergencyAccess(), instantRewardAccess(), lockSchema, membershipAction(), mutate(), Mutation (+19 more)

### Community 25 - "Reward Model & Incidents"
Cohesion: 0.08
Nodes (28): auditSchema, DiscountType, Incident, IncidentDoc, incidentSchema, IncidentStatus, orderSchema, quotaSchema (+20 more)

### Community 26 - "API Tooling Config"
Cohesion: 0.10
Nodes (26): devDependencies, supertest@^7.3.1, tsx@^4.23.15, @types/cookie-parser@^1.4.10, @types/cors@^2.8.19, @types/express@^5.0.6, @types/jsonwebtoken@^9.0.10, @types/node@^26.6.5 (+18 more)

### Community 27 - "Auth Schemas"
Cohesion: 0.15
Nodes (25): email, LoginInput, loginSchema, RegisterInput, registerSchema, getActiveUser(), isBenignRace(), isBenignRaceById() (+17 more)

### Community 28 - "Campaign API Client"
Cohesion: 0.13
Nodes (13): Page, Pagination, blankCampaign(), CAMPAIGN_AUDIENCES, CAMPAIGN_STATUSES, CAMPAIGN_TRIGGERS, CampaignConfig, CampaignDetail (+5 more)

### Community 29 - "Require-Auth & Auth Routes"
Cohesion: 0.16
Nodes (21): Express, Request, requireAuth(), createAuthRouter(), refreshCookie(), ACCESS_COOKIE, base, clearAuthCookies() (+13 more)

### Community 30 - "Public Form"
Cohesion: 0.12
Nodes (4): PublicForm, phoneLooksValid(), PublicFormPage, FORM

### Community 31 - "Questionnaire Model"
Cohesion: 0.09
Nodes (22): CHOICE_TYPES, ChoiceData, choiceSchema, ContentData, contentFields, QUESTION_TYPES, QuestionData, QuestionnaireDoc (+14 more)

### Community 32 - "Admin Dashboard"
Cohesion: 0.11
Nodes (9): AdminResult, AdminDashboard, MetricLink, PlatformMetric, COLUMNS, PendingAction, RESTRICTED, SECTIONS (+1 more)

### Community 33 - "DB & WhatsApp Mock"
Cohesion: 0.15
Nodes (13): connectDb(), globals, observeCommands(), observed, audit(), main(), main(), PerfContext (+5 more)

### Community 34 - "Business Permissions"
Cohesion: 0.19
Nodes (17): assertBusinessPermission(), BUSINESS_PERMISSIONS, BusinessPermission, ROLE_PERMISSIONS, dashboardQuery, getDashboard(), createCrmRouter(), answer (+9 more)

### Community 35 - "Admin & Reward Schemas"
Cohesion: 0.19
Nodes (16): idSchema, listSchema, adminActionSchema, claimBody, createInstantRewardSchema, editInstantRewardSchema, email, fields (+8 more)

### Community 36 - "Admin Service"
Cohesion: 0.16
Nodes (20): ListQuery, detail(), GrantContext, isRestricted(), list(), memberships(), PLATFORM_RESOURCES, PlatformResource (+12 more)

### Community 37 - "Image Model & Routes"
Cohesion: 0.18
Nodes (18): IMAGE_OWNER_TYPES, ImageOwnerType, imageSchema, ProfileImage, createImageRouter(), createPublicImageRouter(), rawImage, send() (+10 more)

### Community 38 - "Reward Routes & Schemas"
Cohesion: 0.15
Nodes (17): DISCOUNT_TYPES, INCIDENT_STATUSES, RULE_MODES, codeSchema, createRuleSchema, decisionSchema, deliverSchema, issueSchema (+9 more)

### Community 39 - "CI Workflow"
Cohesion: 0.10
Nodes (19): jobs, validate, image, options, ports, name, on, permissions (+11 more)

### Community 40 - "Community 40"
Cohesion: 0.12
Nodes (16): ONBOARDING_STEPS, createBusinessRouter(), businessIdParam, CreateBusinessInput, createBusinessSchema, email, httpsUrl, phone (+8 more)

### Community 41 - "Community 41"
Cohesion: 0.22
Nodes (16): imageUrl(), publishIssues(), Content, defaultDraft(), ensureQuestionnaire(), getQuestionnaire(), getVersion(), isDuplicateKey() (+8 more)

### Community 42 - "Community 42"
Cohesion: 0.11
Nodes (18): dependencies, @angular/common@^20.3.0, @angular/compiler@^20.3.0, @angular/core@^20.3.0, @angular/forms@^20.3.0, @angular/platform-browser@^20.3.0, @angular/router@^20.3.0, bootstrap@^5.3.8 (+10 more)

### Community 43 - "Community 43"
Cohesion: 0.19
Nodes (18): Resend DNS handover, Cloudflare authoritative zone, Resend DNS records (DKIM, rsend, send), Resend email configuration runbook, email_delivery_events receipts, EMAIL_ENABLED master switch, Idempotency key and 20-hour retry contract, EMAIL_NOT_CONFIGURED troubleshooting (+10 more)

### Community 44 - "Community 44"
Cohesion: 0.19
Nodes (8): express-rate-limit@^8.7.1, Hit, HitDoc, hitSchema, isDup(), MongoRateLimitStore, store(), express-rate-limit

### Community 46 - "Community 46"
Cohesion: 0.23
Nodes (10): main(), main(), evaluateAuditPrivileges(), FORBIDDEN_ON_AUDIT, monthsAgo(), planSupportRetention(), Privilege, purgeNeverActivatedGrants() (+2 more)

### Community 48 - "Community 48"
Cohesion: 0.14
Nodes (16): Dev/Preview credential separation (RESEND_DEV_*), Local development and phone QR testing, LAN phone QR testing, Offline LAN operation (not PWA), Safe environment setup / security:audit-env, gdv_test loopback-only test database, Security and reliability audit 2026-10-30, security:audit-env names-only audit (+8 more)

### Community 49 - "Community 49"
Cohesion: 0.13
Nodes (16): Vercel performance investigation, connectDb stale-promise fix, Health endpoint 503 analysis, Immutable caching for hashed JS/CSS, Parallel membership and business reads, PERFORMANCE_LOGGING api_performance logs, Function region and Fluid Compute verification, Full-system audit 2026-10-19 (+8 more)

### Community 50 - "Community 50"
Cohesion: 0.13
Nodes (15): devDependencies, @angular/build@^20.3.40, @angular/cli@^20.3.40, jasmine-core@~5.9.0, karma-chrome-launcher@~3.2.0, karma-coverage@~2.2.0, @tailwindcss/postcss@^4.3.3, @types/jasmine@~5.1.0 (+7 more)

### Community 51 - "Community 51"
Cohesion: 0.16
Nodes (8): dotenv@^18.0.8, configurations, paths, envSchema, publicBaseUrl, sender, required, dotenv

### Community 52 - "Community 52"
Cohesion: 0.14
Nodes (13): compilerOptions, esModuleInterop, module, moduleResolution, noImplicitOverride, noUncheckedIndexedAccess, outDir, resolveJsonModule (+5 more)

### Community 53 - "Community 53"
Cohesion: 0.15
Nodes (12): Angular CLI 20.3.40, Web README (Angular CLI boilerplate), Architecture overview, Runtime and environment safety hardening, Decisions log, CSV export flow, Module flows, M-CORE (+4 more)

### Community 54 - "Community 54"
Cohesion: 0.15
Nodes (13): dependencies, cookie-parser@^1.4.7, cors@^2.8.6, express@^5.3.0, helmet@^8.3.0, jsonwebtoken@^9.0.3, mongoose@^9.11.2, qrcode@^1.5.4 (+5 more)

### Community 55 - "Community 55"
Cohesion: 0.15
Nodes (13): scripts, admin:grant, build, campaigns:audit-legacy, campaigns:indexes, dev, security:audit-env, security:check-audit-permissions (+5 more)

### Community 57 - "Community 57"
Cohesion: 0.23
Nodes (13): Campaign production setup and recovery, API Vercel project config, Campaign and offers:businessId locks, CRON_SECRET bearer auth, Redemption rate vs conversion rate semantics, Super Admin campaign monitoring, offerPolicy exclusive/parallel, Resend webhook /api/v1/webhooks/resend (+5 more)

### Community 60 - "Community 60"
Cohesion: 0.18
Nodes (11): admin_audit and admin_mutation_locks, Campaign collections (campaigns, executions, recipients, locks, templates), Bearer-authenticated cron scheduler /internal/campaigns/run, Marketing email consent and unsubscribe, Campaign execution worker and retries, M-CAMP Campaign Management Engine, Campaign real metrics only, Campaign production setup and blockers (+3 more)

### Community 61 - "Community 61"
Cohesion: 0.18
Nodes (11): API map (/api/v1), Profile image and business logo routes, Public submission endpoint POST /public/:slug/responses, Rewards routes, profile_images collection, responses collection, reward_rules/incidents/rewards/reward_quotas/reward_audit, Avatar / ImageUpload / prepareImage (+3 more)

### Community 62 - "Community 62"
Cohesion: 0.44
Nodes (10): createInstantRewardLimiter(), createInstantRewardSendLimiter(), createLoginLimiter(), createPublicScanLimiter(), createPublicSubmitLimiter(), createRegisterLimiter(), createRewardLookupLimiter(), handler() (+2 more)

### Community 65 - "Community 65"
Cohesion: 0.20
Nodes (9): includeFiles, maxDuration, buildCommand, framework, functions, api/index.js, installCommand, outputDirectory (+1 more)

### Community 66 - "Community 66"
Cohesion: 0.20
Nodes (10): serve, production, proxyConfig, budgets, buildTarget, outputHashing, builder, configurations (+2 more)

### Community 67 - "Community 67"
Cohesion: 0.31
Nodes (10): options, assets, browser, inlineStyleLanguage, polyfills, stylePreprocessorOptions, styles, tsConfig (+2 more)

### Community 68 - "Community 68"
Cohesion: 0.20
Nodes (9): zone.js@~0.15.0, @angular/compiler-cli@^20.3.0, engines, node, name, private, version, @angular/compiler-cli (+1 more)

### Community 71 - "Community 71"
Cohesion: 0.20
Nodes (8): Auth cookies gdv_at/gdv_rt/gdv_csrf, users and refresh_tokens, Onboarding flow, core/auth (AuthService, interceptor, guards), M-AUDIT, M-AUTH, M-BILL, M-BIZ

### Community 72 - "Community 72"
Cohesion: 0.20
Nodes (8): WhatsApp follow-up routes and webhook, contacts collection, followups collection, Customer feedback flow, Public feedback form /r/:slug, M-CONSENT, M-CRM, M-PUB

### Community 73 - "Community 73"
Cohesion: 0.20
Nodes (10): Missed call flow (P1), Review SMS flow, M-CALL, M-SMS, Deployment readiness review, M4 messaging next (Redis/BullMQ SMS), Manual contact add, Progress and handoff (+2 more)

### Community 74 - "Community 74"
Cohesion: 0.40
Nodes (10): Platform administration (M-ADMIN), /api/v1/admin endpoints (requireSuperAdmin, CSRF, no-store), admin_audit fail-closed audit log, admin:grant operator command, admin_mutation_locks serialization, Business adminState moderation (active/suspended/archived), Last active owner protection, Read-only inspection instead of impersonation (+2 more)

### Community 75 - "Community 75"
Cohesion: 0.29
Nodes (10): Marketing email consent and suppression, WhatsApp followups module (modules/followups), Privileged access, audit and retention, Legacy platform campaigns audit, MongoDB least-privilege roles, Platform campaign ownerApproval, Session-bound re-authentication, Retention and cleanup proposals (+2 more)

### Community 76 - "Community 76"
Cohesion: 0.36
Nodes (10): Instant Rewards specification (M-INSTANT-REWARDS), Instant Rewards API contracts, Atomic claim with idempotent replay, Durable audit outbox pendingEvents, Independent emailed verification challenge, Fragment-based token URLs, Lazy expiry sync, instant_rewards:manage permission (+2 more)

### Community 77 - "Community 77"
Cohesion: 0.22
Nodes (9): build, builder, configurations, defaultConfiguration, development, buildTarget, extractLicenses, optimization (+1 more)

### Community 78 - "Community 78"
Cohesion: 0.33
Nodes (5): ACCEPTED_IMAGE_TYPES, ImageError, MAX_SOURCE_BYTES, MAX_UPLOAD_BYTES, prepareImage()

### Community 79 - "Community 79"
Cohesion: 0.25
Nodes (7): cli, analytics, packageManager, newProjectRoot, projects, $schema, version

### Community 80 - "Community 80"
Cohesion: 0.25
Nodes (8): web, style, @schematics/angular:component, prefix, projectType, root, schematics, sourceRoot

### Community 85 - "Community 85"
Cohesion: 0.25
Nodes (7): Instant Rewards routes, instant_rewards and instant_reward_events, Instant Rewards lifecycle, Admin UI (features/admin), Instant Rewards UI (features/instant-rewards), M-ADMIN (module entry), M-INSTANT-REWARDS

### Community 86 - "Community 86"
Cohesion: 0.29
Nodes (7): scripts, build, ng, start, start:lan, test, watch

### Community 89 - "Community 89"
Cohesion: 0.29
Nodes (6): buildCommand, framework, headers, installCommand, outputDirectory, rewrites

### Community 90 - "Community 90"
Cohesion: 0.29
Nodes (6): admin:grant bootstrap command, instant_rewards:manage permission, M-ADMIN Platform Administration, Platform campaign owner approval, Session-bound admin reauth, Support grants and support_access_log

### Community 91 - "Community 91"
Cohesion: 0.29
Nodes (6): Questionnaire publish and onboarding rules, qr_events and consent_events, questionnaires and questionnaire_versions, M-DASH, M-FORM, M-QR

### Community 92 - "Community 92"
Cohesion: 0.29
Nodes (5): Change impact map, Environment and delivery hardening impact, PERFORMANCE_LOGGING opt-in diagnostics, Production performance (Vercel/Atlas), Per-task workflow

### Community 93 - "Community 93"
Cohesion: 0.33
Nodes (7): campaigns:indexes migration CLI, Instant Rewards operations, instant_rewards:manage delegated access, Instant Rewards delivery configuration, Additive indexes and outbox recovery, Server-side lazy expiry without cron, Recipient flow (fragment token scrubbed)

### Community 94 - "Community 94"
Cohesion: 0.33
Nodes (7): Product and experience plan, MVP journey: publish form, QR, anonymous submit, dashboard, Prioritized roadmap (MVP, Important, Advanced), Smile Score definition, Data and trust rules (membership authz, anonymous responses), SRS summary, Phases P0-P2 and milestones M0-M6

### Community 95 - "Community 95"
Cohesion: 0.33
Nodes (5): compilerOptions, rootDir, extends, include, ./tsconfig.json

### Community 100 - "Community 100"
Cohesion: 0.40
Nodes (6): ActionMenu, AppSelect / SelectControl, DropdownPanel (Popover API top layer), Shared dropdown system, UI design system (Bootstrap subset, tokens, Icon sprite), Frontend map (Angular)

### Community 101 - "Community 101"
Cohesion: 0.53
Nodes (6): Deploying to Vercel, API environment variables, MongoDB Atlas network access, Release gate 30 October 2026, Two Vercel projects (API and web), Web /api/* rewrite to API

### Community 102 - "Community 102"
Cohesion: 0.40
Nodes (5): extract-i18n, test, builder, builder, architect

### Community 104 - "Community 104"
Cohesion: 0.40
Nodes (4): Instant Rewards service boundary, Shared email provider (modules/email, Resend), email_delivery_events collection, M-EMAIL

### Community 105 - "Community 105"
Cohesion: 0.40
Nodes (4): overrides, printWidth, singleQuote, trailingComma

## Knowledge Gaps
- **72 isolated node(s):** `RFC-8058`, `./tsconfig.json`, `Session-bound admin reauth`, `instant_rewards:manage permission`, `admin:grant bootstrap command` (+67 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 712 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **30 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `mongoose` connect `Dashboard & Consent Events` to `Email Delivery (Resend)`, `Campaign Audience & Indexes`, `Admin Models & Support Grants`, `App Core & CSRF`, `Reward Service (API)`, `Follow-up Model`, `Support Access Authorization`, `Contact & Consent`, `Env & Passwords`, `Admin Actions & Locks`, `Reward Model & Incidents`, `API Tooling Config`, `Questionnaire Model`, `DB & WhatsApp Mock`, `Business Permissions`, `Admin Service`, `Image Model & Routes`, `Community 41`, `Community 44`, `Community 46`, `Community 54`?**
  _High betweenness centrality (0.037) - this node is a cross-community bridge._
- **What connects `RFC-8058`, `./tsconfig.json`, `Session-bound admin reauth` to the rest of the system?**
  _72 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Email Delivery (Resend)` be split into smaller, more focused modules?**
  _Cohesion score 0.05696969696969697 - nodes in this community are weakly interconnected._
- **Why does `apiErrorMessage()` connect `Support Access UI` to `Business Service & Onboarding`, `Questionnaire Service`, `QR & Instant Rewards UI`, `Feedback Service & Dashboard API`, `Rewards Service (Web)`, `Campaign Templates UI`, `Login Page`, `Auth Interceptor & Service`, `Admin Page`, `Routes & Guards`, `Rewards API Client`, `Campaign API Client`, `Public Form`, `Admin Dashboard`, `Community 45`, `Community 47`, `Community 56`, `Community 59`, `Community 69`, `Community 81`, `Community 82`, `Community 83`, `Community 84`, `Community 87`, `Community 97`, `Community 98`, `Community 103`?**
  _High betweenness centrality (0.035) - this node is a cross-community bridge._
- **Should `Campaign Audience & Indexes` be split into smaller, more focused modules?**
  _Cohesion score 0.07699089039083162 - nodes in this community are weakly interconnected._
- **Why does `@angular/core` connect `QR & Instant Rewards UI` to `Community 96`, `Admin Dashboard`, `Business Service & Onboarding`, `Community 68`, `Questionnaire Service`, `Feedback Service & Dashboard API`, `Rewards Service (Web)`, `Support Access UI`, `Community 42`, `Login Page`, `Auth Interceptor & Service`, `Routes & Guards`, `Campaign API Client`, `Public Form`?**
  _High betweenness centrality (0.034) - this node is a cross-community bridge._
- **Should `Admin Models & Support Grants` be split into smaller, more focused modules?**
  _Cohesion score 0.05673274094326726 - nodes in this community are weakly interconnected._