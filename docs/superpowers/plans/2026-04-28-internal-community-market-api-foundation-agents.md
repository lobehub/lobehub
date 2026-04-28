# Internal Community Market API Foundation and Agents Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first executable internal Market service slice: a co-hosted Hono service with trusted-client auth, Market account provisioning, and SDK-compatible agent catalog endpoints.

**Architecture:** Add a new `apps/market` service that runs beside LobeHub in Docker Compose and talks to the shared PostgreSQL database. Add `market_*` schema tables for accounts and agents, expose `/lobehub-oidc/userinfo` plus `/api/v1/agents*`, and keep the LobeHub app pointed at the service through `MARKET_BASE_URL=http://market:3211`. Browser-visible Market assets will later go through LobeHub's `/market-api/*` proxy, but this plan only creates the proxy shell and agent-compatible backend.

**Tech Stack:** TypeScript, Hono, Drizzle ORM, PostgreSQL, `@lobehub/market-sdk`, Vitest, Docker Compose, pnpm/bun scripts.

---

## Scope Check

The approved spec covers multiple independent subsystems: agents, groups, social, skills/MCP, credentials, claims, and analytics. This plan intentionally implements the foundation and agents only. Write separate follow-up plans for these remaining slices after this plan lands:

- Agent groups and user profiles.
- Social graph and claims.
- Skills, MCP/plugins, and download artifacts.
- Credentials and injection.

This plan leaves those endpoints returning explicit compatibility errors or empty optional responses only where needed for the agent slice to run without surprising callers.

## File Structure

Create or modify these files:

- Modify `package.json` to add scripts for the Market service.
- Modify `pnpm-workspace.yaml` to add `apps/market` to the pnpm workspace list.
- Create `apps/market/package.json` for service-local scripts and dependencies.
- Create `apps/market/tsconfig.json` for strict TypeScript compilation.
- Create `apps/market/src/index.ts` as the Node entrypoint.
- Create `apps/market/src/app.ts` to assemble the Hono app and register routes.
- Create `apps/market/src/env.ts` to parse runtime configuration.
- Create `apps/market/src/db.ts` to create the Drizzle database connection.
- Create `apps/market/src/http/errors.ts` for consistent JSON error responses.
- Create `apps/market/src/http/context.ts` for Hono context accessors.
- Create `apps/market/src/http/auth.ts` for trusted-client token verification and account lookup.
- Create `apps/market/src/http/routes/health.ts` for service readiness.
- Create `apps/market/src/http/routes/oidc.ts` for `/lobehub-oidc/userinfo`.
- Create `apps/market/src/http/routes/agents.ts` for SDK-compatible agent endpoints.
- Create `apps/market/src/models/account.ts` for Market account persistence.
- Create `apps/market/src/models/agent.ts` for agent catalog persistence.
- Create `apps/market/src/services/agents.ts` for agent business operations and response shaping.
- Create `apps/market/src/types.ts` for shared service-local TypeScript types.
- Create `apps/market/src/test-utils.ts` for Hono request and trusted-token test helpers.
- Create `apps/market/src/**/*.test.ts` tests for auth, accounts, agents, and SDK compatibility.
- Create `packages/database/src/schemas/market.ts` for `market_accounts`, `market_agents`, `market_agent_versions`, and `market_agent_events`.
- Modify `packages/database/src/schemas/index.ts` to export `market.ts`.
- Create `packages/database/migrations/0100_add_market_account_agent_tables.sql` after schema work.
- Modify `packages/database/migrations/meta/_journal.json`, `packages/database/migrations/meta/0100_snapshot.json`, `packages/database/src/core/migrations.json`, and `docs/development/database-schema.dbml` through `bun run db:generate`.
- Modify `docker-compose/deploy/docker-compose.yml` to add the `market` service and wire `lobe` env vars.
- Modify `docker-compose/dev/docker-compose.yml` only if local Compose smoke testing needs the Market service during implementation.
- Create `src/app/(backend)/market-api/[[...segments]]/route.ts` as the public LobeHub proxy shell for future browser-visible Market assets.

## Task 1: Scaffold the Market Service Package

**Files:**

- Modify: `package.json`

- Modify: `pnpm-workspace.yaml`

- Create: `apps/market/package.json`

- Create: `apps/market/tsconfig.json`

- Create: `apps/market/src/index.ts`

- Create: `apps/market/src/app.ts`

- Create: `apps/market/src/env.ts`

- Create: `apps/market/src/http/errors.ts`

- Create: `apps/market/src/http/routes/health.ts`

- Test: `apps/market/src/app.test.ts`

- [ ] **Step 1: Add Market scripts in `package.json`**

Add these scripts next to the other development scripts. Keep all existing scripts unchanged:

```json
{
  "scripts": {
    "dev:market": "pnpm --filter @lobechat/market dev",
    "market:type-check": "pnpm --filter @lobechat/market type-check",
    "market:test": "pnpm --filter @lobechat/market test"
  }
}
```

- [ ] **Step 2: Add the pnpm workspace entry**

Modify `pnpm-workspace.yaml` so the `packages` list includes `apps/market`:

```yaml
packages:
  - packages/**
  - .
  - e2e
  - apps/desktop/src/main
  - apps/market
```

- [ ] **Step 3: Create `apps/market/package.json`**

```json
{
  "name": "@lobechat/market",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "start": "tsx src/index.ts",
    "test": "vitest run --silent='passed-only'",
    "type-check": "tsc --noEmit"
  },
  "dependencies": {
    "@hono/node-server": "^1.14.4",
    "@lobechat/database": "workspace:*",
    "@lobehub/market-sdk": "0.32.2",
    "drizzle-orm": "^0.45.1",
    "hono": "^4.11.1",
    "pg": "^8.17.2",
    "zod": "^3.25.76"
  },
  "devDependencies": {
    "@types/pg": "^8.16.0",
    "tsx": "^4.21.0",
    "typescript": "^5.9.3",
    "vitest": "^3.2.4"
  }
}
```

- [ ] **Step 4: Create `apps/market/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "lib": ["ESNext"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "noEmit": true,
    "paths": {
      "@/*": ["./src/*"],
      "@/database/*": ["../../packages/database/src/*"]
    },
    "strict": true,
    "target": "ESNext",
    "types": ["node", "vitest/globals"]
  },
  "include": ["src/**/*.ts"]
}
```

- [ ] **Step 5: Create `apps/market/src/env.ts`**

```ts
import { z } from 'zod';

const EnvSchema = z.object({
  DATABASE_URL: z.string().min(1),
  MARKET_BASE_URL: z.string().url().optional(),
  MARKET_PORT: z.coerce.number().int().positive().default(3211),
  MARKET_PUBLIC_BASE_URL: z.string().url().optional(),
  MARKET_TRUSTED_CLIENT_ID: z.string().min(1),
  MARKET_TRUSTED_CLIENT_SECRET: z.string().min(1),
});

export type MarketEnv = z.infer<typeof EnvSchema>;

export const loadEnv = (source: NodeJS.ProcessEnv = process.env): MarketEnv => {
  const result = EnvSchema.safeParse(source);

  if (!result.success) {
    const message = result.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid Market environment: ${message}`);
  }

  return result.data;
};
```

- [ ] **Step 6: Create `apps/market/src/http/errors.ts`**

```ts
import type { Context } from 'hono';

export class MarketHttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'MarketHttpError';
  }
}

export const jsonError = (c: Context, status: number, code: string, message: string) =>
  c.json(
    {
      error: {
        code,
        message,
      },
    },
    status as never,
  );

export const notImplemented = (c: Context, endpoint: string) =>
  jsonError(c, 501, 'not_implemented', `${endpoint} is not implemented in the internal Market v1 service.`);
```

- [ ] **Step 7: Create `apps/market/src/http/routes/health.ts`**

```ts
import { Hono } from 'hono';

export const createHealthRoutes = () => {
  const app = new Hono();

  app.get('/health', (c) =>
    c.json({
      service: 'lobehub-internal-market',
      status: 'ok',
    }),
  );

  return app;
};
```

- [ ] **Step 8: Create `apps/market/src/app.ts`**

```ts
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';

import { MarketHttpError, jsonError, notImplemented } from './http/errors';
import { createHealthRoutes } from './http/routes/health';

export const createMarketApp = () => {
  const app = new Hono();

  app.use('*', cors());
  app.use('*', logger());

  app.route('/', createHealthRoutes());

  app.all('/lobehub-oidc/auth', (c) => notImplemented(c, '/lobehub-oidc/auth'));
  app.all('/lobehub-oidc/token', (c) => notImplemented(c, '/lobehub-oidc/token'));
  app.all('/lobehub-oidc/handoff', (c) => notImplemented(c, '/lobehub-oidc/handoff'));
  app.all('/oauth/token', (c) => notImplemented(c, '/oauth/token'));
  app.all('/api/v1/clients/register', (c) => notImplemented(c, '/api/v1/clients/register'));

  app.notFound((c) => jsonError(c, 404, 'not_found', 'Requested Market endpoint was not found.'));

  app.onError((error, c) => {
    if (error instanceof MarketHttpError) {
      return jsonError(c, error.status, error.code, error.message);
    }

    console.error('[market] unhandled error:', error);
    return jsonError(c, 500, 'internal_error', 'Internal Market service error.');
  });

  return app;
};
```

- [ ] **Step 9: Create `apps/market/src/index.ts`**

```ts
import { serve } from '@hono/node-server';

import { createMarketApp } from './app';
import { loadEnv } from './env';

const env = loadEnv();
const app = createMarketApp();

serve(
  {
    fetch: app.fetch,
    port: env.MARKET_PORT,
  },
  (info) => {
    console.info(`[market] listening on http://localhost:${info.port}`);
  },
);
```

- [ ] **Step 10: Create `apps/market/src/app.test.ts`**

```ts
import { describe, expect, it } from 'vitest';

import { createMarketApp } from './app';

