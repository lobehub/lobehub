---
name: split-micro-app
description: 'Use when splitting a monorepo surface into a standalone micro app (React Router SSR on Cloudflare Workers), fighting SSR bundle bloat from main-src imports, deploying its assets to CDN/R2, adding SEO/OG meta to an SSR page, adding a target and route rules for it in the lobehub gateway (torii), wiring it into the OSS Docker image, or deciding whether Cloud Next should still build or rewrite it.'
user-invocable: false
---

# Micro App: Split, SSR, SEO, Gateway

Canonical living example: **`apps/workbench`** (verify/acceptance, extracted 2026-08). When
in doubt, read the real files there — this skill records the decisions and landmines, not
copies of the code.

## Hosting

One app, two serve paths. Do not mix them.

| Surface             | Who serves `/verify` `/acceptance` | Build                                                                                                                                                        |
| ------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Cloud               | Gateway (torii) → workbench Worker | Cloud Next does **not** `build:spa:workbench`, copy `_spa-workbench`, rewrite to `/spa-workbench`, or CDN-upload that prefix                                 |
| OSS / 子部署 Docker | Next in the same image             | `build:docker` runs `build:spa:workbench`; `WORKBENCH_REQUIRED=1` on `generateSpaTemplates`; Dockerfile copies `apps/workbench/package.json` before `pnpm i` |

`generateSpaTemplates` skips a missing `dist/<name>` HTML unless `WORKBENCH_REQUIRED=1`. Cloud must skip. Docker must require.

Do not revive Cloud `SPA_TARGET=workbench` Vite builds or a `/spa-workbench` middleware rewrite.

## Crossing from the main SPA

Only markdown internal entity links leave the main SPA (`InternalEntityLink` → `window.location.assign` when `shouldHardNavigateToWorkbench`). `Link` and `useWorkspaceAwareNavigate` stay in-router. Electron never hard-navs (portal). Do not add a `__WORKBENCH__` Vite define — the helper keys off the path (and skips Electron).

## 1. Splitting & Artifacts

App layout (`apps/<name>/`):

```
app/            # RR framework mode: root.tsx, routes.ts, entry.server.tsx, routes/, lib/, stubs/
workers/app.ts  # worker entry: API reverse proxy + createRequestHandler
src/            # app-owned features/shell (may coexist with a legacy SPA entry)
vite.config.rr.mts   # RR pipeline; legacy vite.config.ts can coexist (RR CLI: -c vite.config.rr.mts)
wrangler.jsonc  # name, account_id, nodejs_compat, vars (API base / app home)
staticCssOptions.mjs # ONE source for static-css hrefTemplate (vite plugin + emit + dev middleware)
```

Reuse main-src code via `@/*` deep imports + Vite 8 native `resolve.tsconfigPaths: true`
(the vite-tsconfig-paths **plugin** breaks dev SSR module-runner resolution; the app's
tsconfig `include` must cover `app/`). Stack: `@react-router/dev@8` + `@cloudflare/vite-plugin`

- repo Vite 8 (rolldown) — officially compatible.

**SSR bundle weight is the whole battle.** Main-src imports drag the app universe
(store web → chat/agent/electron). Tools and cuts, in order:

| Tool / cut                    | How                                                                                                                                                                                                               |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Trace who pulls a module      | `WORKBENCH_TRACE_MODULE=store/chat/store [WORKBENCH_TRACE_ENV=client] bun run build:rr` — prints importer chain                                                                                                   |
| Client-gate heavy routes      | `.client.tsx` module + `clientOnlyRoute()` factory (hydration gate; SSR renders loading)                                                                                                                          |
| SSR-stub store hubs           | vite `resolveId` stubs per env (`app/stubs/`): trpc client, services/global, store/electron, store/file, i18n loader. Stubs must be **callable empty-state hooks**, not throwing proxies — render paths call them |
| Slot-inject app-only features | Context seam owned by the shared feature (see `src/features/Verify/Acceptance/originConversation.tsx`); app provides, micro app leaves null → affordances hide                                                    |
| Bypass barrels                | Deep-path imports (`@/features/Verify/Acceptance`, not the barrel) — barrels evaluate sibling exports with side effects                                                                                           |
| Decouple dual-use components  | Lift store reads to optional props (see AudioPlayer `uploadState`/`onCancelUpload`)                                                                                                                               |

Products: `build/client` (assets → CDN), `build/server` (worker; deploy with
`wrangler deploy --config build/server/wrangler.json`). Budget: worker gzip ≤ 10MB paid.

**CI affected-detection**: build emits `build-inputs.txt` (module-graph file list, gitignored);
the deploy workflow diffs changed files against the manifest from the **last successful run's
artifact** (carry-forward on skip), plus meta triggers (app dir, plugins/vite, lockfile,
tsconfig, glob dirs). New `import.meta.glob` patterns in shared code need a new meta trigger —
the one manual rule. See `apps/workbench/scripts/should-build.mjs` + `.github/workflows/deploy-workbench.yml`.

## 2. Deploy: CDN Assets + Worker

Assets follow the cloud convention (`resolveViteBase`): **stable prefix, no version stamp** —
`VITE_CDN_BASE=https://web-assets.lobehub.com/<name>/`; content-hashed filenames make uploads
incremental and immutable. `bun run deploy` (see `apps/workbench/scripts/deploy.ts`) =
build with CDN base → upload `build/client/assets` to R2 (`web-assets` bucket, LobeHub
account) → `wrangler deploy`. R2 creds: 1Password Shared vault item "CI R2 - web-assets".
CI injects repo secrets `ASSET_S3_*` (`ACCESS_KEY_ID`, `SECRET_ACCESS_KEY`, `BUCKET`,
`ENDPOINT`, `REGION`, `PUBLIC_DOMAIN`). Local `bun run deploy` can fall back to `MOBILE_S3_*`.
Never echo values.

