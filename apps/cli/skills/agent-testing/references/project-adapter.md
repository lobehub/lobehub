# Project Adapter (`.agents/verify/PROJECT.md`)

This skill is project-agnostic. Everything specific to the project under test — how
to start and stop it, which ports and services it needs, how auth works, which
surfaces it has, and how to jump straight into app state — lives in a per-project
adapter at `.agents/verify/PROJECT.md`. The skill reads it; it never guesses the
project's commands.

## Where the adapter lives

```text
<repo>/.agents/verify/            # committed — the adapter and project logs are team assets
├── PROJECT.md                    # the adapter (this contract)
├── common-mistakes.md            # PROJECT-layer living log (writable)
├── probe-mock-patterns.md        # PROJECT-layer living log (writable)
└── scripts/                      # optional: project env / probe scripts
```

`.agents/verify/` is **committed** (the adapter and the project living logs are
shared, versioned team assets). The report output directory `.records/` is
**gitignored** — reports are per-run artifacts, published to the verify platform,
not committed.

## Fixed section skeleton

`PROJECT.md` always has these six sections, in this order. Sections the skill refers
to by number (`PROJECT.md §2`, `§3`, …), so keep the numbering.

1. **Project summary** — what the product is, and the repo layout relevant to
   testing (which package holds the server, the web app, the desktop shell, the
   CLI).
2. **Environment** — how to start and stop the dev environment; the required
   services (database, cache, queue, object store) and how to start each; how to
   detect "already running" so a run does not clobber a user's server; how env and
   ports are resolved (the project's own env-resolver command, if any) so the skill
   never hard-codes a port table.
3. **Auth** — test accounts, seeding commands, and a per-surface status check (one
   command per surface that answers "am I signed in on this surface?").
4. **Surfaces** — which of CLI / Web / Electron apply, and for each that applies:
   launch command, base URL / port, agent-browser session name (web/electron), and
   which probe scripts drive it.
5. **Project probes & quick navigation** — the fast paths into app state: an auth
   probe, a current-route probe, a running-operations probe, and a `goto <route>`
   quick-navigation, plus the routes worth jumping to. These are the project's
   equivalent of a state-introspection helper; the skill uses them instead of
   hand-rolling store-eval snippets.
6. **Known constraints** — anything the generic gates must know before running:
   services that are hard prerequisites for a code path (e.g. "agent runs require
   the queue service up"), standalone sub-packages that need their own install,
   surfaces that only work on macOS, or any repo-specific gotcha a run must respect.

`PROJECT.md` may reference project scripts under `.agents/verify/scripts/` or
anywhere in the repo.

## Copy-pasteable template

```markdown
# PROJECT.md — agent-testing adapter for <project name>

## 1. Project summary

<One paragraph: what the product is. Then the repo layout that matters for testing —
which directory/package is the server, the web app, the desktop shell, the CLI.>

## 2. Environment

- **Start dev server:** `<command>` (base URL: `<url>`, port: `<port>`)
- **Stop dev server:** `<command>` (must stop only what this run started)
- **Required services:** <db / cache / queue / object store — with the start command
  for each, or "none">
- **Already-running detection:** `<health-check command>` — how to tell the server is
  up before starting another one.
- **Env / port resolution:** `<command or file>` — the source of truth for ports and
  URLs. Do NOT hard-code a port table; read it here.

## 3. Auth

- **Test account(s):** <how to obtain — seeded, fixture, or a real login>
- **Seeding command:** `<command>` (or "n/a")
- **Per-surface status check:**
  - CLI: `<command>` — signed-in when <...>
  - Web: `<command>` — signed-in when <...>
  - Electron: `<command>` — signed-in when <...>

## 4. Surfaces

<For each surface that applies. Delete the ones that don't.>

### CLI

- Invocation: `<how the CLI is run — from source or built binary>`
- Auth: <see §3 CLI>
- Standalone install: `<command>` or "covered by root install"

### Web

- Launch: `<dev server command>` (from §2)
- Base URL: `<url>`
- agent-browser session: `<session name>`

### Electron

- Launch: `<start command>` — CDP port `<port>`
- Stop: `<command>`
- Login persistence: <how login survives across runs>

## 5. Project probes & quick navigation

- Auth probe: `<command>` → `{ isSignedIn, userId }`
- Route probe: `<command>` → current route
- Operations probe: `<command>` → running operations
- Quick navigation: `<command> goto <route>`
- Routes worth jumping to: <list>

## 6. Known constraints

- <e.g. "agent runs require the queue service (§2) up, or the run dies before any
  real work">
- <e.g. "the desktop and CLI packages are standalone — install inside each">
- <e.g. "OS-capture surfaces are macOS-only">
```

## First-run bootstrap (SKILL.md Step 0.5)

When `.agents/verify/PROJECT.md` is absent, build it before doing anything else:

1. **Explore the repo.** Read the signals that reveal how the project runs:
   `package.json` scripts, `README`, CI workflows (`.github/workflows/**`),
   `Makefile` / `Justfile`, `docker-compose*.yml` / `compose.yaml`, `.env.example`,
   and any existing test/dev docs. Note the dev-server command, the services it
   needs, the ports, the auth story, and which surfaces exist.
2. **Draft `PROJECT.md`** from the fixed skeleton above, filling every section from
   what you found. Where a value is uncertain, mark it explicitly as a guess rather
   than inventing a command.
3. **Present it for confirmation.** Show the draft to the user and ask them to
   confirm or correct it — especially the start/stop commands, the required
   services, and the auth path. Do not run a dev server or write test steps against
   an unconfirmed adapter.
4. **Write it only after approval**, to `.agents/verify/PROJECT.md`. Create
   `.agents/verify/` if it does not exist.

`install` (the CLI's `lh verify install`) only places the skill files; it does no repo
exploration. The adapter draft needs a model, so the first verification run is what
bootstraps `PROJECT.md`.

## Drift rule

Treat the adapter like a living log: when observed reality diverges from it during a
run (a port moved, a start command changed, a service is now required), **fix
`PROJECT.md` in place during the run** rather than working around it silently. The
next run should not rediscover the same divergence.

## Two living-log layers

The skill's `references/common-mistakes.md` and `references/probe-mock-patterns.md`
are the **generic layer** — product-independent, read-only in consumer repos,
updated only by PR to the CLI repo. The project's own
`.agents/verify/common-mistakes.md` and `.agents/verify/probe-mock-patterns.md` are
the **project layer** — writable, and the only place a run records project-specific
learnings. At runtime the agent reads both layers and writes only the project layer.
When a project-layer entry turns out to be product-independent, genericize it (drop
every project-specific noun) and PR it to the generic layer upstream.