describe('createMarketApp', () => {
  it('returns health status', async () => {
    const app = createMarketApp();

    const response = await app.request('/health');

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      service: 'lobehub-internal-market',
      status: 'ok',
    });
  });

  it('returns explicit not implemented for omitted OIDC endpoints', async () => {
    const app = createMarketApp();

    const response = await app.request('/lobehub-oidc/auth');

    expect(response.status).toBe(501);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: 'not_implemented',
        message: '/lobehub-oidc/auth is not implemented in the internal Market v1 service.',
      },
    });
  });
});
```

- [ ] **Step 11: Run the scaffold tests**

Run: `pnpm install`

Expected: `pnpm-lock.yaml` is updated to include `apps/market` dependencies and the new workspace package.

Run: `pnpm --filter @lobechat/market test -- app.test.ts`

Expected: the health and not-implemented tests pass.

- [ ] **Step 12: Commit the service scaffold**

```bash
git add package.json pnpm-workspace.yaml pnpm-lock.yaml apps/market
git commit -m "✨ feat(market): scaffold internal Market service"
```

## Task 2: Add Market Account and Agent Database Schema

**Files:**

- Create: `packages/database/src/schemas/market.ts`

- Modify: `packages/database/src/schemas/index.ts`

- Create: `packages/database/src/models/__tests__/marketSchema.test.ts`

- Create: `packages/database/migrations/0100_add_market_account_agent_tables.sql`

- Modify: `packages/database/migrations/meta/_journal.json`

- Create: `packages/database/migrations/meta/0100_snapshot.json`

- Modify: `packages/database/src/core/migrations.json`

- Modify: `docs/development/database-schema.dbml`

- [ ] **Step 1: Create a schema test that proves tables are exported**

Create `packages/database/src/models/__tests__/marketSchema.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import {
  marketAccounts,
  marketAgentEvents,
  marketAgentVersions,
  marketAgents,
} from '../../schemas';

describe('market schema exports', () => {
  it('exports account and agent tables', () => {
    expect(marketAccounts).toBeDefined();
    expect(marketAgents).toBeDefined();
    expect(marketAgentVersions).toBeDefined();
    expect(marketAgentEvents).toBeDefined();
  });
});
```

- [ ] **Step 2: Run the schema export test and verify it fails**

Run: `bunx vitest run --silent='passed-only' packages/database/src/models/__tests__/marketSchema.test.ts`

Expected: FAIL because `marketAccounts`, `marketAgents`, `marketAgentVersions`, and `marketAgentEvents` are not exported yet.

- [ ] **Step 3: Create `packages/database/src/schemas/market.ts`**

```ts
import { boolean, index, integer, jsonb, pgTable, serial, text, uniqueIndex, varchar } from 'drizzle-orm/pg-core';

import { timestamps } from './_helpers';

export const marketAccounts = pgTable(
  'market_accounts',
  {
    id: serial('id').primaryKey(),
    lobeUserId: text('lobe_user_id').notNull(),
    email: text('email').notNull(),
    displayName: text('display_name'),
    userName: varchar('user_name', { length: 100 }),
    namespace: varchar('namespace', { length: 100 }).notNull(),
    avatarUrl: text('avatar_url'),
    meta: jsonb('meta').$type<Record<string, unknown>>().default({}),
    followerCount: integer('follower_count').notNull().default(0),
    followingCount: integer('following_count').notNull().default(0),
    type: text('type').notNull().default('user'),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('market_accounts_lobe_user_id_unique').on(table.lobeUserId),
    uniqueIndex('market_accounts_email_unique').on(table.email),
    uniqueIndex('market_accounts_namespace_unique').on(table.namespace),
    uniqueIndex('market_accounts_user_name_unique').on(table.userName),
  ],
);

export const marketAgents = pgTable(
  'market_agents',
  {
    id: serial('id').primaryKey(),
    identifier: varchar('identifier', { length: 128 }).notNull(),
    ownerId: integer('owner_id')
      .references(() => marketAccounts.id, { onDelete: 'cascade' })
      .notNull(),
    name: text('name').notNull(),
    homepage: text('homepage'),
    status: text('status', { enum: ['published', 'unpublished', 'archived', 'deprecated'] })
      .notNull()
      .default('unpublished'),
    visibility: text('visibility', { enum: ['public', 'private', 'internal'] })
      .notNull()
      .default('public'),
    currentVersionId: integer('current_version_id'),
    forkedFromAgentId: integer('forked_from_agent_id'),
    isFeatured: boolean('is_featured').notNull().default(false),
    isOfficial: boolean('is_official').notNull().default(false),
    installCount: integer('install_count').notNull().default(0),
    forkCount: integer('fork_count').notNull().default(0),
    likeCount: integer('like_count').notNull().default(0),
    favoriteCount: integer('favorite_count').notNull().default(0),
    ratingCount: integer('rating_count').notNull().default(0),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('market_agents_identifier_unique').on(table.identifier),
    index('market_agents_owner_id_idx').on(table.ownerId),
    index('market_agents_status_visibility_idx').on(table.status, table.visibility),
  ],
);

export const marketAgentVersions = pgTable(
  'market_agent_versions',
  {
    id: serial('id').primaryKey(),
    agentId: integer('agent_id')
      .references(() => marketAgents.id, { onDelete: 'cascade' })
      .notNull(),
    version: varchar('version', { length: 64 }).notNull().default('1.0.0'),
    versionNumber: integer('version_number').notNull(),
    isLatest: boolean('is_latest').notNull().default(true),
    isValidated: boolean('is_validated').notNull().default(false),
    a2aProtocolVersion: text('a2a_protocol_version'),
    avatar: text('avatar'),
    category: text('category'),
    changelog: text('changelog'),
    config: jsonb('config').$type<Record<string, unknown>>().default({}),
    defaultInputModes: text('default_input_modes').array().default([]),
    defaultOutputModes: text('default_output_modes').array().default([]),
    description: text('description').notNull().default(''),
    documentationUrl: text('documentation_url'),
    editorData: jsonb('editor_data').$type<Record<string, unknown>>().default({}),
    extensions: jsonb('extensions').$type<Array<Record<string, unknown>>>().default([]),
    hasPushNotifications: boolean('has_push_notifications').default(false),
    hasStateTransitionHistory: boolean('has_state_transition_history').default(false),
    hasStreaming: boolean('has_streaming').default(false),
    interfaces: jsonb('interfaces').$type<Array<Record<string, unknown>>>().default([]),
    name: text('name').notNull(),
    preferredTransport: text('preferred_transport'),
    securityRequirements: jsonb('security_requirements')
      .$type<Array<Record<string, unknown>>>()
      .default([]),
    securitySchemes: jsonb('security_schemes').$type<Record<string, unknown>>().default({}),
    skills: jsonb('skills').$type<Array<Record<string, unknown>>>().default([]),
    summary: text('summary').notNull().default(''),
    supportsAuthenticatedExtendedCard: boolean('supports_authenticated_extended_card').default(false),
    tags: text('tags').array().default([]),
    tokenUsage: integer('token_usage').notNull().default(0),
    url: text('url'),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('market_agent_versions_agent_id_version_number_unique').on(
      table.agentId,
      table.versionNumber,
    ),
    index('market_agent_versions_agent_id_idx').on(table.agentId),
  ],
);

export const marketAgentEvents = pgTable(
  'market_agent_events',
  {
    id: serial('id').primaryKey(),
    accountId: integer('account_id').references(() => marketAccounts.id, { onDelete: 'set null' }),
    agentId: integer('agent_id')
      .references(() => marketAgents.id, { onDelete: 'cascade' })
      .notNull(),
    event: text('event', { enum: ['add', 'chat', 'click'] }).notNull(),
    source: text('source'),
    ...timestamps,
  },
  (table) => [
    index('market_agent_events_agent_id_idx').on(table.agentId),
    index('market_agent_events_account_id_idx').on(table.accountId),
  ],
);

export type MarketAccountItem = typeof marketAccounts.$inferSelect;
export type NewMarketAccount = typeof marketAccounts.$inferInsert;
export type MarketAgentItem = typeof marketAgents.$inferSelect;
export type NewMarketAgent = typeof marketAgents.$inferInsert;
export type MarketAgentVersionItem = typeof marketAgentVersions.$inferSelect;
export type NewMarketAgentVersion = typeof marketAgentVersions.$inferInsert;
```

- [ ] **Step 4: Export the schema in `packages/database/src/schemas/index.ts`**

Add this line near the other schema exports:

```ts
export * from './market';
```

- [ ] **Step 5: Run the schema export test and verify it passes**

Run: `bunx vitest run --silent='passed-only' packages/database/src/models/__tests__/marketSchema.test.ts`

Expected: PASS.

- [ ] **Step 6: Generate the Drizzle migration**

Run: `bun run db:generate`

Expected: a new SQL migration appears under `packages/database/migrations` and includes `CREATE TABLE "market_accounts"`, `CREATE TABLE "market_agents"`, `CREATE TABLE "market_agent_versions"`, and `CREATE TABLE "market_agent_events"`.

- [ ] **Step 7: Review the generated migration**

Rename the generated SQL migration to `packages/database/migrations/0100_add_market_account_agent_tables.sql` and update the `tag` field for that migration in `packages/database/migrations/meta/_journal.json` to `0100_add_market_account_agent_tables`.

Open the generated SQL and verify it creates the four Market tables, unique indexes, and foreign keys described in Step 3. Edit the generated SQL to be idempotent before committing. Each table creation statement must begin with `CREATE TABLE IF NOT EXISTS`, and each index creation statement must begin with `CREATE INDEX IF NOT EXISTS` or `CREATE UNIQUE INDEX IF NOT EXISTS`.

For the generated foreign-key statements, use this exact defensive drop-then-add pattern:

```sql
ALTER TABLE "market_agents" DROP CONSTRAINT IF EXISTS "market_agents_owner_id_market_accounts_id_fk";
ALTER TABLE "market_agents" ADD CONSTRAINT "market_agents_owner_id_market_accounts_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."market_accounts"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "market_agent_versions" DROP CONSTRAINT IF EXISTS "market_agent_versions_agent_id_market_agents_id_fk";
ALTER TABLE "market_agent_versions" ADD CONSTRAINT "market_agent_versions_agent_id_market_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."market_agents"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "market_agent_events" DROP CONSTRAINT IF EXISTS "market_agent_events_account_id_market_accounts_id_fk";
ALTER TABLE "market_agent_events" ADD CONSTRAINT "market_agent_events_account_id_market_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."market_accounts"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "market_agent_events" DROP CONSTRAINT IF EXISTS "market_agent_events_agent_id_market_agents_id_fk";
ALTER TABLE "market_agent_events" ADD CONSTRAINT "market_agent_events_agent_id_market_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."market_agents"("id") ON DELETE cascade ON UPDATE no action;
```

If Drizzle generates a destructive statement unrelated to these tables, stop and ask for review before editing the migration.

- [ ] **Step 8: Commit the schema and migration**

```bash
git add packages/database/src/schemas/index.ts packages/database/src/schemas/market.ts packages/database/src/models/__tests__/marketSchema.test.ts packages/database/migrations packages/database/src/core/migrations.json docs/development/database-schema.dbml
git commit -m "🗃️ feat(database): add Market account and agent tables"
```

## Task 3: Implement Trusted Client Verification

**Files:**

- Create: `apps/market/src/http/context.ts`

- Create: `apps/market/src/http/auth.ts`

- Create: `apps/market/src/types.ts`

- Test: `apps/market/src/http/auth.test.ts`

- [ ] **Step 1: Write trusted auth tests**

Create `apps/market/src/http/auth.test.ts`:

```ts
import { buildTrustedClientPayload, createTrustedClientToken } from '@lobehub/market-sdk';
import { describe, expect, it } from 'vitest';

