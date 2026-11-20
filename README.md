# notifier

This project was created with [Better-T-Stack](https://github.com/AmanVarshney01/create-better-t-stack), a modern TypeScript stack that combines Next.js, Hono, ORPC, and more.

## Features

- **TypeScript** - For type safety and improved developer experience
- **Next.js** - Docs site (fumadocs, static export)
- **React Native** - Build mobile apps using React
- **Expo** - Tools for React Native development
- **TailwindCSS** - Utility-first CSS for rapid UI development
- **Shared UI package** - shadcn/ui primitives live in `packages/ui`
- **Hono** - Lightweight, performant server framework
- **oRPC** - End-to-end type-safe APIs with OpenAPI integration
- **workers** - Runtime environment
- **Drizzle** - TypeScript-first ORM
- **Cloudflare D1** - Database engine
- **Authentication** - Better-Auth
- **Biome** - Linting and formatting
- **Turborepo** - Optimized monorepo build system

## Getting Started

First, install the dependencies:

```bash
pnpm install
```

## Database Setup

This project uses Cloudflare D1 (SQLite) with Drizzle ORM.

Runtime database access uses the Cloudflare `DB` binding from `packages/infra/alchemy.run.ts`. If a local `DATABASE_URL` is present, it is only for database tooling.

Alchemy provisions the D1 database and applies migrations during `deploy`.

1. Generate migration files:

```bash
pnpm run db:generate
```

Then, run the server locally (wrangler, local D1 on port 3300):

```bash
cd apps/server && pnpm run dev:local
```

The API is at [http://localhost:3300/api](http://localhost:3300/api/health), the same paths as production. From `apps/native`, run the `ios` script for iOS or the `android` script for Android to build and launch the app; set `EXPO_PUBLIC_SERVER_URL=http://<LAN IP>:3300/api` in `apps/native/.env`. See [Expo development builds](https://docs.expo.dev/develop/development-builds/introduction/) for device setup. The docs site runs with `pnpm --filter fumadocs dev` on port 4000.

## UI Customization

`packages/ui` holds shadcn/ui primitives for React web apps (there is no web app at the moment).

- Change design tokens and global styles in `packages/ui/src/styles/globals.css`
- Update shared primitives in `packages/ui/src/components/*`
- Adjust shadcn aliases or style config in `packages/ui/components.json`

### Add more shared components

Run this from the project root to add more primitives to the shared UI package:

```bash
npx shadcn@latest add accordion dialog popover sheet table -c packages/ui
```

Import shared components like this:

```tsx
import { Button } from "@notifier/ui/components/button";
```

### Add app-specific blocks

If you want to add app-specific blocks instead of shared primitives, run the shadcn CLI from that app's directory.

## Environment Configuration

Each app owns its environment schema in `.env.schema`. Varlock generates `src/env.ts` during installation; run `pnpm run env:generate` after changing a schema. Commit schemas, and keep secrets in ignored env files or your deployment platform.

Import the generated `ENV` accessor in application code. Shared database and auth packages receive configuration or initialized clients from the application. See [Varlock's monorepo guide](https://varlock.dev/guides/monorepos/).

For Cloudflare, Alchemy loads and validates deployment inputs with `varlock/auto-load` in its Node/Bun deployment process. Worker code reads native bindings; web clients use the framework's public env API through `src/env.public.ts` where needed. Alchemy supplies resource URLs and managed database credentials. In-Worker Varlock protections are deferred until an official Alchemy integration is available; see [the non-Wrangler deployment guidance](https://varlock.dev/integrations/cloudflare/#non-wrangler-deploy-tools-alchemy-sst-pulumi).

Bun's automatic env loading is disabled in `bunfig.toml`; the framework integration or server bootstrap loads Varlock. Node deployments must include Varlock and its dependencies alongside the app schema.

Run standalone Node/Bun tools that use Varlock from the owning app directory so they load that app's schema and env files. `env:generate` only generates TypeScript files; it does not initialize environment values in a subsequent command.

## Deployment

Production is **https://notifier.bartuozel.com**, on Cloudflare, declared in `packages/infra/alchemy.run.ts` (Alchemy, stage `production`). One hostname serves everything:

| URL | Served by |
| --- | --- |
| `/` (and `/docs/...`, `/llms.txt`, `/search.json`) | Docs site (`apps/fumadocs`, static export on Workers static assets, custom domain) |
| `/api/health` | Server Worker (`apps/server`) |
| `/api/auth/*` | better-auth (sign-in, sessions, OAuth 2.1 provider; issuer `https://notifier.bartuozel.com/api/auth`) |
| `/api/rpc/*` | App API (oRPC) for the mobile app |
| `/api/v1/*` | Public REST API; reference at `/api/v1/docs` |
| `/api/mcp` | MCP server (OAuth bearer tokens) |
| `/api/oauth/login`, `/api/oauth/consent` | Sign-in and consent pages for MCP clients |
| `/.well-known/oauth-authorization-server/api/auth`, `/.well-known/oauth-protected-resource/api/mcp` | OAuth discovery (RFC 8414, RFC 9728), served by the server Worker |

The server Worker has the zone routes `notifier.bartuozel.com/api/*` and `notifier.bartuozel.com/.well-known/*`. Routes run in front of the docs Worker's custom domain, which also creates the `notifier` DNS record. Alchemy creates the D1 database and applies `packages/db/src/migrations` on every deploy. An hourly Cron Trigger runs retention cleanup.

Connect an agent:

```bash
claude mcp add --transport http pocket-notifier https://notifier.bartuozel.com/api/mcp
codex mcp add pocket-notifier --url https://notifier.bartuozel.com/api/mcp && codex mcp login pocket-notifier
```

### CI/CD (GitHub Actions)

- `.github/workflows/ci.yml`: on pull requests and pushes to other branches, runs `pnpm install --frozen-lockfile`, `pnpm lint`, `pnpm check-types` and `pnpm test`.
- `.github/workflows/deploy.yml`: on every push to `main` (and by hand with **Run workflow**), runs the same checks, then `alchemy deploy --stage production --yes` from `packages/infra`. Deploys never run in parallel (`concurrency: production`).

`main` is production: pushing or merging to it deploys. The deploy needs no login and no `.env` file: Alchemy reads Cloudflare credentials from the environment and keeps its state in the account's Cloudflare state store. Repository settings hold:

- Secrets: `CLOUDFLARE_API_TOKEN`, `BETTER_AUTH_SECRET`, `ALCHEMY_PASSWORD`, `FCM_SERVICE_ACCOUNT`.
- Variable: `CLOUDFLARE_ACCOUNT_ID`.

To deploy by hand from a machine with an Alchemy profile (`cd packages/infra && pnpm exec alchemy profile edit`), export the same variables and run `cd packages/infra && pnpm exec alchemy deploy --stage production`.

A fresh deployment starts with an empty database. The first account to sign up becomes the owner without an invite; every later sign-up needs one.

## Git Hooks and Formatting

- Run checks: `pnpm run check`

## Project Structure

```
notifier/
├── apps/
│   ├── fumadocs/    # Docs site (Next.js static export, fumadocs)
│   ├── native/      # Mobile application (React Native, Expo)
│   └── server/      # Backend API (Hono, ORPC)
├── packages/
│   ├── ui/          # Shared shadcn/ui components and styles
│   ├── api/         # API layer / business logic
│   ├── auth/        # Authentication configuration & logic
│   ├── contract/    # oRPC contracts and shared schemas
│   ├── db/          # Database schema & queries
│   └── infra/       # Alchemy deployment (alchemy.run.ts)
```

## Available Scripts

- `pnpm run dev`: Start all applications in development mode
- `pnpm run build`: Build all applications
- `pnpm run dev:server`: Start only the server
- `pnpm run check-types`: Check TypeScript types across all apps
- `pnpm run dev:native`: Start the React Native/Expo development server
- `pnpm run db:generate`: Generate database client/types
- `pnpm run check`: Run Biome formatting and linting
