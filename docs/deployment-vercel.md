# Deploying to Vercel (two projects, one repository)

| | API project | Web project |
|---|---|---|
| Root directory | `apps/api` | `apps/web` |
| Preset | Other | Other (Angular output) |
| Install / Build | `npm ci` / `npm run build` | `npm ci` / `npm run build` |
| Output directory | `public` | `dist/web/browser` |
| Node | 22.x | 22.x |

Both apps carry their own `vercel.json`; there is no root-level Vercel config.

## API environment variables (API project only)
| Name | Value |
|---|---|
| `NODE_ENV` | `production` |
| `MONGODB_URI` | Atlas string ending `/godigitalvantage?retryWrites=true&w=majority` (secret) |
| `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` | two different random strings, 32+ characters (secret) |
| `PUBLIC_APP_BASE_URL` | the **web** project's public URL, e.g. `https://<web>.vercel.app` (never the API URL). Legacy `PUBLIC_BASE_URL` still works; the new name wins |
| `CORS_ORIGIN` | the same web URL (comma-separated for several) |
| `RATE_LIMIT_STORE` | `mongo` |
| `TRUST_PROXY` | `1` (check the client IP the API sees after the first deploy) |
| optional | `LOGIN_RATE_LIMIT_MAX`, `REGISTER_RATE_LIMIT_MAX`, `PUBLIC_SUBMIT_RATE_LIMIT_MAX`, `PUBLIC_SCAN_RATE_LIMIT_MAX` |

Tick Production (and Preview if you use preview URLs). Variables apply only to **new** deployments.
If one is missing or invalid the API answers `500 {"error":{"code":"MISCONFIGURED"}}` and the Vercel function log names the variable(s); it does not crash.

## Web project
No environment variables. `apps/web/vercel.json` rewrites `/api/*` to the API project (replace `REPLACE-WITH-API-PROJECT.vercel.app` with the API's domain) and falls back to `index.html` for Angular routes. The browser only talks to its own origin, so httpOnly cookies and CSRF work unchanged.

## Atlas
Network Access must allow Vercel (`0.0.0.0/0`); use a dedicated least-privilege database user.

## Redeploy and verify
1. API project: set variables, then Deployments -> latest -> Redeploy.
2. `GET https://<api>/api/v1/health` returns 200 (a `500 MISCONFIGURED` means a variable is missing: read the function log).
3. Set the web rewrite destination to the API domain, commit, let the web project redeploy.
4. Open the web URL: register, onboard, publish, open `/r/<slug>`, submit, redeem a reward.
5. Confirm `GET https://<web>/api/v1/health` also returns 200 (rewrite works).

## Transactional email

Follow [Resend email configuration](email-resend.md) for exact API environment variables, sender aliases, verified-domain gate, signed webhook setup and enablement checks. Keep EMAIL_ENABLED=false until verified/configured. No email secrets belong in the web Vercel project.
