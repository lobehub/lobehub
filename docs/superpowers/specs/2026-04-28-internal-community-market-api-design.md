# Internal Community Market API Design

Date: 2026-04-28
Branch: `feat/internal-community-market-api`
Status: approved for implementation planning

## Summary

Build an internal LobeHub-compatible Market/community API for self-hosted deployments. The Market API will be co-hosted with LobeHub through Docker Compose, backed by the same PostgreSQL service, and reached by the LobeHub server over the internal Compose network.

The first implementation targets broad community functionality: agents, agent groups, user profiles, social actions, skills, MCP/plugins, credentials, claims, and basic usage statistics. It does not implement standalone Market login or a full public OIDC provider in the first phase. Authentication is delegated to the hosted LobeHub instance through the existing trusted-client token mechanism.

Desktop users connect to the hosted LobeHub server. The desktop client does not authenticate directly with the Market service. LobeHub authenticates the user, generates `x-lobe-trust-token`, and calls the internal Market service on the user's behalf.

## Goals

- Let self-hosted LobeHub deployments publish, list, inspect, fork, favorite, like, and follow community resources without calling `https://market.lobehub.com`.
- Preserve compatibility with the current LobeHub code paths and `@lobehub/market-sdk@0.32.2` where practical.
- Support desktop clients that connect to the hosted Docker Compose deployment.
- Use trusted-client authentication as the canonical v1 auth model.
- Keep Market catalog data separate from private LobeHub workspace data.
- Make the first implementation testable through SDK-level API contract tests.

## Non-Goals

- Do not build a standalone public Market login page in v1.
- Do not implement authorization-code PKCE, refresh-token flows, desktop handoff, or full `/lobehub-oidc/auth` in v1.
- Do not make the Market service usable as an independent SaaS marketplace in v1.
- Do not reuse private workspace tables as the public Market catalog source of truth.
- Do not fully clone upstream moderation, ranking, anti-abuse, billing, or production analytics behavior.

## Current Integration Context

LobeHub uses `MARKET_BASE_URL` server-side to instantiate `MarketSDK` in `src/server/services/market/index.ts`. The SDK appends `/api` to the configured base URL, so an SDK call to `/v1/agents` becomes `${MARKET_BASE_URL}/api/v1/agents`.

Some LobeHub routes also make direct fetches to `${MARKET_BASE_URL}/api/v1/...` for endpoints not fully wrapped by the SDK, including fork metadata, group status actions, claims, and credential file upload.

The existing LobeHub app already owns `/api/v1/*` for its OpenAPI server. Therefore the internal Market API must not be mounted at the same public root inside the LobeHub Next app unless the path is carefully isolated. A companion service with its own base URL is the safest design.

## Architecture Decision

Create a companion service named `apps/market`.

The service will expose a Market-compatible HTTP API using Hono on Node. It will import shared database schema and connection utilities from the monorepo where appropriate. It will run as a separate Docker Compose service on the same network as `lobe` and `postgresql`.

Recommended runtime topology:

```text
Desktop client or browser
  -> hosted LobeHub web/desktop server endpoint
    -> LobeHub authenticated tRPC / route handlers
      -> internal Market service over Compose network
        -> PostgreSQL market_* tables
```

Environment configuration on the `lobe` service:

```text
MARKET_BASE_URL=http://market:3211
MARKET_TRUSTED_CLIENT_ID=<shared-client-id>
MARKET_TRUSTED_CLIENT_SECRET=<shared-secret>
```

Environment configuration on the `market` service:

```text
DATABASE_URL=postgresql://postgres:<password>@postgresql:5432/<db>
MARKET_PUBLIC_BASE_URL=<hosted LobeHub origin>/market-api
MARKET_TRUSTED_CLIENT_ID=<same-shared-client-id>
MARKET_TRUSTED_CLIENT_SECRET=<same-shared-secret>
```

`MARKET_PUBLIC_BASE_URL` is used when the Market service needs to return browser-visible URLs, such as skill ZIP downloads or plugin assets. V1 should expose those URLs through a LobeHub proxy path at `/market-api/*`. In a Compose-only deployment, internal Docker hostnames are not browser-visible, and relying on a separate external reverse proxy would make the default self-hosting path harder to operate.

## Alternatives Considered

### Companion Market Service

This is the recommended approach. It avoids path conflicts with LobeHub's existing `/api/v1/*` OpenAPI routes, keeps Market code isolated, and matches the deployment boundary of a broad community API.

Trade-offs:

- Adds one Compose service and one app package.
- Requires shared database access and migration coordination.
- Requires a LobeHub `/market-api/*` proxy for browser-visible Market downloads.