import { MarketHttpError } from './errors';
import { verifyTrustedToken } from './auth';

const secret = 'lobehub-market_tcs_test-secret-for-market-service';

describe('verifyTrustedToken', () => {
  it('decrypts a valid trusted-client token', () => {
    const token = createTrustedClientToken(
      buildTrustedClientPayload({
        clientId: 'internal-lobehub',
        email: 'aaryn@example.com',
        name: 'Aaryn',
        userId: 'user_123',
      }),
      secret,
    );

    const payload = verifyTrustedToken(token, {
      clientId: 'internal-lobehub',
      maxAgeMs: 5 * 60 * 1000,
      secret,
    });

    expect(payload).toMatchObject({
      clientId: 'internal-lobehub',
      email: 'aaryn@example.com',
      name: 'Aaryn',
      userId: 'user_123',
    });
  });

  it('rejects a token for the wrong trusted client', () => {
    const token = createTrustedClientToken(
      buildTrustedClientPayload({
        clientId: 'other-client',
        email: 'aaryn@example.com',
        userId: 'user_123',
      }),
      secret,
    );

    expect(() =>
      verifyTrustedToken(token, {
        clientId: 'internal-lobehub',
        maxAgeMs: 5 * 60 * 1000,
        secret,
      }),
    ).toThrow(MarketHttpError);
  });
});
```

- [ ] **Step 2: Run the trusted auth test and verify it fails**

Run: `pnpm --filter @lobechat/market test -- auth.test.ts`

Expected: FAIL because `apps/market/src/http/auth.ts` does not exist.

- [ ] **Step 3: Create `apps/market/src/types.ts`**

```ts
import type { LobeChatDatabase } from '@lobechat/database';

import type { MarketEnv } from './env';

export interface TrustedClientPayload {
  clientId: string;
  email: string;
  emailVerified?: boolean;
  name?: string;
  nonce: string;
  timestamp: number;
  userId: string;
}

export interface MarketAuthVariables {
  db?: LobeChatDatabase;
  marketEnv?: Pick<MarketEnv, 'MARKET_TRUSTED_CLIENT_ID' | 'MARKET_TRUSTED_CLIENT_SECRET'>;
  trustedPayload?: TrustedClientPayload;
}

export type MarketHonoEnv = {
  Variables: MarketAuthVariables;
};
```

- [ ] **Step 4: Create `apps/market/src/http/context.ts`**

```ts
import type { Context } from 'hono';

import type { MarketHonoEnv } from '../types';
import { MarketHttpError } from './errors';

export const getMarketDb = (c: Context<MarketHonoEnv>) => {
  const db = c.get('db');
  if (!db) throw new MarketHttpError(500, 'market_db_not_configured', 'Market database is not configured.');
  return db;
};

export const getMarketEnv = (c: Context<MarketHonoEnv>) => {
  const env = c.get('marketEnv');
  if (!env) throw new MarketHttpError(500, 'market_env_not_configured', 'Market environment is not configured.');
  return env;
};
```

- [ ] **Step 5: Create `apps/market/src/http/auth.ts`**

```ts
import { createDecipheriv, createHash } from 'node:crypto';

import type { Context, MiddlewareHandler } from 'hono';

import type { MarketHonoEnv, TrustedClientPayload } from '../types';
import { getMarketEnv } from './context';
import { MarketHttpError } from './errors';

const CRYPTO = {
  ALGORITHM: 'aes-256-gcm',
  AUTH_TAG_LENGTH: 16,
  IV_LENGTH: 12,
  KEY_LENGTH: 32,
};

const SECRET_PREFIX = 'lobehub-market_tcs_';

const deriveKey = (secret: string) => {
  if (secret.startsWith(SECRET_PREFIX)) {
    return createHash('sha256').update(secret).digest();
  }

  const key = Buffer.from(secret, 'hex');
  if (key.length !== CRYPTO.KEY_LENGTH) {
    throw new MarketHttpError(500, 'invalid_trusted_client_secret', 'Trusted client secret is invalid.');
  }

  return key;
};

