---
name: split-micro-app
description: 'Use when splitting a monorepo surface into a standalone micro app (React Router SSR on Cloudflare Workers), splitting a surface whose rendering code lives in the lobehub-cloud business overlay, fighting SSR bundle bloat from main-src imports, deploying its assets to CDN/R2, adding SEO/OG meta to an SSR page, adding a target and route rules for it in the lobehub gateway (torii), wiring it into the OSS Docker image, or deciding whether Cloud Next should still build or rewrite it.'
user-invocable: false
---

# Micro App: Split, SSR, SEO, Gateway

Canonical living examples, both extracted 2026-08 — read the real files, this skill records
the decisions and landmines, not copies of the code:

- **`apps/workbench`** (`/verify`, `/acceptance`) — all code in this repo, builds and deploys from OSS CI.
- **`apps/share`** (`/share/t/:id`, `/share/page/:id`) — renders Cloud-only surfaces, so it
  builds and deploys from **lobehub-cloud** CI. See §1b before touching it.

## Hosting

One app, two serve paths. Do not mix them.

| Surface             | Who serves it                           | Build                                                                                                                                                                                               |
| ------------------- | --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cloud               | Gateway (torii) → Worker (SSR)          | Cloud Next does **not** `build:spa:<name>`, copy `_spa-<name>`, rewrite to `/spa-<name>`, or CDN-upload that prefix                                                                                 |
| OSS / 子部署 Docker | Next in the same image, client-rendered | `build:docker` runs `build:spa:<name>`; `<NAME>_REQUIRED=1` on `generateSpaTemplates`; Dockerfile copies `apps/<name>/package.json` before `pnpm i` and `public/_spa-<name>` into the runtime image |

`generateSpaTemplates` skips a missing `dist/<name>` HTML unless `<NAME>_REQUIRED=1`. Cloud must skip. Docker must require.

Do not revive Cloud `SPA_TARGET=<name>` Vite builds or a `/spa-<name>` middleware rewrite.

The Docker chain per app, all five links or the route is dead: root `build:docker` script →
`copySpaBuildCore.ts` target entry (`dist/<name>` → `public/_spa-<name>`) → `spaHtmlPaths.ts`
resolver + `generateSpaTemplates` block → `src/app/spa-<name>/[locale]/[[...path]]/route.ts` →
middleware rewrite (`src/libs/next/<name>Routes.ts` + `define-config.ts`) plus the path in
`src/proxy.ts`'s matcher and, for public pages, in `isPublicRoute`.

**Self-hosted loses per-page SSR.** The Next shell serves the built SPA HTML with a brand OG
card and `noindex, nofollow`; per-subject title/OG only exists in the Worker build. That is the
accepted trade, not a bug to chase.

**Dev shells — a 200 that lies.** A `/spa-<name>` handler may only call
`fetchViteDevTemplate('/index.<name>.html')` if that file exists at the repo **root** (workbench
has one; it differs from `apps/<name>/index.html` only in the entry path, which must point at
`/apps/<name>/src/entry.tsx`). Miss it and Vite's HTML fallback answers **200 with the main SPA
shell** — the micro app never loads, nothing errors, and the main SPA no longer has those routes.
An app developed against its own Vite server (share: `dev:spa:share`) carries **no dev branch at
all**. `scripts/spaDevShells.test.ts` guards both directions.

## Crossing from the main SPA

Only markdown internal entity links leave the main SPA (`InternalEntityLink` → `window.location.assign` when `shouldHardNavigateToWorkbench`). `Link` and `useWorkspaceAwareNavigate` stay in-router. Electron never hard-navs (portal). Do not add a `__WORKBENCH__` Vite define — the helper keys off the path (and skips Electron).

Share needed none of this: the only producer builds an **absolute** URL for copy/open
(`${appOrigin}/share/t/${id}` in `SharePopover`), which is already a hard navigation. Before
deleting `src/routes/<x>/**`, grep for in-router links to those paths — a surviving `Link` lands
on the main SPA's 404. Then drop the routes from `desktopRouter.config.tsx` /
`mobileRouter.config.tsx` and update `desktopRouter.sync.test.tsx` + `routeScope.test.ts`.

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