### In-Process Next Routes

This would implement Market endpoints inside the existing LobeHub Next app. It has simpler deployment but higher coupling. It also has an immediate path conflict because `@lobehub/market-sdk` expects `${MARKET_BASE_URL}/api/v1/*`, while LobeHub already uses `/api/v1/*` for OpenAPI.

Trade-offs:

- Fewer containers.
- Harder route isolation.
- Higher risk of bloating the main app with marketplace-specific storage, auth, and public API logic.

### Standalone Full Market Clone

This would implement trusted auth, OIDC, M2M, standalone login, and full public marketplace behavior from the start. It maximizes external compatibility but is too large for the co-hosted Docker Compose use case.

Trade-offs:

- Best long-term external compatibility.
- Highest implementation cost.
- Duplicates authentication flows that are unnecessary when Market is co-hosted with LobeHub.

## Authentication Design

V1 uses trusted-client authentication.

LobeHub already generates trusted-client tokens with `@lobehub/market-sdk` helpers. The token is passed as `x-lobe-trust-token`. The Market service verifies that token with `MARKET_TRUSTED_CLIENT_SECRET`, checks that the embedded `clientId` matches `MARKET_TRUSTED_CLIENT_ID`, and extracts the LobeHub user identity.

Trusted token payload fields:

- `clientId`: trusted client identifier.
- `userId`: LobeHub user id.
- `email`: user email.
- `name`: user display name.
- `timestamp`: token creation timestamp.
- `nonce`: random nonce.

The Market service auto-provisions a `market_accounts` row for the trusted user if one does not exist. The Market account has its own numeric `accountId`, because current LobeHub code compares Market ownership using Market account ids, not local LobeHub user ids.

Required auth behavior:

- Endpoints that mutate user-owned resources require a valid trusted token.
- Public list/detail endpoints can be called without auth.
- Social status endpoints should return unauthenticated defaults where LobeHub currently tolerates missing auth, such as `isLiked: false`, `isFavorited: false`, or `isFollowing: false`.
- `/lobehub-oidc/userinfo` must support `GET` with `x-lobe-trust-token` and return the Market user shape expected by LobeHub.

Intentionally omitted in v1:

- `/lobehub-oidc/auth`
- `/lobehub-oidc/token` authorization-code and refresh-token flows
- `/lobehub-oidc/handoff`
- `/oauth/token` client-credentials exchange
- `/api/v1/clients/register`

For compatibility, omitted endpoints should return explicit `501 not_implemented` JSON instead of ambiguous 404s when they are hit.

## Data Model

Add new Market-specific tables. Existing LobeHub workspace tables remain private workspace state and are not used as the Market catalog source of truth.

Core account tables:

- `market_accounts`: numeric account id, linked LobeHub user id, email, display name, username, namespace, avatar URL, profile metadata, counters, timestamps.
- `market_trusted_clients`: optional table for future multiple trusted clients; v1 can read a single client from env.

Agent catalog tables:

- `market_agents`: identifier, owner account id, status, visibility, homepage, featured/official flags, current version id, fork source id, counters, timestamps.
- `market_agent_versions`: agent id, version string, version number, name, avatar, category, description, summary, config, editor data, tags, skills, protocol metadata, validation status, timestamps.
- `market_agent_events`: account id, agent id, event type, source, timestamps.

Agent group catalog tables:

- `market_agent_groups`: identifier, owner account id, status, visibility, homepage, featured/official flags, current version id, fork source id, counters, timestamps.
- `market_agent_group_versions`: group id, version string, version number, name, avatar, background color, category, description, config, tags, timestamps.
- `market_agent_group_members`: group version id, member identifier, role, display order, enabled flag, config and A2A metadata copied from the publish payload.

Plugin and skill catalog tables:

- `market_plugins`: identifier, owner account id, status, visibility, category, metadata, counters, timestamps.
- `market_plugin_versions`: plugin id, version, manifest, readme/overview, deployment options, tools, prompts, resources, timestamps.
- `market_skills`: identifier, owner account id, status, visibility, category, metadata, counters, timestamps.
- `market_skill_versions`: skill id, version, manifest, content, resources, artifact metadata, timestamps.

Social tables:

- `market_follows`: follower account id, following account id, timestamps.
- `market_favorites`: account id, target type, target id or identifier, timestamps.
- `market_likes`: account id, target type, target id or identifier, timestamps.

Credential tables:

- `market_credentials`: account id, key, name, description, credential type, encrypted payload, file hash id, OAuth connection id, timestamps.
- `market_credential_files`: file hash id, owner account id, file name, MIME type, byte size, storage path or inline encrypted blob, timestamps.
- `market_oauth_connections`: account id, provider id, provider name, external account metadata, encrypted token payload, timestamps.

Claim and analytics tables:

- `market_claims`: account id, asset type, asset id, claim status, timestamps.
- `market_submitted_repositories`: account id, type, git URL, branch, import status, message, timestamps.
- `market_install_events`: target type, target id, account id, success flag, version, platform metadata, timestamps.
- `market_call_events`: plugin or skill id, account id, method metadata, success flag, duration, timestamps.
- Aggregate counters may be stored on catalog tables and updated transactionally for v1.

## API Compatibility Surface

All SDK-compatible endpoints live under `/api/v1` on the Market service.

### Agents

- `GET /api/v1/agents`
- `GET /api/v1/agents/own`
- `GET /api/v1/agents/detail/:identifier`
- `GET /api/v1/agents/identifiers`
- `GET /api/v1/agents/categories`
- `GET /api/v1/agents/by-plugin`
- `POST /api/v1/agents/create`
- `POST /api/v1/agents/modify`
- `POST /api/v1/agents/version/create`
- `POST /api/v1/agents/version/modify`
- `POST /api/v1/agents/events`
- `POST /api/v1/agents/install-count`
- `POST /api/v1/agents/:sourceIdentifier/fork`
- `GET /api/v1/agents/:identifier/forks`
- `GET /api/v1/agents/:identifier/fork-source`

Status changes use `POST /api/v1/agents/modify` because the SDK's `publish`, `unpublish`, `archive`, and `deprecate` helpers call `modifyAgent({ identifier, status })`.

### Agent Groups

- `GET /api/v1/agent-groups`
- `GET /api/v1/agent-groups/list`
- `GET /api/v1/agent-groups/own`
- `GET /api/v1/agent-groups/detail`
- `GET /api/v1/agent-groups/identifiers`
- `GET /api/v1/agent-groups/categories`
- `POST /api/v1/agent-groups/create`
- `POST /api/v1/agent-groups/modify`
- `POST /api/v1/agent-groups/version-create`
- `POST /api/v1/agent-groups/:identifier/publish`
- `POST /api/v1/agent-groups/:identifier/unpublish`
- `POST /api/v1/agent-groups/:identifier/deprecate`
- `POST /api/v1/agent-groups/:sourceIdentifier/fork`
- `GET /api/v1/agent-groups/:identifier/forks`
- `GET /api/v1/agent-groups/:identifier/fork-source`

Both `/agent-groups` and `/agent-groups/list` should be supported because current LobeHub code uses both SDK and direct-fetch paths.

### Users and Social

- `GET /api/v1/user/info/:idOrUserName`
- `POST /api/v1/user/update`
- `POST /api/v1/user/register`
- `POST /api/v1/user/follows`
- `DELETE /api/v1/user/follows`
- `GET /api/v1/user/follows/check`
- `GET /api/v1/user/follows/:userId/following`
- `GET /api/v1/user/follows/:userId/followers`
- `POST /api/v1/user/favorites`
- `DELETE /api/v1/user/favorites`
- `GET /api/v1/user/favorites/check`
- `GET /api/v1/user/favorites/me`
- `GET /api/v1/user/favorites/:userId`
- `GET /api/v1/user/favorites/:userId/agents`
- `GET /api/v1/user/favorites/:userId/plugins`
- `POST /api/v1/user/likes`
- `DELETE /api/v1/user/likes`
- `POST /api/v1/user/likes/toggle`
- `GET /api/v1/user/likes/check`
- `GET /api/v1/user/likes/:userId/agents`
- `GET /api/v1/user/likes/:userId/plugins`
- `GET /api/v1/user/claims/scan`
- `POST /api/v1/user/claims`
- `POST /api/v1/user/claims/submit-repo`

Favorite and like endpoints must accept target identifiers as well as numeric ids because current LobeHub code passes both.

### Skills

- `GET /api/v1/skills`
- `GET /api/v1/skills/categories`
- `GET /api/v1/skills/identifiers`
- `GET /api/v1/skills/:identifier`
- `GET /api/v1/skills/:identifier/download`
- `GET /api/v1/skills/:identifier/versions`
- `GET /api/v1/skills/:identifier/versions/:version`
- `GET /api/v1/skills/:identifier/creds/status`
- `POST /api/v1/skills/report/github`
- `POST /api/v1/skills/report/installation`

The list endpoint should accept both `q` and `query` as search parameters because SDK types and current LobeHub calls differ.

### MCP and Plugins

