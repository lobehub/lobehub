# lobehub homelab deployment

This directory contains the [Pulumi](https://www.pulumi.com/) stack that deploys lobehub to the [homelab Kubernetes cluster](https://github.com/mrsimpson/homelab).

## What this deploys

- **lobehub** — the self-hosted LobeHub server, fronted by [oauth2-proxy](https://github.com/oauth2-proxy/oauth2-proxy) (GitHub OAuth)
- **postgres** — a single-replica `paradedb/paradedb:pg17` StatefulSet (Postgres 17 with pgvector + full-text-search extensions), backed by a Longhorn PVC. Lobehub needs pgvector, so a stock `postgres` image is not sufficient. Can be replaced by an external DB via the `lobehub:databaseUrl` config.
- Supporting Kubernetes resources: Namespace, Secrets, ExternalSecret (GHCR pull credentials), Cloudflare DNS CNAME for `lobehub.<domain>`, PersistentVolumeClaims for uploads and Postgres data

## Why this directory is at the repo root (not inside `packages/` or `apps/`)

The lobehub repo uses [pnpm](https://pnpm.io/) workspaces. Placing this Pulumi stack inside `packages/*` or `apps/*` would pull it into the workspace and create friction (Pulumi's Node resolver vs. pnpm's symlinked workspace, unwanted transitive deps, etc.).

Keeping this directory at `deployment/homelab/` (outside `pnpm-workspace.yaml`'s globs) means it is a plain npm package that npm, Node.js, and Pulumi can handle without modification. It is intentionally **not** part of the pnpm workspace.

## How it works

```
lobehub repo (this repo)           homelab repo
──────────────────────────         ──────────────────────
Dockerfile (upstream runtime)      ghcr.io/mrsimpson/lobehub
  └─ wrapped by             ────►   (built in CI from
deployment/homelab/images/lobehub/    images/lobehub/Dockerfile)

deployment/homelab/                github.com/mrsimpson/homelab
  src/index.ts  ─── reads ──────►  StackReference outputs (tunnelCname, zoneId, domain)
                ─── npm ──────────► @mrsimpson/homelab-core-components (npmjs.com)
                     │
                     └─ createHomelabContextFromStack()
                        ExposedWebApp (Deployment + Service + IngressRoutes + DNS)
```

The `deployment/homelab/` stack:

1. References the homelab base stack via [Pulumi StackReference](https://www.pulumi.com/docs/concepts/stack/#stackreferences) to get shared infrastructure facts (Cloudflare tunnel CNAME, zone ID, domain).
2. Uses [`@mrsimpson/homelab-core-components`](https://www.npmjs.com/package/@mrsimpson/homelab-core-components) to deploy the app as an `ExposedWebApp` (Traefik OAuth2-Proxy routes, Cloudflare DNS, Pod Security Standards).
3. Builds a fork-customised image on top of the upstream `lobehub/lobehub` image. Since upstream is `FROM scratch`, the wrapper Dockerfile can only `COPY` files and set `ENV` — it cannot run shell commands. Drop static overrides into `images/lobehub/config/`.

## Prerequisites

- [Pulumi CLI](https://www.pulumi.com/docs/install/)
- [Docker](https://docs.docker.com/get-docker/) with buildx (for local image builds)
- Node.js ≥ 24
- `PULUMI_ACCESS_TOKEN` — Pulumi Cloud token with access to the `mrsimpson` org
- `KUBECONFIG` — kubeconfig scoped to the homelab cluster
- `GITHUB_PAT` — GitHub PAT with `write:packages` scope (for pushing images to GHCR)

## Local development workflow

```bash
# First time: install dependencies
npm install

# See all available targets
make help

# Build the custom image locally
make build

# Build + push image to GHCR + deploy to cluster (full release cycle)
make release

# Or step by step:
make build-push   # build and push image
make deploy       # update Pulumi image config + pulumi up

# Dry-run: see what would change without applying
make preview

# Tear down everything
make destroy
```

The `deploy` target automatically updates the Pulumi stack config with the freshly built image tag before running `pulumi up`. Image tags follow the pattern `<package-version>-local.<git-sha>` (e.g. `2.1.50-local.a3f1c2d`).

## Pulumi stack config

Stack config lives in `Pulumi.dev.yaml`. Secrets are encrypted by Pulumi Cloud.

| Key                           | Description                                                                                 |
| ----------------------------- | ------------------------------------------------------------------------------------------- |
| `lobehub:lobehubImage`        | lobehub container image (tag updated by `make deploy` / CI)                                 |
| `lobehub:homelabStack`        | Pulumi StackReference to the homelab base stack                                             |
| `lobehub:storageSize`         | App PVC size for uploads (default `2Gi`)                                                    |
| `lobehub:databaseStorageSize` | Postgres PVC size (default `10Gi`)                                                          |
| `lobehub:databaseUrl`         | (optional) external Postgres URL — when set, the in-cluster Postgres is skipped. **secret** |
| `lobehub:authSecret`          | Better Auth session secret — **secret**, required                                           |
| `lobehub:keyVaultsSecret`     | Key-vaults encryption secret — **secret**, required                                         |
| `lobehub:openaiApiKey`        | (optional) OpenAI API key — **secret**                                                      |
| `lobehub:openrouterApiKey`    | (optional) OpenRouter API key — **secret**                                                  |
| `lobehub:anthropicApiKey`     | (optional) Anthropic API key — **secret**                                                   |
| `lobehub:authGoogleId`        | (optional) Google OAuth client ID — **secret**                                              |
| `lobehub:authGoogleSecret`    | (optional) Google OAuth client secret — **secret**                                          |

Minimal first-time setup:

```bash
pulumi stack init mrsimpson/lobehub/dev
pulumi config set lobehub:authSecret      "$(openssl rand -base64 32)" --secret
pulumi config set lobehub:keyVaultsSecret "$(openssl rand -base64 32)" --secret
# (DB password is auto-generated by @pulumi/random and retained across updates)
```

## CI/CD

Images are built and pushed automatically by GitHub Actions:

- [`build-lobehub-image.yml`](../../.github/workflows/build-lobehub-image.yml) — triggers on changes under `deployment/homelab/images/lobehub/` or when `.base-version` changes. Builds the fork image, pushes to GHCR, and updates `Pulumi.dev.yaml` with the new tag.
- [`deploy-homelab.yml`](../../.github/workflows/deploy-homelab.yml) — runs `pulumi up` after `Pulumi.dev.yaml` changes or an image build succeeds.
- [`fork-validate.yml`](../../.github/workflows/fork-validate.yml) — guard workflow. Fails any PR that modifies upstream-owned paths, so this fork stays conflict-free when pulling from upstream lobehub.

## Fork-owned vs upstream-owned paths

Only touch **fork-owned** paths from PRs targeting this fork. Upstream lobehub owns everything else; modifying it produces merge conflicts on the next upstream pull.

**Fork-owned:**

- `deployment/**`
- `.github/workflows/build-lobehub-image.yml`
- `.github/workflows/deploy-homelab.yml`
- `.github/workflows/fork-validate.yml`

If a change genuinely has to touch upstream files, branch from `upstream-merge/...` — the guard skips that prefix.

## Disabling upstream workflows

`fork-validate.yml` blocks *file-level* edits to upstream workflows, but the upstream workflows themselves will still *run* in this fork (usually failing on missing secrets, producing noise). To silence them without modifying any files (so no merge conflicts), disable them through the Actions API:

```bash
deployment/homelab/scripts/disable-upstream-workflows.sh
# or for a different fork:
deployment/homelab/scripts/disable-upstream-workflows.sh --repo other-org/lobehub-fork
```

The script is idempotent and leaves the three fork-owned workflows enabled. Disabled state persists across upstream merges; re-run after a large upstream pull if it introduced brand-new workflow files.

## Upstream base tracking

The upstream image tag is pinned in [`images/lobehub/.base-version`](./images/lobehub/.base-version). Bump it to adopt a new upstream release:

```bash
echo "2.1.50" > deployment/homelab/images/lobehub/.base-version
git commit -am "deploy: bump upstream lobehub base to 2.1.50"
```

Pushing to `canary` (this fork's default branch, matching upstream lobehub's convention) triggers the image build, which in turn triggers the deploy.

## Related

- [homelab repo](https://github.com/mrsimpson/homelab) — the base cluster infrastructure
- [`@mrsimpson/homelab-core-components`](https://www.npmjs.com/package/@mrsimpson/homelab-core-components) — the published Pulumi component library used by this stack