| Tool / cut                    | How                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Trace who pulls a module      | `<APP>_TRACE_MODULE=store/chat/store [<APP>_TRACE_ENV=client] bun run build:rr` — prints importer chain (`SHARE_`/`WORKBENCH_`). In an overlay repo, run it there too (§1b)                                                                                                                                                                                                                                                                                                                                        |
| Client-gate heavy routes      | `.client.tsx` module + `clientOnlyRoute()` factory (hydration gate; SSR renders loading)                                                                                                                                                                                                                                                                                                                                                                                                                           |
| SSR-stub store hubs           | vite `resolveId` stubs per env (`app/stubs/`): trpc client, services/global, store/electron, store/file, store/user, i18n loader. Stubs must be **callable empty-state hooks**, not throwing proxies — render paths call them. Keep the implemented surface explicit (no catch-all `Proxy` / `as never`): `stubSurfaceGuard` in `vite.config.rr.mts` fails the build when the graph imports an export or member the stub does not implement. Add the member (empty / `reject`) or keep the importer off the graph. |
| Client-shim lambda            | Client `@/libs/trpc/client` is a cookie-only `httpLink` (`trpcClient.client.ts`). Do not ship the real `lambda.ts` — its `headers()` pulls image store → chat store + `model-bank` catalog.                                                                                                                                                                                                                                                                                                                        |
| SSR-stub shiki langs          | On the SSR env, resolve `@shikijs/langs` / `@shikijs/themes` / shiki's `langs-bundle` / `themes` / wasm to `app/stubs/shiki.ts`. Do **not** stub the `shiki` package entry — Pierre diffs and Highlighter import named APIs from it.                                                                                                                                                                                                                                                                               |
| Client shiki from CDN         | On the client env, resolve `shiki` / `shiki/*` / `@shikijs/*` to pinned `https://esm.sh/...@<installed shiki version>` as externals. Do not bundle grammars or wasm into `build/client`.                                                                                                                                                                                                                                                                                                                           |
| Slot-inject app-only features | Context seam owned by the shared feature (see `src/features/Verify/Acceptance/originConversation.tsx`); app provides, micro app leaves null → affordances hide                                                                                                                                                                                                                                                                                                                                                     |
| Bypass barrels                | Deep-path imports (`@/features/Verify/Acceptance`, not the barrel) — barrels evaluate sibling exports with side effects                                                                                                                                                                                                                                                                                                                                                                                            |
| Compose capability atoms      | Shared UI is assembled per surface; the light app never imports the fat viewer. See **`compose-atoms`**. Do not add `readOnly` on the in-app page                                                                                                                                                                                                                                                                                                                                                                  |
| Decouple dual-use components  | Lift store reads to optional props (see AudioPlayer `uploadState`/`onCancelUpload`)                                                                                                                                                                                                                                                                                                                                                                                                                                |

Share's cuts took SSR from **9.84MB → 1.78MB gzip**. Two build-level snags worth knowing:
`resolve.dedupe` must include `@lobehub/ui` (the `builtin-tool-*` packages declare a loose `^5`
and resolve to an older copy whose base-ui lacks components the app renders → `MISSING_EXPORT:
Alert`), and a `*.client` module needs its own SSR-env stub so the hydration gate does not drag
the gated tree into the worker anyway.

Products: `build/client` (assets → CDN), `build/server` (worker; deploy with
`wrangler deploy --config build/server/wrangler.json`). Budget: worker gzip ≤ 10MB paid.

**CI affected-detection**: build emits `build-inputs.txt` (module-graph file list, gitignored);
the deploy workflow diffs changed files against the manifest from the **last successful run's
artifact** (carry-forward on skip), plus meta triggers (app dir, plugins/vite, lockfile,
tsconfig, glob dirs). New `import.meta.glob` patterns in shared code need a new meta trigger —
the one manual rule. See `apps/workbench/scripts/should-build.mjs` +
`.github/workflows/deploy-workbench.yml`; the overlay-hosted variant is lobehub-cloud's
`scripts/shouldBuildShare.ts` + `.github/workflows/deploy-share.yml` (§1b).