export const verifyTrustedToken = (
  token: string,
  options: { clientId: string; maxAgeMs: number; secret: string },
): TrustedClientPayload => {
  try {
    const encrypted = Buffer.from(token, 'base64');
    const iv = encrypted.subarray(0, CRYPTO.IV_LENGTH);
    const authTag = encrypted.subarray(encrypted.length - CRYPTO.AUTH_TAG_LENGTH);
    const ciphertext = encrypted.subarray(CRYPTO.IV_LENGTH, encrypted.length - CRYPTO.AUTH_TAG_LENGTH);
    const decipher = createDecipheriv(CRYPTO.ALGORITHM, deriveKey(options.secret), iv);

    decipher.setAuthTag(authTag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
    const payload = JSON.parse(plaintext) as TrustedClientPayload;

    if (payload.clientId !== options.clientId) {
      throw new MarketHttpError(401, 'invalid_trusted_client', 'Trusted client is not allowed.');
    }

    if (!payload.userId || !payload.email) {
      throw new MarketHttpError(401, 'invalid_trusted_payload', 'Trusted token is missing user identity.');
    }

    if (Date.now() - payload.timestamp > options.maxAgeMs) {
      throw new MarketHttpError(401, 'expired_trusted_token', 'Trusted token has expired.');
    }

    return payload;
  } catch (error) {
    if (error instanceof MarketHttpError) throw error;
    throw new MarketHttpError(401, 'invalid_trusted_token', 'Trusted token could not be verified.');
  }
};

export const getTrustedPayload = (c: Context<MarketHonoEnv>) => {
  const token = c.req.header('x-lobe-trust-token');
  if (!token) return undefined;
  const env = getMarketEnv(c);

  return verifyTrustedToken(token, {
    clientId: env.MARKET_TRUSTED_CLIENT_ID,
    maxAgeMs: 5 * 60 * 1000,
    secret: env.MARKET_TRUSTED_CLIENT_SECRET,
  });
};

export const trustedAuth = (): MiddlewareHandler<MarketHonoEnv> => async (c, next) => {
  const payload = getTrustedPayload(c);

  if (!payload) {
    throw new MarketHttpError(401, 'missing_trusted_token', 'A trusted client token is required.');
  }

  c.set('trustedPayload', payload);
  await next();
};

export const optionalTrustedAuth = (): MiddlewareHandler<MarketHonoEnv> => async (c, next) => {
  const payload = getTrustedPayload(c);
  if (payload) c.set('trustedPayload', payload);
  await next();
};
```

- [ ] **Step 6: Run the trusted auth test and verify it passes**

Run: `pnpm --filter @lobechat/market test -- auth.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit trusted auth**

```bash
git add apps/market/src/types.ts apps/market/src/http/context.ts apps/market/src/http/auth.ts apps/market/src/http/auth.test.ts
git commit -m "🔐 feat(market): verify trusted client tokens"
```

## Task 4: Implement Database Wiring and Market Account Model

**Files:**

- Create: `apps/market/src/db.ts`

- Create: `apps/market/src/models/account.ts`

- Test: `apps/market/src/models/account.test.ts`

- Modify: `apps/market/src/app.ts`

- Modify: `apps/market/src/index.ts`

- [ ] **Step 1: Write account model tests**

Create `apps/market/src/models/account.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';

import { marketAccounts } from '@lobechat/database/schemas';
import { getTestDB } from '@lobechat/database/test-utils';

import { MarketAccountModel } from './account';

describe('MarketAccountModel', () => {
  beforeEach(async () => {
    const db = await getTestDB();
    await db.delete(marketAccounts);
  });

  it('creates an account from trusted payload and reuses it on the next call', async () => {
    const db = await getTestDB();
    const model = new MarketAccountModel(db);

    const first = await model.upsertFromTrustedPayload({
      clientId: 'internal-lobehub',
      email: 'aaryn@example.com',
      name: 'Aaryn Bryanton',
      nonce: 'abc123',
      timestamp: Date.now(),
      userId: 'user_123',
    });

    const second = await model.upsertFromTrustedPayload({
      clientId: 'internal-lobehub',
      email: 'aaryn@example.com',
      name: 'Aaryn B.',
      nonce: 'def456',
      timestamp: Date.now(),
      userId: 'user_123',
    });

    expect(second.id).toBe(first.id);
    expect(second.displayName).toBe('Aaryn B.');

    const rows = await db
      .select()
      .from(marketAccounts)
      .where(eq(marketAccounts.lobeUserId, 'user_123'));
    expect(rows).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run the account model test and verify it fails**

Run: `pnpm --filter @lobechat/market test -- account.test.ts`

Expected: FAIL because `MarketAccountModel` does not exist.

- [ ] **Step 3: Create `apps/market/src/db.ts`**

```ts
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import * as schema from '@lobechat/database/schemas';
import type { LobeChatDatabase } from '@lobechat/database';

export const createMarketDatabase = (databaseUrl: string) => {
  const pool = new Pool({ connectionString: databaseUrl });
  return drizzle(pool, { schema }) as unknown as LobeChatDatabase;
};
```

- [ ] **Step 4: Create `apps/market/src/models/account.ts`**

```ts
import type { LobeChatDatabase } from '@lobechat/database';
import { marketAccounts } from '@lobechat/database/schemas';
import { eq } from 'drizzle-orm';

import type { TrustedClientPayload } from '../types';

const normalizeNamespace = (payload: TrustedClientPayload) => {
  const base = payload.email.split('@')[0] || payload.userId;
  const normalized = base.toLowerCase().replaceAll(/[^a-z0-9_-]/g, '-').slice(0, 100);
  return normalized || payload.userId.slice(0, 100);
};

export class MarketAccountModel {
  constructor(private readonly db: LobeChatDatabase) {}

  async findById(id: number) {
    const [account] = await this.db
      .select()
      .from(marketAccounts)
      .where(eq(marketAccounts.id, id))
      .limit(1);

    return account;
  }

  async findByLobeUserId(lobeUserId: string) {
    const [account] = await this.db
      .select()
      .from(marketAccounts)
      .where(eq(marketAccounts.lobeUserId, lobeUserId))
      .limit(1);

    return account;
  }

  async upsertFromTrustedPayload(payload: TrustedClientPayload) {
    const existing = await this.findByLobeUserId(payload.userId);

    if (existing) {
      const [updated] = await this.db
        .update(marketAccounts)
        .set({
          displayName: payload.name || existing.displayName,
          email: payload.email,
          updatedAt: new Date(),
        })
        .where(eq(marketAccounts.id, existing.id))
        .returning();

      return updated;
    }

    const [created] = await this.db
      .insert(marketAccounts)
      .values({
        displayName: payload.name,
        email: payload.email,
        lobeUserId: payload.userId,
        namespace: normalizeNamespace(payload),
        userName: normalizeNamespace(payload),
      })
      .returning();

    return created;
  }
}
```

- [ ] **Step 5: Pass bindings into the Hono app**

Update `apps/market/src/app.ts` so `createMarketApp` accepts bindings and uses `MarketHonoEnv`:

```ts
import type { LobeChatDatabase } from '@lobechat/database';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';

import type { MarketEnv } from './env';
import { MarketHttpError, jsonError, notImplemented } from './http/errors';
import { createHealthRoutes } from './http/routes/health';
import type { MarketHonoEnv } from './types';

export interface CreateMarketAppOptions {
  db?: LobeChatDatabase;
  env?: Pick<MarketEnv, 'MARKET_TRUSTED_CLIENT_ID' | 'MARKET_TRUSTED_CLIENT_SECRET'>;
}

export const createMarketApp = (options: CreateMarketAppOptions = {}) => {
  const app = new Hono<MarketHonoEnv>();

  app.use('*', async (c, next) => {
    if (options.db) c.set('db', options.db);
    if (options.env) c.set('marketEnv', options.env);
    await next();
  });

  app.use('*', cors());
  app.use('*', logger());
  app.route('/', createHealthRoutes());

  app.all('/lobehub-oidc/auth', (c) => notImplemented(c, '/lobehub-oidc/auth'));
  app.all('/lobehub-oidc/token', (c) => notImplemented(c, '/lobehub-oidc/token'));
  app.all('/lobehub-oidc/handoff', (c) => notImplemented(c, '/lobehub-oidc/handoff'));
  app.all('/oauth/token', (c) => notImplemented(c, '/oauth/token'));
  app.all('/api/v1/clients/register', (c) => notImplemented(c, '/api/v1/clients/register'));

  app.notFound((c) => jsonError(c, 404, 'not_found', 'Requested Market endpoint was not found.'));
  app.onError((error, c) => {
    if (error instanceof MarketHttpError) return jsonError(c, error.status, error.code, error.message);
    console.error('[market] unhandled error:', error);
    return jsonError(c, 500, 'internal_error', 'Internal Market service error.');
  });

  return app;
};
```

- [ ] **Step 6: Update `apps/market/src/index.ts` to create the database**

```ts
import { serve } from '@hono/node-server';

import { createMarketApp } from './app';
import { createMarketDatabase } from './db';
import { loadEnv } from './env';

const env = loadEnv();
const db = createMarketDatabase(env.DATABASE_URL);
const app = createMarketApp({ db, env });

serve({ fetch: app.fetch, port: env.MARKET_PORT }, (info) => {
  console.info(`[market] listening on http://localhost:${info.port}`);
});
```

- [ ] **Step 7: Run the account model test and verify it passes**

Run: `pnpm --filter @lobechat/market test -- account.test.ts`

Expected: PASS.

- [ ] **Step 8: Commit database wiring and account model**

```bash
git add apps/market/src/db.ts apps/market/src/models/account.ts apps/market/src/models/account.test.ts apps/market/src/app.ts apps/market/src/index.ts
git commit -m "✨ feat(market): provision trusted Market accounts"
```

## Task 5: Implement Agent Model and Business Service

**Files:**

- Create: `apps/market/src/models/agent.ts`

- Create: `apps/market/src/services/agents.ts`

- Test: `apps/market/src/services/agents.test.ts`

- [ ] **Step 1: Write service tests for create, version, list, detail, and fork**

Create `apps/market/src/services/agents.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';

import { marketAccounts, marketAgentVersions, marketAgents } from '@lobechat/database/schemas';
import { getTestDB } from '@lobechat/database/test-utils';

import { MarketAccountModel } from '../models/account';
import { AgentService } from './agents';

const trustedPayload = {
  clientId: 'internal-lobehub',
  email: 'aaryn@example.com',
  name: 'Aaryn',
  nonce: 'abc123',
  timestamp: Date.now(),
  userId: 'user_123',
};

describe('AgentService', () => {
  beforeEach(async () => {
    const db = await getTestDB();
    await db.delete(marketAgentVersions);
    await db.delete(marketAgents);
    await db.delete(marketAccounts);
  });

  it('creates an agent and returns it in public lists after publishing', async () => {
    const db = await getTestDB();
    const account = await new MarketAccountModel(db).upsertFromTrustedPayload(trustedPayload);
    const service = new AgentService(db);

    await service.createAgent(account.id, { identifier: 'agent-one', name: 'Agent One' });
    await service.createAgentVersion(account.id, {
      avatar: '🤖',
      category: 'general',
      config: { systemRole: 'Be helpful.' },
      description: 'A useful internal assistant.',
      identifier: 'agent-one',
      name: 'Agent One',
      summary: 'Useful assistant',
      tags: ['internal'],
    });
    await service.modifyAgent(account.id, { identifier: 'agent-one', status: 'published' });

    const list = await service.listAgents({ page: 1, pageSize: 20, status: 'published', visibility: 'public' });
    expect(list.items).toHaveLength(1);
    expect(list.items[0]).toMatchObject({ identifier: 'agent-one', name: 'Agent One' });

    const detail = await service.getAgentDetail('agent-one');
    expect(detail).toMatchObject({
      avatar: '🤖',
      config: { systemRole: 'Be helpful.' },
      identifier: 'agent-one',
      name: 'Agent One',
      ownerId: account.id,
      status: 'published',
    });
  });

  it('forks the current version into a new owner record', async () => {
    const db = await getTestDB();
    const model = new MarketAccountModel(db);
    const owner = await model.upsertFromTrustedPayload(trustedPayload);
    const second = await model.upsertFromTrustedPayload({
      ...trustedPayload,
      email: 'second@example.com',
      userId: 'user_456',
    });
    const service = new AgentService(db);

    await service.createAgent(owner.id, { identifier: 'source-agent', name: 'Source Agent' });
    await service.createAgentVersion(owner.id, {
      config: { systemRole: 'Source prompt' },
      description: 'Source description',
      identifier: 'source-agent',
      name: 'Source Agent',
    });

    const fork = await service.forkAgent(second.id, 'source-agent', {
      identifier: 'forked-agent',
      name: 'Forked Agent',
      visibility: 'private',
    });

    expect(fork.agent).toMatchObject({
      forkedFromAgentId: expect.any(Number),
      identifier: 'forked-agent',
      name: 'Forked Agent',
      ownerId: second.id,
    });

    const detail = await service.getAgentDetail('forked-agent', { includePrivateForAccountId: second.id });
    expect(detail.config).toEqual({ systemRole: 'Source prompt' });
    expect(detail.visibility).toBe('private');
  });
});
```

- [ ] **Step 2: Run the agent service test and verify it fails**

Run: `pnpm --filter @lobechat/market test -- agents.test.ts`

Expected: FAIL because `AgentService` does not exist.

- [ ] **Step 3: Create `apps/market/src/models/agent.ts`**

Implement focused persistence methods with explicit Drizzle select builder queries:

```ts
import type { LobeChatDatabase } from '@lobechat/database';
import {
  marketAgentEvents,
  marketAgentVersions,
  marketAgents,
} from '@lobechat/database/schemas';
import type { NewMarketAgent, NewMarketAgentVersion } from '@lobechat/database/schemas';
import { and, asc, count, desc, eq, ilike, or, sql } from 'drizzle-orm';

export class AgentModel {
  constructor(private readonly db: LobeChatDatabase) {}

  async findByIdentifier(identifier: string) {
    const [agent] = await this.db
      .select()
      .from(marketAgents)
      .where(eq(marketAgents.identifier, identifier))
      .limit(1);
    return agent;
  }

  async createAgent(values: NewMarketAgent) {
    const [agent] = await this.db.insert(marketAgents).values(values).returning();
    return agent;
  }

  async updateAgent(identifier: string, values: Partial<NewMarketAgent>) {
    const [agent] = await this.db
      .update(marketAgents)
      .set({ ...values, updatedAt: new Date() })
      .where(eq(marketAgents.identifier, identifier))
      .returning();
    return agent;
  }

  async findById(id: number) {
    const [agent] = await this.db.select().from(marketAgents).where(eq(marketAgents.id, id)).limit(1);
    return agent;
  }

  async createVersion(values: NewMarketAgentVersion) {
    await this.db
      .update(marketAgentVersions)
      .set({ isLatest: false, updatedAt: new Date() })
      .where(eq(marketAgentVersions.agentId, values.agentId));

    const [version] = await this.db.insert(marketAgentVersions).values(values).returning();

    await this.db
      .update(marketAgents)
      .set({ currentVersionId: version.id, updatedAt: new Date() })
      .where(eq(marketAgents.id, values.agentId));

    return version;
  }

  async updateVersion(id: number, values: Partial<NewMarketAgentVersion>) {
    const [version] = await this.db
      .update(marketAgentVersions)
      .set({ ...values, updatedAt: new Date() })
      .where(eq(marketAgentVersions.id, id))
      .returning();
    return version;
  }

  async findLatestVersion(agentId: number) {
    const [version] = await this.db
      .select()
      .from(marketAgentVersions)
      .where(and(eq(marketAgentVersions.agentId, agentId), eq(marketAgentVersions.isLatest, true)))
      .limit(1);
    return version;
  }

  async findVersionByVersionString(agentId: number, versionString: string) {
    const [version] = await this.db
      .select()
      .from(marketAgentVersions)
      .where(and(eq(marketAgentVersions.agentId, agentId), eq(marketAgentVersions.version, versionString)))
      .limit(1);
    return version;
  }

  async getNextVersionNumber(agentId: number) {
    const [row] = await this.db
      .select({ maxVersion: sql<number>`coalesce(max(${marketAgentVersions.versionNumber}), 0)` })
      .from(marketAgentVersions)
      .where(eq(marketAgentVersions.agentId, agentId));
    return row.maxVersion + 1;
  }

  async list(params: {
    ownerId?: number | string;
    order?: string;
    page: number;
    pageSize: number;
    q?: string;
    status?: string;
    visibility?: string;
  }) {
    const filters = [];
    if (params.status && params.status !== 'all') filters.push(eq(marketAgents.status, params.status as never));
    if (params.visibility && params.visibility !== 'all') filters.push(eq(marketAgents.visibility, params.visibility as never));
    if (params.ownerId) filters.push(eq(marketAgents.ownerId, Number(params.ownerId)));
    if (params.q) {
      filters.push(or(ilike(marketAgents.name, `%${params.q}%`), ilike(marketAgents.identifier, `%${params.q}%`))!);
    }

    const where = filters.length > 0 ? and(...filters) : undefined;
    const offset = (params.page - 1) * params.pageSize;
    const sortOrder = params.order === 'asc' ? asc : desc;

    const items = await this.db
      .select({ agent: marketAgents, version: marketAgentVersions })
      .from(marketAgents)
      .leftJoin(marketAgentVersions, eq(marketAgents.currentVersionId, marketAgentVersions.id))
      .where(where)
      .orderBy(sortOrder(marketAgents.updatedAt))
      .limit(params.pageSize)
      .offset(offset);

    const [total] = await this.db
      .select({ value: count() })
      .from(marketAgents)
      .where(where);

    return { items, totalCount: Number(total.value) };
  }

  async listForks(sourceAgentId: number) {
    return this.db
      .select()
      .from(marketAgents)
      .where(eq(marketAgents.forkedFromAgentId, sourceAgentId))
      .orderBy(asc(marketAgents.createdAt));
  }

  async listIdentifiers() {
    return this.db
      .select({ identifier: marketAgents.identifier, updatedAt: marketAgents.updatedAt })
      .from(marketAgents)
      .where(and(eq(marketAgents.status, 'published'), eq(marketAgents.visibility, 'public')))
      .orderBy(asc(marketAgents.identifier));
  }

  async listCategories() {
    return this.db
      .select({ category: marketAgentVersions.category, value: count() })
      .from(marketAgents)
      .leftJoin(marketAgentVersions, eq(marketAgents.currentVersionId, marketAgentVersions.id))
      .where(and(eq(marketAgents.status, 'published'), eq(marketAgents.visibility, 'public')))
      .groupBy(marketAgentVersions.category)
      .orderBy(asc(marketAgentVersions.category));
  }

  async increaseInstallCount(identifier: string) {
    const [agent] = await this.db
      .update(marketAgents)
      .set({ installCount: sql`${marketAgents.installCount} + 1`, updatedAt: new Date() })
      .where(eq(marketAgents.identifier, identifier))
      .returning();
    return agent;
  }

  async createEvent(values: { accountId?: number; agentId: number; event: 'add' | 'chat' | 'click'; source?: string }) {
    await this.db.insert(marketAgentEvents).values(values);
  }
}
```

- [ ] **Step 4: Create `apps/market/src/services/agents.ts`**

Use `AgentModel` to implement SDK-shaped responses. The service must enforce ownership on mutations and hide private resources unless `includePrivateForAccountId` matches the owner.

```ts
import type {
  AgentCreateRequest,
  AgentEventRequest,
  AgentForkRequest,
  AgentListQuery,
  AgentModifyRequest,
  AgentVersionCreateRequest,
  AgentVersionModifyRequest,
} from '@lobehub/market-sdk';

import type { LobeChatDatabase } from '@lobechat/database';

import { MarketHttpError } from '../http/errors';
import { AgentModel } from '../models/agent';

const toIso = (value: Date | string | null | undefined) =>
  value ? new Date(value).toISOString() : new Date().toISOString();

export class AgentService {
  private readonly model: AgentModel;

  constructor(db: LobeChatDatabase) {
    this.model = new AgentModel(db);
  }

  async createAgent(ownerId: number, data: AgentCreateRequest) {
    const existing = await this.model.findByIdentifier(data.identifier);
    if (existing) throw new MarketHttpError(409, 'agent_identifier_exists', 'Agent identifier already exists.');

    return this.model.createAgent({
      homepage: data.homepage,
      identifier: data.identifier,
      isFeatured: data.isFeatured ?? false,
      name: data.name,
      ownerId,
      status: data.status ?? 'unpublished',
      visibility: data.visibility ?? 'public',
    });
  }

  async modifyAgent(ownerId: number, data: AgentModifyRequest) {
    const agent = await this.requireOwnedAgent(ownerId, data.identifier);
    return this.model.updateAgent(agent.identifier, {
      homepage: data.homepage ?? agent.homepage,
      isFeatured: data.isFeatured ?? agent.isFeatured,
      isOfficial: data.isOfficial ?? agent.isOfficial,
      name: data.name ?? agent.name,
      status: data.status ?? agent.status,
      visibility: data.visibility ?? agent.visibility,
    });
  }

  async createAgentVersion(ownerId: number, data: AgentVersionCreateRequest) {
    const agent = await this.requireOwnedAgent(ownerId, data.identifier);
    const versionNumber = data.versionNumber ?? (await this.model.getNextVersionNumber(agent.id));
    const version = data.version ?? `1.0.${versionNumber - 1}`;

    return this.model.createVersion({
      a2aProtocolVersion: data.a2aProtocolVersion,
      agentId: agent.id,
      avatar: data.avatar,
      category: data.category,
      changelog: data.changelog,
      config: data.config ?? {},
      defaultInputModes: data.defaultInputModes ?? [],
      defaultOutputModes: data.defaultOutputModes ?? [],
      description: data.description ?? '',
      documentationUrl: data.documentationUrl,
      editorData: data.editorData ?? {},
      extensions: data.extensions ?? [],
      hasPushNotifications: data.hasPushNotifications ?? false,
      hasStateTransitionHistory: data.hasStateTransitionHistory ?? false,
      hasStreaming: data.hasStreaming ?? false,
      interfaces: data.interfaces ?? [],
      isLatest: true,
      isValidated: false,
      name: data.name ?? agent.name,
      preferredTransport: data.preferredTransport,
      securityRequirements: data.securityRequirements ?? [],
      securitySchemes: data.securitySchemes ?? {},
      summary: data.summary ?? '',
      supportsAuthenticatedExtendedCard: data.supportsAuthenticatedExtendedCard ?? false,
      tags: data.tags ?? [],
      tokenUsage: data.tokenUsage ?? 0,
      url: data.url,
      version,
      versionNumber,
    });
  }

  async modifyAgentVersion(ownerId: number, data: AgentVersionModifyRequest) {
    const agent = await this.requireOwnedAgent(ownerId, data.identifier);
    const version = await this.model.findVersionByVersionString(agent.id, data.version);
    if (!version) throw new MarketHttpError(404, 'agent_version_not_found', 'Agent version was not found.');

    return this.model.updateVersion(version.id, {
      a2aProtocolVersion: data.a2aProtocolVersion ?? version.a2aProtocolVersion,
      avatar: data.avatar ?? version.avatar,
      category: data.category ?? version.category,
      changelog: data.changelog ?? version.changelog,
      config: data.config ?? version.config,
      defaultInputModes: data.defaultInputModes ?? version.defaultInputModes,
      defaultOutputModes: data.defaultOutputModes ?? version.defaultOutputModes,
      description: data.description ?? version.description,
      documentationUrl: data.documentationUrl ?? version.documentationUrl,
      editorData: data.editorData ?? version.editorData,
      extensions: data.extensions ?? version.extensions,
      hasPushNotifications: data.hasPushNotifications ?? version.hasPushNotifications,
      hasStateTransitionHistory: data.hasStateTransitionHistory ?? version.hasStateTransitionHistory,
      hasStreaming: data.hasStreaming ?? version.hasStreaming,
      interfaces: data.interfaces ?? version.interfaces,
      name: data.name ?? version.name,
      preferredTransport: data.preferredTransport ?? version.preferredTransport,
      securityRequirements: data.securityRequirements ?? version.securityRequirements,
      securitySchemes: data.securitySchemes ?? version.securitySchemes,
      summary: data.summary ?? version.summary,
      supportsAuthenticatedExtendedCard:
        data.supportsAuthenticatedExtendedCard ?? version.supportsAuthenticatedExtendedCard,
      tokenUsage: data.tokenUsage ?? version.tokenUsage,
      url: data.url ?? version.url,
      version: data.versionString ?? version.version,
    });
  }

  async getAgentDetail(identifier: string, options: { includePrivateForAccountId?: number } = {}) {
    const agent = await this.model.findByIdentifier(identifier);
    if (!agent) throw new MarketHttpError(404, 'agent_not_found', 'Agent was not found.');
    if (agent.visibility !== 'public' && agent.ownerId !== options.includePrivateForAccountId) {
      throw new MarketHttpError(404, 'agent_not_found', 'Agent was not found.');
    }

    const version = await this.model.findLatestVersion(agent.id);
    if (!version) throw new MarketHttpError(404, 'agent_version_not_found', 'Agent version was not found.');

    return {
      avatar: version.avatar ?? '',
      category: version.category ?? undefined,
      config: version.config ?? {},
      createdAt: toIso(agent.createdAt),
      description: version.description,
      documentationUrl: version.documentationUrl ?? undefined,
      editorData: version.editorData ?? {},
      forkCount: agent.forkCount,
      forkedFromAgentId: agent.forkedFromAgentId ?? undefined,
      homepage: agent.homepage ?? undefined,
      id: agent.id,
      identifier: agent.identifier,
      installCount: agent.installCount,
      isFeatured: agent.isFeatured,
      isOfficial: agent.isOfficial,
      manifestUrl: '',
      name: version.name,
      ownerId: agent.ownerId,
      status: agent.status,
      summary: version.summary,
      tags: version.tags ?? [],
      tokenUsage: version.tokenUsage,
      updatedAt: toIso(agent.updatedAt),
      version: version.version,
      versionNumber: version.versionNumber,
      visibility: agent.visibility,
    };
  }

  async listAgents(params: AgentListQuery) {
    const page = params.page ?? 1;
    const pageSize = params.pageSize ?? 20;
    const result = await this.model.list({
      ownerId: params.ownerId,
      order: params.order,
      page,
      pageSize,
      q: params.q,
      status: params.status ?? 'published',
      visibility: params.visibility ?? 'public',
    });

    return {
      currentPage: page,
      items: result.items.map(({ agent, version }) => ({
        avatar: version?.avatar ?? '',
        category: version?.category ?? undefined,
        createdAt: toIso(agent.createdAt),
        description: version?.description ?? '',
        homepage: agent.homepage ?? undefined,
        identifier: agent.identifier,
        installCount: agent.installCount,
        manifestUrl: '',
        name: version?.name ?? agent.name,
        ownerId: agent.ownerId,
        tags: version?.tags ?? [],
        updatedAt: toIso(agent.updatedAt),
      })),
      pageSize,
      totalCount: result.totalCount,
      totalPages: Math.max(1, Math.ceil(result.totalCount / pageSize)),
    };
  }

  async listIdentifiers() {
    const rows = await this.model.listIdentifiers();
    return rows.map((row) => ({ id: row.identifier, lastModified: toIso(row.updatedAt) }));
  }

  async listCategories() {
    const rows = await this.model.listCategories();
    return rows
      .filter((row) => Boolean(row.category))
      .map((row) => ({ category: row.category!, count: Number(row.value) }));
  }

  async listAgentsByPlugin(params: AgentListQuery & { pluginId?: string }) {
    return this.listAgents(params);
  }

  async forkAgent(ownerId: number, sourceIdentifier: string, data: AgentForkRequest) {
    const source = await this.model.findByIdentifier(sourceIdentifier);
    if (!source) throw new MarketHttpError(404, 'source_agent_not_found', 'Source agent was not found.');
    const sourceVersion = await this.model.findLatestVersion(source.id);
    if (!sourceVersion) throw new MarketHttpError(404, 'source_agent_version_not_found', 'Source agent version was not found.');

    const created = await this.createAgent(ownerId, {
      identifier: data.identifier,
      name: data.name ?? `${source.name} Fork`,
      status: data.status ?? 'unpublished',
      visibility: data.visibility ?? 'private',
    });
    const forkedAgent = await this.model.updateAgent(created.identifier, { forkedFromAgentId: source.id });
    const version = await this.createAgentVersion(ownerId, {
      config: sourceVersion.config ?? {},
      description: sourceVersion.description,
      identifier: created.identifier,
      name: data.name ?? sourceVersion.name,
      version: sourceVersion.version,
    });

    return {
      agent: {
        createdAt: toIso(forkedAgent.createdAt),
        forkedFromAgentId: source.id,
        id: forkedAgent.id,
        identifier: forkedAgent.identifier,
        name: forkedAgent.name,
        ownerId: forkedAgent.ownerId,
        updatedAt: toIso(forkedAgent.updatedAt),
      },
      source: { agentId: source.id, identifier: source.identifier, versionNumber: sourceVersion.versionNumber },
      version: { agentId: forkedAgent.id, createdAt: toIso(version.createdAt), id: version.id, versionNumber: version.versionNumber },
    };
  }

  async listForks(identifier: string) {
    const source = await this.model.findByIdentifier(identifier);
    if (!source) throw new MarketHttpError(404, 'agent_not_found', 'Agent was not found.');
    const forks = await this.model.listForks(source.id);
    return {
      forks: forks.map((agent) => ({
        createdAt: toIso(agent.createdAt),
        forkCount: agent.forkCount,
        id: agent.id,
        identifier: agent.identifier,
        name: agent.name,
        ownerId: agent.ownerId,
      })),
      totalCount: forks.length,
    };
  }

  async getForkSource(identifier: string) {
    const agent = await this.model.findByIdentifier(identifier);
    if (!agent) throw new MarketHttpError(404, 'agent_not_found', 'Agent was not found.');
    if (!agent.forkedFromAgentId) return { source: null };

    const source = await this.model.findById(agent.forkedFromAgentId);
    return {
      source: source
        ? {
            createdAt: toIso(source.createdAt),
            forkCount: source.forkCount,
            id: source.id,
            identifier: source.identifier,
            name: source.name,
            ownerId: source.ownerId,
          }
        : null,
    };
  }

  async increaseInstallCount(identifier: string) {
    const agent = await this.model.increaseInstallCount(identifier);
    if (!agent) throw new MarketHttpError(404, 'agent_not_found', 'Agent was not found.');
    return { identifier: agent.identifier, installCount: agent.installCount, success: true };
  }

  async createEvent(accountId: number | undefined, data: AgentEventRequest) {
    const agent = await this.model.findByIdentifier(data.identifier);
    if (!agent) throw new MarketHttpError(404, 'agent_not_found', 'Agent was not found.');
    await this.model.createEvent({ accountId, agentId: agent.id, event: data.event, source: data.source });
    return { success: true };
  }

  private async requireOwnedAgent(ownerId: number, identifier: string) {
    const agent = await this.model.findByIdentifier(identifier);
    if (!agent) throw new MarketHttpError(404, 'agent_not_found', 'Agent was not found.');
    if (agent.ownerId !== ownerId) throw new MarketHttpError(403, 'agent_not_owned', 'Agent is owned by another account.');
    return agent;
  }
}
```

- [ ] **Step 5: Run the agent service test and verify it passes**

Run: `pnpm --filter @lobechat/market test -- agents.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit agent model and service**

```bash
git add apps/market/src/models/agent.ts apps/market/src/services/agents.ts apps/market/src/services/agents.test.ts
git commit -m "✨ feat(market): implement agent catalog service"
```

## Task 6: Add OIDC Userinfo and Agent HTTP Routes

**Files:**

- Create: `apps/market/src/http/routes/oidc.ts`

- Create: `apps/market/src/http/routes/agents.ts`

- Modify: `apps/market/src/app.ts`

- Create: `apps/market/src/http/routes/agents.test.ts`

- [ ] **Step 1: Create route tests for userinfo and agent publish flow**

Create `apps/market/src/http/routes/agents.test.ts`:

```ts
import { buildTrustedClientPayload, createTrustedClientToken } from '@lobehub/market-sdk';
import { beforeEach, describe, expect, it } from 'vitest';

import { marketAccounts, marketAgentVersions, marketAgents } from '@lobechat/database/schemas';
import { getTestDB } from '@lobechat/database/test-utils';

import { createMarketApp } from '../../app';

const secret = 'lobehub-market_tcs_test-secret-for-market-service';
const env = { MARKET_TRUSTED_CLIENT_ID: 'internal-lobehub', MARKET_TRUSTED_CLIENT_SECRET: secret };

const trustToken = createTrustedClientToken(
  buildTrustedClientPayload({
    clientId: 'internal-lobehub',
    email: 'aaryn@example.com',
    name: 'Aaryn',
    userId: 'user_123',
  }),
  secret,
);

describe('agent routes', () => {
  beforeEach(async () => {
    const db = await getTestDB();
    await db.delete(marketAgentVersions);
    await db.delete(marketAgents);
    await db.delete(marketAccounts);
  });

  it('returns userinfo from a trusted token', async () => {
    const db = await getTestDB();
    const app = createMarketApp({ db, env });

    const response = await app.request('/lobehub-oidc/userinfo', {
      headers: { 'x-lobe-trust-token': trustToken },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      accountId: expect.any(Number),
      email: 'aaryn@example.com',
      name: 'Aaryn',
      sub: 'user_123',
    });
  });

  it('creates, versions, publishes, and lists an agent through HTTP', async () => {
    const db = await getTestDB();
    const app = createMarketApp({ db, env });
    const headers = { 'Content-Type': 'application/json', 'x-lobe-trust-token': trustToken };

    const create = await app.request('/api/v1/agents/create', {
      body: JSON.stringify({ identifier: 'agent-one', name: 'Agent One' }),
      headers,
      method: 'POST',
    });
    expect(create.status).toBe(200);

    const version = await app.request('/api/v1/agents/version/create', {
      body: JSON.stringify({
        config: { systemRole: 'Be useful.' },
        description: 'Useful agent',
        identifier: 'agent-one',
        name: 'Agent One',
      }),
      headers,
      method: 'POST',
    });
    expect(version.status).toBe(200);

    const publish = await app.request('/api/v1/agents/modify', {
      body: JSON.stringify({ identifier: 'agent-one', status: 'published' }),
      headers,
      method: 'POST',
    });
    expect(publish.status).toBe(200);

    const list = await app.request('/api/v1/agents?status=published&visibility=public');
    expect(list.status).toBe(200);
    await expect(list.json()).resolves.toMatchObject({
      currentPage: 1,
      items: [{ identifier: 'agent-one', name: 'Agent One' }],
      pageSize: 20,
      totalCount: 1,
      totalPages: 1,
    });

    const identifiers = await app.request('/api/v1/agents/identifiers');
    expect(identifiers.status).toBe(200);
    await expect(identifiers.json()).resolves.toEqual([
      { id: 'agent-one', lastModified: expect.any(String) },
    ]);

    const categories = await app.request('/api/v1/agents/categories');
    expect(categories.status).toBe(200);
    await expect(categories.json()).resolves.toEqual([]);

    const installCount = await app.request('/api/v1/agents/install-count', {
      body: JSON.stringify({ identifier: 'agent-one' }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    });
    expect(installCount.status).toBe(200);
    await expect(installCount.json()).resolves.toMatchObject({ identifier: 'agent-one', installCount: 1, success: true });
  });
});
```

- [ ] **Step 2: Run the route tests and verify they fail**

Run: `pnpm --filter @lobechat/market test -- routes/agents.test.ts`

Expected: FAIL because OIDC and agent routes are not registered.

- [ ] **Step 3: Create `apps/market/src/http/routes/oidc.ts`**

```ts
import { Hono } from 'hono';

import { MarketAccountModel } from '../../models/account';
import type { MarketHonoEnv } from '../../types';
import { trustedAuth } from '../auth';
import { getMarketDb } from '../context';

export const createOidcRoutes = () => {
  const app = new Hono<MarketHonoEnv>();

  app.get('/userinfo', trustedAuth(), async (c) => {
    const payload = c.get('trustedPayload')!;
    const account = await new MarketAccountModel(getMarketDb(c)).upsertFromTrustedPayload(payload);

    return c.json({
      accountId: account.id,
      email: account.email,
      name: account.displayName,
      picture: account.avatarUrl,
      sub: account.lobeUserId,
      userName: account.userName,
    });
  });

  return app;
};
```

- [ ] **Step 4: Create `apps/market/src/http/routes/agents.ts`**

```ts
import type { Context } from 'hono';
import { Hono } from 'hono';

import { MarketAccountModel } from '../../models/account';
import { AgentService } from '../../services/agents';
import type { MarketHonoEnv } from '../../types';
import { optionalTrustedAuth, trustedAuth } from '../auth';
import { getMarketDb } from '../context';

const toNumber = (value: string | null, fallback: number) => {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const getAccountId = async (c: Context<MarketHonoEnv>) => {
  const payload = c.get('trustedPayload')!;
  const account = await new MarketAccountModel(getMarketDb(c)).upsertFromTrustedPayload(payload);
  return account.id;
};

export const createAgentRoutes = () => {
  const app = new Hono<MarketHonoEnv>();

  app.get('/', optionalTrustedAuth(), async (c) => {
    const service = new AgentService(getMarketDb(c));
    const list = await service.listAgents({
      ownerId: c.req.query('ownerId'),
      order: c.req.query('order'),
      page: toNumber(c.req.query('page') ?? null, 1),
      pageSize: toNumber(c.req.query('pageSize') ?? null, 20),
      q: c.req.query('q'),
      status: c.req.query('status') as never,
      visibility: c.req.query('visibility') as never,
    });
    return c.json(list);
  });

  app.get('/identifiers', async (c) => c.json(await new AgentService(getMarketDb(c)).listIdentifiers()));

  app.get('/categories', async (c) => c.json(await new AgentService(getMarketDb(c)).listCategories()));

  app.get('/by-plugin', async (c) => {
    const service = new AgentService(getMarketDb(c));
    return c.json(
      await service.listAgentsByPlugin({
        ownerId: c.req.query('ownerId'),
        order: c.req.query('order'),
        page: toNumber(c.req.query('page') ?? null, 1),
        pageSize: toNumber(c.req.query('pageSize') ?? null, 20),
        pluginId: c.req.query('pluginId'),
        q: c.req.query('q'),
        status: c.req.query('status') as never,
        visibility: c.req.query('visibility') as never,
      }),
    );
  });

  app.get('/own', trustedAuth(), async (c) => {
    const accountId = await getAccountId(c);
    const service = new AgentService(getMarketDb(c));
    const list = await service.listAgents({
      ownerId: accountId,
      order: c.req.query('order'),
      page: toNumber(c.req.query('page') ?? null, 1),
      pageSize: toNumber(c.req.query('pageSize') ?? null, 20),
      status: 'all' as never,
      visibility: 'all' as never,
    });
    return c.json(list);
  });

  app.get('/detail/:identifier', optionalTrustedAuth(), async (c) => {
    const payload = c.get('trustedPayload');
    const account = payload
      ? await new MarketAccountModel(getMarketDb(c)).upsertFromTrustedPayload(payload)
      : undefined;
    const detail = await new AgentService(getMarketDb(c)).getAgentDetail(c.req.param('identifier'), {
      includePrivateForAccountId: account?.id,
    });
    return c.json(detail);
  });

  app.post('/create', trustedAuth(), async (c) => {
    const accountId = await getAccountId(c);
    const body = await c.req.json();
    return c.json(await new AgentService(getMarketDb(c)).createAgent(accountId, body));
  });

  app.post('/modify', trustedAuth(), async (c) => {
    const accountId = await getAccountId(c);
    const body = await c.req.json();
    return c.json(await new AgentService(getMarketDb(c)).modifyAgent(accountId, body));
  });

  app.post('/version/create', trustedAuth(), async (c) => {
    const accountId = await getAccountId(c);
    const body = await c.req.json();
    return c.json(await new AgentService(getMarketDb(c)).createAgentVersion(accountId, body));
  });

  app.post('/version/modify', trustedAuth(), async (c) => {
    const accountId = await getAccountId(c);
    const body = await c.req.json();
    return c.json(await new AgentService(getMarketDb(c)).modifyAgentVersion(accountId, body));
  });

  app.post('/events', optionalTrustedAuth(), async (c) => {
    const payload = c.get('trustedPayload');
    const account = payload
      ? await new MarketAccountModel(getMarketDb(c)).upsertFromTrustedPayload(payload)
      : undefined;
    const body = await c.req.json();
    return c.json(await new AgentService(getMarketDb(c)).createEvent(account?.id, body));
  });

  app.post('/install-count', async (c) => {
    const body = await c.req.json();
    return c.json(await new AgentService(getMarketDb(c)).increaseInstallCount(body.identifier));
  });

  app.get('/:identifier/forks', async (c) => {
    return c.json(await new AgentService(getMarketDb(c)).listForks(c.req.param('identifier')));
  });

  app.get('/:identifier/fork-source', async (c) => {
    return c.json(await new AgentService(getMarketDb(c)).getForkSource(c.req.param('identifier')));
  });

  app.post('/:sourceIdentifier/fork', trustedAuth(), async (c) => {
    const accountId = await getAccountId(c);
    const body = await c.req.json();
    return c.json(await new AgentService(getMarketDb(c)).forkAgent(accountId, c.req.param('sourceIdentifier'), body));
  });

  return app;
};
```

- [ ] **Step 5: Register the routes in `apps/market/src/app.ts`**

Add imports:

```ts
import { createAgentRoutes } from './http/routes/agents';
import { createOidcRoutes } from './http/routes/oidc';
```

Add route registrations after the health route:

```ts
app.route('/lobehub-oidc', createOidcRoutes());
app.route('/api/v1/agents', createAgentRoutes());
```

- [ ] **Step 6: Run the route tests and verify they pass**

Run: `pnpm --filter @lobechat/market test -- routes/agents.test.ts`

Expected: PASS.

- [ ] **Step 7: Run all Market service tests**

Run: `pnpm --filter @lobechat/market test`

Expected: PASS for `app.test.ts`, `auth.test.ts`, `account.test.ts`, `agents.test.ts`, and `routes/agents.test.ts`.

- [ ] **Step 8: Commit OIDC and agent HTTP routes**

```bash
git add apps/market/src/app.ts apps/market/src/http/routes/oidc.ts apps/market/src/http/routes/agents.ts apps/market/src/http/routes/agents.test.ts
git commit -m "✨ feat(market): expose trusted userinfo and agent APIs"
```

## Task 7: Add SDK Contract Tests for Agent Endpoints

**Files:**

- Create: `apps/market/src/sdk-contract/agents.test.ts`

- Create: `apps/market/src/test-utils.ts`

- [ ] **Step 1: Create `apps/market/src/test-utils.ts`**

```ts
import { buildTrustedClientPayload, createTrustedClientToken } from '@lobehub/market-sdk';

import { getTestDB } from '@lobechat/database/test-utils';

import { createMarketApp } from './app';

export const marketTestSecret = 'lobehub-market_tcs_test-secret-for-market-service';
export const marketTestEnv = {
  MARKET_TRUSTED_CLIENT_ID: 'internal-lobehub',
  MARKET_TRUSTED_CLIENT_SECRET: marketTestSecret,
};

export const createMarketTrustToken = (overrides: Partial<{ email: string; name: string; userId: string }> = {}) =>
  createTrustedClientToken(
    buildTrustedClientPayload({
      clientId: marketTestEnv.MARKET_TRUSTED_CLIENT_ID,
      email: overrides.email ?? 'aaryn@example.com',
      name: overrides.name ?? 'Aaryn',
      userId: overrides.userId ?? 'user_123',
    }),
    marketTestSecret,
  );

export const createMarketTestFetch = async () => {
  const db = await getTestDB();
  const app = createMarketApp({ db, env: marketTestEnv });

  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    return app.request(`${url.pathname}${url.search}`, init);
  };
};
```

- [ ] **Step 2: Create SDK contract test**

Create `apps/market/src/sdk-contract/agents.test.ts`:

```ts
import { MarketSDK } from '@lobehub/market-sdk';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { marketAccounts, marketAgentVersions, marketAgents } from '@lobechat/database/schemas';
import { getTestDB } from '@lobechat/database/test-utils';

import { createMarketTestFetch, createMarketTrustToken } from '../test-utils';

describe('MarketSDK agent contract', () => {
  beforeEach(async () => {
    const db = await getTestDB();
    await db.delete(marketAgentVersions);
    await db.delete(marketAgents);
    await db.delete(marketAccounts);
    vi.stubGlobal('fetch', await createMarketTestFetch());
  });

  it('creates, versions, publishes, lists, reads, and forks agents through MarketSDK', async () => {
    const sdk = new MarketSDK({
      baseURL: 'http://market.test',
      trustedClientToken: createMarketTrustToken(),
    });

    await sdk.agents.createAgent({ identifier: 'sdk-agent', name: 'SDK Agent' });
    await sdk.agents.createAgentVersion({
      config: { systemRole: 'SDK prompt' },
      description: 'Created through SDK',
      identifier: 'sdk-agent',
      name: 'SDK Agent',
    });
    await sdk.agents.publish('sdk-agent');

    const list = await sdk.agents.getAgentList({ page: 1, pageSize: 20 });
    expect(list.items.map((item) => item.identifier)).toContain('sdk-agent');

    const identifiers = await sdk.agents.getPublishedIdentifiers();
    expect(identifiers).toContainEqual({ id: 'sdk-agent', lastModified: expect.any(String) });

    const categories = await sdk.agents.getCategories();
    expect(categories).toEqual([]);

    const detail = await sdk.agents.getAgentDetail('sdk-agent');
    expect(detail.config).toEqual({ systemRole: 'SDK prompt' });

    const installCount = await sdk.agents.increaseInstallCount('sdk-agent');
    expect(installCount).toMatchObject({ identifier: 'sdk-agent', installCount: 1, success: true });

    const secondSdk = new MarketSDK({
      baseURL: 'http://market.test',
      trustedClientToken: createMarketTrustToken({ email: 'second@example.com', userId: 'user_456' }),
    });
    const fork = await secondSdk.agents.forkAgent('sdk-agent', {
      identifier: 'sdk-agent-fork',
      visibility: 'private',
    });
    expect(fork.agent.identifier).toBe('sdk-agent-fork');

    const forks = await sdk.agents.getAgentForks('sdk-agent');
    expect(forks.totalCount).toBe(1);

    const forkSource = await secondSdk.agents.getAgentForkSource('sdk-agent-fork');
    expect(forkSource.source?.identifier).toBe('sdk-agent');
  });
});
```

- [ ] **Step 3: Run the SDK contract test and verify it passes**

Run: `pnpm --filter @lobechat/market test -- sdk-contract/agents.test.ts`

Expected: PASS.

- [ ] **Step 4: Commit SDK contract tests**

```bash
git add apps/market/src/test-utils.ts apps/market/src/sdk-contract/agents.test.ts
git commit -m "✅ test(market): cover agent SDK compatibility"
```

## Task 8: Wire Docker Compose and LobeHub Proxy Shell

**Files:**

- Modify: `docker-compose/deploy/docker-compose.yml`

- Create: `apps/market/Dockerfile`

- Create: `src/app/(backend)/market-api/[[...segments]]/route.ts`

- Test: `src/app/(backend)/market-api/[[...segments]]/route.test.ts`

- [ ] **Step 1: Write proxy route tests**

Create `src/app/(backend)/market-api/[[...segments]]/route.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';

import { GET } from './route';

describe('/market-api proxy route', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('proxies requests to MARKET_BASE_URL without exposing Docker hostnames to the browser', async () => {
    vi.stubEnv('MARKET_BASE_URL', 'http://market:3211');
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('zip-bytes', {
        headers: { 'content-type': 'application/zip' },
        status: 200,
      }),
    );

    const response = await GET(new Request('https://lobehub.example.com/market-api/api/v1/skills/demo/download'), {
      params: Promise.resolve({ segments: ['api', 'v1', 'skills', 'demo', 'download'] }),
    });

    expect(fetchSpy).toHaveBeenCalledWith('http://market:3211/api/v1/skills/demo/download', {
      headers: expect.any(Headers),
      method: 'GET',
    });
    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe('zip-bytes');
  });
});
```

- [ ] **Step 2: Run the proxy route test and verify it fails**

Run: `bunx vitest run --silent='passed-only' 'src/app/(backend)/market-api/[[...segments]]/route.test.ts'`

Expected: FAIL because the proxy route does not exist.

- [ ] **Step 3: Create `src/app/(backend)/market-api/[[...segments]]/route.ts`**

```ts
import type { NextRequest } from 'next/server';

type RouteContext = {
  params: Promise<{ segments?: string[] }>;
};

const getMarketBaseUrl = () => {
  if (!process.env.MARKET_BASE_URL) throw new Error('MARKET_BASE_URL is required for /market-api proxying.');
  return process.env.MARKET_BASE_URL;
};

const proxy = async (req: NextRequest | Request, context: RouteContext) => {
  const { segments = [] } = await context.params;
  const sourceUrl = new URL(req.url);
  const targetUrl = new URL(`/${segments.map(encodeURIComponent).join('/')}${sourceUrl.search}`, getMarketBaseUrl());
  const headers = new Headers(req.headers);

  headers.delete('host');

  return fetch(targetUrl.toString(), {
    body: req.method === 'GET' || req.method === 'HEAD' ? undefined : await req.arrayBuffer(),
    headers,
    method: req.method,
  });
};

export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
export const PATCH = proxy;
export const DELETE = proxy;
export const OPTIONS = proxy;

export const dynamic = 'force-dynamic';
```

- [ ] **Step 4: Run the proxy route test and verify it passes**

Run: `bunx vitest run --silent='passed-only' 'src/app/(backend)/market-api/[[...segments]]/route.test.ts'`

Expected: PASS.

- [ ] **Step 5: Modify `docker-compose/deploy/docker-compose.yml`**

Add these `lobe.environment` lines:

```yaml
      - 'MARKET_BASE_URL=http://market:3211'
      - 'MARKET_TRUSTED_CLIENT_ID=${MARKET_TRUSTED_CLIENT_ID}'
      - 'MARKET_TRUSTED_CLIENT_SECRET=${MARKET_TRUSTED_CLIENT_SECRET}'
```

Add `market` to `lobe.depends_on`:

```yaml
      market:
        condition: service_started
```

Add a new service after `lobe`:

```yaml
  market:
    build:
      context: ../..
      dockerfile: apps/market/Dockerfile
    container_name: lobehub-market
    depends_on:
      postgresql:
        condition: service_healthy
    environment:
      - 'DATABASE_URL=postgresql://postgres:${POSTGRES_PASSWORD}@postgresql:5432/${LOBE_DB_NAME}'
      - 'MARKET_BASE_URL=http://market:3211'
      - 'MARKET_PORT=3211'
      - 'MARKET_PUBLIC_BASE_URL=${APP_URL}/market-api'
      - 'MARKET_TRUSTED_CLIENT_ID=${MARKET_TRUSTED_CLIENT_ID}'
      - 'MARKET_TRUSTED_CLIENT_SECRET=${MARKET_TRUSTED_CLIENT_SECRET}'
    restart: always
    networks:
      - lobe-network
```

- [ ] **Step 6: Create `apps/market/Dockerfile`**

```dockerfile
ARG NODEJS_VERSION="24"

FROM node:${NODEJS_VERSION}-slim AS runner

WORKDIR /app

COPY package.json pnpm-workspace.yaml ./
COPY .npmrc ./
COPY packages ./packages
COPY apps/market ./apps/market
COPY pnpm-lock.yaml ./

RUN npm i -g corepack@latest \
  && corepack enable \
  && corepack use $(sed -n 's/.*"packageManager": "\(.*\)".*/\1/p' package.json) \
  && pnpm install --filter @lobechat/market --prod --frozen-lockfile

ENV NODE_ENV="production"
ENV MARKET_PORT="3211"

EXPOSE 3211

CMD ["node", "--import", "tsx", "apps/market/src/index.ts"]
```

- [ ] **Step 7: Check the Compose file parses**

Run: `POSTGRES_PASSWORD=test LOBE_DB_NAME=lobehub APP_URL=http://localhost:3210 MARKET_TRUSTED_CLIENT_ID=internal-lobehub MARKET_TRUSTED_CLIENT_SECRET=lobehub-market_tcs_test docker compose -f docker-compose/deploy/docker-compose.yml config`

Expected: PASS and the rendered config includes a `market` service and `MARKET_BASE_URL: http://market:3211` for `lobe`.

- [ ] **Step 8: Commit Compose and proxy changes**

```bash
git add docker-compose/deploy/docker-compose.yml apps/market/Dockerfile 'src/app/(backend)/market-api/[[...segments]]/route.ts' 'src/app/(backend)/market-api/[[...segments]]/route.test.ts'
git commit -m "🔧 feat(market): wire co-hosted Market deployment path"
```

## Task 9: Run Targeted Verification

**Files:**

- No new files.

- [ ] **Step 1: Run Market tests**

Run: `pnpm --filter @lobechat/market test`

Expected: all Market service tests pass.

- [ ] **Step 2: Run database schema test**

Run: `bunx vitest run --silent='passed-only' packages/database/src/models/__tests__/marketSchema.test.ts`

Expected: PASS.

- [ ] **Step 3: Run proxy route test**

Run: `bunx vitest run --silent='passed-only' 'src/app/(backend)/market-api/[[...segments]]/route.test.ts'`

Expected: PASS.

- [ ] **Step 4: Run type checks for touched packages**

Run: `pnpm --filter @lobechat/market type-check`

Expected: PASS.

Run: `bun run type-check`

Expected: PASS.

- [ ] **Step 5: Inspect for accidental calls to the public Market URL in this slice**

Run: `git grep "https://market.lobehub.com" -- apps/market src/app/\(backend\)/market-api packages/database/src/schemas/market.ts`

Expected: no matches.

- [ ] **Step 6: Commit verification-only fixes if needed**

If verification exposes fixes, commit them with a specific message describing the corrected failure. If verification passes without code changes, do not create an empty commit.

## Task 10: Prepare the Next Phase Handoff

**Files:**

- Modify: `docs/superpowers/specs/2026-04-28-internal-community-market-api-design.md` only if implementation discovers a spec-level correction.

- Create: no new files in this task.

- [ ] **Step 1: Record implementation notes in the final response**

Summarize:

- The Market service entrypoint and health endpoint.

- The trusted-client auth behavior.

- The Market account and agent tables.

- The supported agent endpoints.

- The commands run and their exact pass/fail status.

- Any out-of-scope items from the original broad spec.

- [ ] **Step 2: Recommend the next plan**

Recommend writing `docs/superpowers/plans/YYYY-MM-DD-internal-community-market-api-agent-groups-users.md` next. That plan should cover agent groups, user profile update/read/register routes, and the remaining `/lobehub-oidc/userinfo` shape refinements required by profile setup.

- [ ] **Step 3: Ensure the branch is clean before handoff**

Run: `git status --short --branch`

Expected: clean branch with no unstaged or untracked implementation files.