- `GET /api/v1/plugins`
- `GET /api/v1/plugins/categories`
- `GET /api/v1/plugins/identifiers`
- `GET /api/v1/plugins/:identifier`
- `GET /api/v1/plugins/:identifier/manifest`
- `POST /api/v1/plugins/events`
- `POST /api/v1/plugins/report/installation`
- `POST /api/v1/plugins/report/call`
- `POST /api/v1/plugins/cloud-gateway`
- `POST /api/v1/plugins/run-buildin-tools`
- `POST /api/v1/plugins/run-buildin-tools/inject-creds`
- `POST /api/v1/plugins/run-buildin-tools/inject-creds-for-skill`

Cloud gateway and built-in tool execution can return explicit unsupported responses for remote execution features that are not available in a self-hosted v1 environment. The response should be structured JSON and should not crash LobeHub clients.

### Credentials

- `GET /api/v1/user/creds`
- `GET /api/v1/user/creds/:id`
- `POST /api/v1/user/creds/kv`
- `POST /api/v1/user/creds/oauth`
- `POST /api/v1/user/creds/file`
- `POST /api/v1/user/creds/upload`
- `PATCH /api/v1/user/creds/:id`
- `DELETE /api/v1/user/creds/:id`
- `DELETE /api/v1/user/creds/key/:key`

Credential values must be encrypted at rest. Injection endpoints return only the fields required by runtime callers and must preserve the sandbox behavior that `kv-header` credentials are unsupported in sandbox mode.

## Response and Error Conventions

Use JSON for all normal API responses and errors.

Error response shape:

```json
{
  "error": {
    "code": "not_found",
    "message": "Resource not found"
  }
}
```

The SDK's `MarketAPIError` understands both nested object errors and string errors, so this shape is compatible and more descriptive.

Recommended status behavior:

- `400` for invalid input.
- `401` for missing or invalid trusted auth on protected endpoints.
- `403` for authenticated users who do not own a resource.
- `404` for missing resources.
- `409` for duplicate identifiers, duplicate usernames, or already-existing social rows when idempotency is not used.
- `501` for explicit compatibility stubs.

Where current UI expects idempotent behavior, prefer returning success for repeated social actions rather than surfacing conflicts.

## Key Data Flows

### Publish Agent

1. User clicks publish in web or desktop client.
2. LobeHub tRPC route authenticates the LobeHub user.
3. LobeHub creates `x-lobe-trust-token` and calls Market.
4. Market verifies trusted token and resolves or creates `market_accounts`.
5. If the identifier exists and belongs to the account, Market creates a new version.
6. If the identifier is missing or owned by someone else, LobeHub generates a new identifier and Market creates a new agent plus version.
7. Market returns `{ identifier, success }` through the existing LobeHub router flow.

### List and Detail

1. LobeHub `DiscoverService` calls `MarketSDK` using `MARKET_BASE_URL=http://market:3211`.
2. Market returns SDK-compatible paginated responses.
3. LobeHub transforms Market items into Discover UI item shapes.
4. Desktop and browser clients receive the same tRPC responses from the hosted LobeHub server.

### Fork Agent or Group

1. User clicks fork/import.
2. LobeHub calls Market fork endpoint with trusted auth.
3. Market copies the source catalog record and current version into a new owner-scoped record.
4. Market records fork source metadata and returns the SDK-compatible fork response.
5. LobeHub creates local workspace state from the Market detail or fork response.

### Credential Injection

1. User creates credential entries in LobeHub settings.
2. LobeHub routes call Market credential endpoints with trusted auth.
3. Market encrypts credential values at rest.
4. During tool execution, LobeHub asks Market to inject credentials for explicit keys or a skill identifier.
5. Market returns scoped env/file/header payloads, excluding unsupported sandbox entries.

## Security Considerations

- Trusted tokens must be verified server-side only. The shared secret must never be sent to the browser or desktop renderer.
- Trusted token timestamps should have a short acceptance window to reduce replay risk. A 5 minute default is appropriate for server-to-server calls.
- The Market service should only trust configured `MARKET_TRUSTED_CLIENT_ID` values.
- Credential values and uploaded credential files must be encrypted at rest with a deployment secret distinct from the trusted-client secret.
- Resource ownership checks must use `market_accounts.id` and must be enforced on all update, status, fork-to-owned-resource, credential, and claim operations.
- Public list/detail endpoints must filter private resources unless the authenticated owner is requesting their own resources through `own` endpoints.
- Direct Docker network access to the Market service should not be exposed publicly by default.

## Deployment Design

Add a Compose service:

```yaml
market:
  build:
    context: ../..
    dockerfile: apps/market/Dockerfile
  environment:
    - DATABASE_URL=postgresql://postgres:${POSTGRES_PASSWORD}@postgresql:5432/${LOBE_DB_NAME}
    - MARKET_TRUSTED_CLIENT_ID=${MARKET_TRUSTED_CLIENT_ID}
    - MARKET_TRUSTED_CLIENT_SECRET=${MARKET_TRUSTED_CLIENT_SECRET}
    - MARKET_PUBLIC_BASE_URL=${MARKET_PUBLIC_BASE_URL}
  depends_on:
    postgresql:
      condition: service_healthy
  networks:
    - lobe-network
```

Update `lobe` environment:

```yaml
- MARKET_BASE_URL=http://market:3211
- MARKET_TRUSTED_CLIENT_ID=${MARKET_TRUSTED_CLIENT_ID}
- MARKET_TRUSTED_CLIENT_SECRET=${MARKET_TRUSTED_CLIENT_SECRET}
```

Browser-visible downloads should route through a LobeHub proxy endpoint at `/market-api/*`. The LobeHub server proxies those requests to `http://market:3211/*` over the Compose network, preserving the browser-visible hosted LobeHub origin while avoiding public exposure of the Market container.

## Rollout Phases

### Phase 1: Foundation and Agents

- Create `apps/market` service skeleton.
- Add trusted-token verification and account auto-provisioning.
- Add core market account, agent, agent version, event, and counter tables.
- Implement agent list/detail/create/version/status/fork endpoints.
- Add SDK contract tests for agents.

### Phase 2: Agent Groups and User Profiles

- Add group tables and endpoints.
- Implement user profile read/update/register behavior.
- Implement `/lobehub-oidc/userinfo` for trusted-client auth.
- Add group and user profile contract tests.

### Phase 3: Social Graph

- Add follow, favorite, and like tables.
- Implement status, list, add, remove, and toggle endpoints.
- Ensure identifier and numeric target ids are both accepted.

### Phase 4: Skills, MCP, Claims, and Downloads

- Add skill/plugin catalog tables and read endpoints.
- Implement claims scan, claim, and submit repository endpoints.
- Implement skill download strategy using the LobeHub `/market-api/*` proxy approach.
- Return explicit unsupported responses for remote execution paths that cannot run in self-hosted v1.

### Phase 5: Credentials

- Add encrypted credential storage.
- Implement KV, file, and OAuth credential endpoints.
- Implement credential upload and injection responses.
- Add encryption and sandbox behavior tests.

## Testing Strategy

- Unit test trusted-client token verification, timestamp checks, and account provisioning.
- Unit test identifier uniqueness and ownership checks.
- Add API contract tests that instantiate `MarketSDK` with the local Market base URL and call each supported endpoint group.
- Add integration tests for publish/list/detail/fork flows through the LobeHub tRPC routers where practical.
- Add credential encryption and injection tests that verify plaintext values are never returned from list endpoints.
- Add Docker Compose smoke documentation for starting `postgresql`, `lobe`, and `market` together.

Do not run the full repository test suite as part of routine development. Use targeted Vitest files and type checks according to `AGENTS.md`.

## Compatibility Risks

- The upstream Market API is private, so this design is derived from LobeHub call sites and the installed SDK package.
- SDK list and status response shapes sometimes differ from what LobeHub normalizes in client services. The implementation should prefer accepting extra fields and returning superset shapes.
- Skill search uses both `q` and `query` naming across types and app code. The Market service must accept both.
- The installed SDK package version is `0.32.2`, but its bundled runtime reports `SDK_VERSION = "0.31.3"`. Contract tests should lock behavior to actual calls, not the reported version string.
- Some group and skill helper methods are optional or marked as fallback in current code. Unsupported endpoints should return predictable empty responses or `501` depending on whether the UI treats them as optional.

## Acceptance Criteria

- Self-hosted LobeHub can run with `MARKET_BASE_URL` pointing to the co-hosted Market service and no requests to `https://market.lobehub.com` for broad community flows covered by this spec.
- Desktop clients connected to the hosted LobeHub server can publish, browse, fork, favorite, like, and follow using the hosted server's authenticated session.
- Market accounts are auto-provisioned from trusted LobeHub users and have stable numeric account ids.
- Agent and group resources support versioned publishing and ownership checks.
- Public catalog reads hide private resources from non-owners.
- Credential values are encrypted at rest and are only returned through scoped injection endpoints.
- Unsupported v1 compatibility endpoints fail explicitly with descriptive JSON rather than ambiguous network or parsing failures.
