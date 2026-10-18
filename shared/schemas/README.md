# @hush/schemas

The API contract for hush.hanx.pro. Zod schemas, inferred TypeScript types and shared constants used by all three apps:

- the CLI (`cli/`)
- the frontend (`hush.hanx.pro/frontend`)
- the backend (`hush.hanx.pro/backend`)

If the clients and the server disagree about a request or response shape, the fix belongs here — this package is the single source of truth.

## What's inside

| File | Contents |
|---|---|
| `src/constants.ts` | Limits (sizes, counts), role names + helpers, API path builders, device-flow timings, KDF bounds |
| `src/entities.ts` | Zod schemas + types for users, projects, environments, versions, members, tokens, invites, audit entries |
| `src/api.ts` | Request/response schemas for every HTTP endpoint, plus the shared API error shape |
| `src/index.ts` | Re-exports everything |

## How to run it alone

```bash
pnpm --filter @hush/schemas test        # unit tests (schema parse cases)
pnpm --filter @hush/schemas typecheck
pnpm --filter @hush/schemas build       # emits dist/ (ESM + d.ts); consumers use src/ directly in dev
```

## Consumption pattern

Workspace consumers import the package by name (`@hush/schemas`) and resolve to TypeScript source. The frontend/backend Next.js apps list it in `transpilePackages`; the CLI bundles it into its published artifact via tsup (`noExternal`). No build step is required for local development.

## Env vars

None. This package is environment-agnostic and has a single runtime dependency (`zod`).
