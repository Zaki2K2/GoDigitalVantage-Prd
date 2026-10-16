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