## 1b. When the surface renders Cloud-only code

`lobehub-cloud` includes this repo as a submodule at `lobehub/` and shadows it path-by-path
through tsconfig `paths` (`@/business/*` → `./src/business/*` then `./lobehub/src/business/*`;
`@/*` → `./src/*` then `./lobehub/src/*`). Split by **ownership**, not by which repo is handy:

| Code                                                                      | Where it goes                                                                                                         |
| ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Routes, shell, SSR pipeline, worker, CDN deploy, SSR stubs of OSS modules | OSS `apps/<name>` — Docker serves the same app                                                                        |
| Rendering surfaces only Cloud implements                                  | Stays in Cloud. OSS keeps the `@/business/*` stub (`return null` / passthrough, real types); the app imports the seam |
| SSR stubs for Cloud-only store hubs                                       | Cloud (`apps/<name>/stubs/*`), injected into the shared config                                                        |

The RR config is a **factory** so both hosts share one pipeline:
`apps/share/vite.config.shared.mts` exports
`createShareRrConfig({ appRoot, extraSsrStubs, repoRoot, resolvePlugins, staticCss })`, and the
OSS `vite.config.rr.mts` is a thin caller reading `SHARE_TSCONFIG_PROJECT` /
`SHARE_EXTRA_SSR_STUBS`. Cloud fills both in `scripts/shareApp.ts` and drives the submodule app
through `scripts/{buildShare,devShare,deployShare,shouldBuildShare}.ts`.

**Landmine — the overlay silently doesn't apply.** Vite 8's native `resolve.tsconfigPaths`
resolves against the tsconfig _nearest each importer_, so submodule files resolve through the
submodule's own tsconfig and the host overlay is lost. The build still succeeds and ships the
open-source fallback surfaces (for share: a blank page). An overlay build must use the
`vite-tsconfig-paths` **plugin** pinned to the host tsconfig and switch the native one off
(`tsconfigPaths: !resolvePlugins`). Both settings are right in their own context — native for
the standalone build, plugin for the overlay build. Verify by grepping `build-inputs.txt` for a
Cloud-only file.

**Whoever's code must be inside the artifact owns the build.** Share deploys from
lobehub-cloud (`.github/workflows/deploy-share.yml`), not OSS. Never add a deploy workflow to a
repo that can only produce the fallback.

**Cloud affected-detection needs submodule history**: a bump is a single `lobehub` entry in the
host diff, so the workflow runs `git -C lobehub fetch --unshallow` and compares the previous
submodule SHA (carried in the state artifact) before diffing against `build-inputs.txt`.

**Re-run the module trace in the Cloud build** — the overlay adds chains OSS never sees
(`ShareAppShell → @/store/serverConfig/Provider → … → @/store/workspace → workspaceBootstrap →
@/store/home → @/store/chat` cost 8.2MB gzip until stubbed).

**Merge order**: OSS PR → submodule bump → Cloud PR. Until the OSS PR lands, anything deployed
from a local submodule mirror is not reproducible from any commit — say so when handing over.

## 2. Deploy: CDN Assets + Worker

Assets follow the cloud convention (`resolveViteBase`): **stable prefix, no version stamp** —
`VITE_CDN_BASE=https://web-assets.lobehub.com/<name>/`; content-hashed filenames make uploads
incremental and immutable. The prefix axis is the **app**, nothing else: do not invent
`<name>-oss` / `<name>-cloud` variants to separate build origins — hashed filenames already make
one prefix safe for all of them. `ASSET_S3_PUBLIC_DOMAIN` is an origin; any path segment belongs
on `ASSET_BASE_URL` instead. `bun run deploy` (see `apps/workbench/scripts/deploy.ts`) =
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
- **Time-dependent output must be client-gated**: relative timestamps and anything else the
  server and client compute differently belong behind a `useHydrated()`
  (`useSyncExternalStore`) check, not in the SSR pass.