Worker responsibilities beyond SSR: reverse-proxy `/api|/oidc|/trpc|/webapi` to
`WORKBENCH_API_BASE` (standalone mode; behind the gateway the browser hits the apex and the
gateway routes API to `app` instead), and redirect `/` + unknown paths to `WORKBENCH_APP_HOME`.

## 3. SSR

- **Loader-side data**: per-request tRPC client (`httpLink` + superjson + forwarded `cookie`
  header, base from wrangler vars via `cloudflareContext`) — the browser lambdaClient is
  SSR-stubbed. Inject into SWR with `<SWRConfig value={{ fallback: { [unstable_serialize(key)]: data } }}>`;
  key must equal `useClientDataSWR`'s (augmentKey passes through when workspaceId is null).
- **`isLoading && !data`**: with SWRConfig fallback, `isLoading` is true during mount
  revalidation — a bare `if (isLoading)` swaps SSR content for a spinner after hydration.
- **i18n**: narrow to the namespaces the app renders; root loader preloads locale resources,
  i18n inits sync (`initAsync: false`) with bundled resources; SSR env stubs the shared glob
  loader to only its namespaces (full glob = every locale × ns as worker chunks).
- **CSS three layers**: lobe-ui `static-css` (antd probes + theme vars, hrefTemplate from the
  shared options file; emitted as hashed files, dev served by config middleware) →
  antd-style `extractStaticStyle(html, { includeAntd: false })` for emotion →
  `buildInlineAntdStyle(cache, { styleKeys })` fallback. Non-streaming render
  (`await stream.allReady`) so extraction is complete.
- `<html suppressHydrationWarning>` — next-themes stamps `data-theme` pre-hydration.

RR v8 gotchas (docs/templates still say v7):

| v8 change                                          | Symptom                                                 |
| -------------------------------------------------- | ------------------------------------------------------- |
| load context must be `new RouterContextProvider()` | template's plain object → 500                           |
| `MetaArgs.data` renamed `loaderData`               | `{ data }` destructure silently undefined; build passes |
| `*` splat does not match bare `/`                  | no index route → root falls into ErrorBoundary          |
| `vite preview` ignores `server.proxy`              | loader self-fetch gets HTML → keep API base explicit    |

## 4. SEO

One shared builder (`app/lib/seo.ts` → `buildPageMeta`): title, description, robots,
og:title/description/type/site\_name/locale (underscore form)/image(+alt), twitter card set.
Rules: leaf `meta` **fully replaces** root meta — every leaf returns the whole set;
`og:image` must be an **absolute URL** (reuse landing's `https://lobehub.com/assets/cao-og.webp`);
dynamic title/description come from the route loader (subject title · BRANDING\_NAME,
requirement text truncated \~200 chars).

## 5. Gateway Routing (torii, `../lobehub-gateway`)

Config = KV `config:lobehub.com`, mirrored in `config/entrypoints/lobehub.com/<env>.json`.
To add a micro app:

1. `targets.<name>` = worker hostname (must be cross-zone, e.g. `*.workers.dev`; https).
2. `targetPolicies.<name>` — `cookies` if SSR loaders need the `.lobehub.com` session
   forwarded; `none` for public-only; `all` adds Authorization.
3. `rules` — first-match path prefixes (`{ "match": "/acceptance", "target": "<name>" }`).
   Leave `/trpc` unruled: it falls to `default` (app) so browser API calls stay same-origin
   authenticated. `.data` suffix is normalized before matching.
4. Validate: `bun run test` in the gateway repo (invariant suite reads the mirror).
5. Staging: `bun scripts/torii.ts push --env staging --expect <fp>` (needs TORII\_ACCESS\_\*),
   or poke staging KV directly (`wrangler kv key put --namespace-id <staging CONFIG ns>`) —
   README-sanctioned. Prod writes only via the Toriiban (鳥居番) admin **Promote** button.
6. Verify with staging debug headers: `x-torii-target` / `x-torii-decision` per request, and
   test document + `.data` + unaffected routes.

Landmine (fixed 2026-08, stay aware): the lobehub-com `react-router-data` plugin owns `.data`
protocol affinity for the landing pair; it consults `resolveRule` and lets other targets'
`.data` fall through — if a future entrypoint clones that plugin, keep the fall-through.

## Checklist for a new micro app

1. Scaffold `apps/<name>` (copy workbench shapes); routes + root + entry.server + worker.
2. Build, run the module trace, cut SSR weight (gate/stub/slot/deep-import) until gzip sane.
3. Wire CDN deploy (`deploy.ts`, stable `_<name>/` prefix) + wrangler vars + redirects.
4. Loader data + SWR fallback + meta builder + i18n narrowing; verify with `/trpc`-blocked
   browser run (content must survive) and view-source (SSR content + meta present).
5. Deploy worker; verify workers.dev standalone (API proxy, `/` redirect).
6. Gateway: target + policy + rules on staging KV; curl matrix with x-torii headers; promote.
7. OSS Docker: workspace `package.json` in the Dockerfile `pnpm i` layer; `build:docker`
   builds the app; `WORKBENCH_REQUIRED=1` (or the new app's equivalent) on template gen.
8. Cloud Next: no Vite target, no `/spa-<name>` rewrite, no `_spa-<name>` CDN upload.