- **Skeletons must not swallow SSR'd chrome**: a list that flips to a skeleton on mount blanks
  the server-rendered header with it. Render the header slot in the skeleton branch too.
- **Preload the `error` namespace**, not just the render ones. The boundary shows exactly when a
  chunk failed to load — precisely when the client can no longer fetch a dictionary — and an
  untranslated boundary prints raw keys (`error.title`…). Cost for share: +6.3KB gzip/document.
- **Prefilling a virtualized list**: `virtua` caches measured sizes by index, so a _truncated_
  prefill that later grows misaligns every row. Prefill the whole list or none of it.

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
   forwarded; `none` for public-only; `all` adds Authorization. Add `"locale": "query"` when the
   app reads `?hl=` (share does).
3. `rules` — first-match path prefixes (`{ "match": "/acceptance", "target": "<name>" }`).
   Leave `/trpc` unruled: it falls to `default` (app) so browser API calls stay same-origin
   authenticated. `.data` suffix is normalized before matching.
4. Validate: `bun run test` in the gateway repo (invariant suite reads the mirror).
5. Staging: `bun scripts/torii.ts push --env staging --expect <fp>` (needs TORII\_ACCESS\_\*),
   or poke staging KV directly (`wrangler kv key put --namespace-id <staging CONFIG ns>`) —
   README-sanctioned. Prod writes only via the Toriiban (鳥居番) admin **Promote** button:
   `torii.ts promote` prints the exact delta and refuses to write, and
   `push --env prod --confirm-prod` exists but bypasses a deliberate human gate — don't.
   Before promoting, `pull --env prod` (repo mirrors go stale — a mirror-vs-live diff is not
   drift), run the invariant suite, and re-run `verify --env staging`.
6. Verify with staging debug headers: `x-torii-target` / `x-torii-decision` per request, and
   test document + `.data` + unaffected routes.

Landmine (fixed 2026-08, stay aware): the lobehub-com `react-router-data` plugin owns `.data`
protocol affinity for the landing pair; it consults `resolveRule` and lets other targets'
`.data` fall through — if a future entrypoint clones that plugin, keep the fall-through.

## Checklist for a new micro app

1. Decide ownership first (§1b): does the surface render Cloud-only code? That fixes which repo
   builds, deploys, and holds the extra SSR stubs.
2. Scaffold `apps/<name>` (copy workbench/share shapes); routes + root + entry.server + worker.
3. Build, run the module trace, cut SSR weight (gate/stub/slot/deep-import) until gzip sane —
   in the overlay repo too, if there is one.
4. Wire CDN deploy (`deploy.ts`, stable `_<name>/` prefix) + wrangler vars + redirects.
5. Loader data + SWR fallback + meta builder + i18n narrowing (+ `error`); verify with
   `/trpc`-blocked browser run (content must survive) and view-source (SSR content + meta present).
6. Deploy worker; verify workers.dev standalone (API proxy, `/` redirect).
7. Gateway: target + policy + rules on staging KV; curl matrix with x-torii headers; promote.
8. OSS Docker: all five links in the Hosting section, plus the removal sweep from the main SPA.
9. Cloud Next: no Vite target, no `/spa-<name>` rewrite, no `_spa-<name>` CDN upload.

## Verifying, before you tell anyone it works

Build success proves nothing about what rendered. Each of these produced a real defect that a
green build hid: the overlay resolving to OSS stubs, the dev shell answering 200 with the wrong
app, an edit that silently no-op'd because the anchor string had drifted (deployed a 500 —
so: build → local `wrangler dev` → browser → _then_ deploy), and a "fix" asserted from the
source instead of the page. Prove the Docker chain by running `build:spa:<name>` +
`<NAME>_REQUIRED=1 build:spa:copy` and asserting every asset the generated template references
exists under `public/`; prove the SSR page by viewing source, not by reading the loader.
