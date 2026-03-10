import { sql } from 'drizzle-orm';

import { getBatchSize, getMigrationMode, isDryRun } from './_internal/config';
import { db, pool, schema } from './_internal/db';

const BATCH_SIZE = getBatchSize();
const PROGRESS_TABLE = sql.identifier('nextauth_migration_progress');
const IS_DRY_RUN = isDryRun();
const formatDuration = (ms: number) => `${(ms / 1000).toFixed(1)}s`;

// ANSI color codes
const GREEN_BOLD = '\u001B[1;32m';
const RED_BOLD = '\u001B[1;31m';
const RESET = '\u001B[0m';

function chunk<T>(items: T[], size: number): T[][] {
  if (!Number.isFinite(size) || size <= 0) return [items];
  const result: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    result.push(items.slice(i, i + size));
  }
  return result;
}

/**
 * Convert expires_at (seconds since epoch) to Date
 */
function convertExpiresAt(expiresAt: number | null): Date | undefined {
  if (expiresAt === null || expiresAt === undefined) return undefined;
  return new Date(expiresAt * 1000);
}

/**
 * Convert scope format from NextAuth (space-separated) to Better Auth (comma-separated)
 * e.g., "openid profile email" -> "openid,profile,email"
 */
function convertScope(scope: string | null): string | undefined {
  if (!scope) return undefined;
  return scope.trim().split(/\s+/).join(',');
}

/**
 * Create a composite key for nextauth_accounts (provider + providerAccountId)
 */
function createAccountKey(provider: string, providerAccountId: string): string {
  return `${provider}__${providerAccountId}`;
}

async function loadNextAuthAccounts() {
  const rows = await db.select().from(schema.nextauthAccounts);
  return rows;
}

async function migrateFromNextAuth() {
  const mode = getMigrationMode();
  const nextauthAccounts = await loadNextAuthAccounts();

  if (!IS_DRY_RUN) {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS ${PROGRESS_TABLE} (
        account_key TEXT PRIMARY KEY,
        processed_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
  }

  const processedAccounts = new Set<string>();

  if (!IS_DRY_RUN) {
    try {
      const processedResult = await db.execute<{ account_key: string }>(
        sql`SELECT account_key FROM ${PROGRESS_TABLE};`,
      );
      const rows = (processedResult as { rows?: { account_key: string }[] }).rows ?? [];

      for (const row of rows) {
        const accountKey = row?.account_key;
        if (typeof accountKey === 'string') {
          processedAccounts.add(accountKey);
        }
      }
    } catch (error) {
      console.warn(
        '[nextauth-to-betterauth] failed to read progress table, treating as empty',
        error,
      );
    }
  }

  console.log(`[nextauth-to-betterauth] mode: ${mode} (dryRun=${IS_DRY_RUN})`);
  console.log(`[nextauth-to-betterauth] nextauth accounts: ${nextauthAccounts.length}`);
  console.log(`[nextauth-to-betterauth] already processed: ${processedAccounts.size}`);

  const unprocessedAccounts = nextauthAccounts.filter(
    (acc) => !processedAccounts.has(createAccountKey(acc.provider, acc.providerAccountId)),
  );
  const batches = chunk(unprocessedAccounts, BATCH_SIZE);
  console.log(
    `[nextauth-to-betterauth] batches: ${batches.length} (batchSize=${BATCH_SIZE}, toProcess=${unprocessedAccounts.length})`,
  );

  let processed = 0;
  const skipped = nextauthAccounts.length - unprocessedAccounts.length;
  const startedAt = Date.now();
  const providerCounts: Record<string, number> = {};

  const bumpProviderCount = (providerId: string) => {
    providerCounts[providerId] = (providerCounts[providerId] ?? 0) + 1;
  };

  for (let batchIndex = 0; batchIndex < batches.length; batchIndex += 1) {
    const batch = batches[batchIndex];
    const accountRows: (typeof schema.account.$inferInsert)[] = [];
    const accountKeys: string[] = [];

    for (const nextauthAccount of batch) {
      const accountKey = createAccountKey(
        nextauthAccount.provider,
        nextauthAccount.providerAccountId,
      );

      const accountRow: typeof schema.account.$inferInsert = {
        accessToken: nextauthAccount.access_token ?? undefined,
        accessTokenExpiresAt: convertExpiresAt(nextauthAccount.expires_at),
        accountId: nextauthAccount.providerAccountId,
        // id and createdAt/updatedAt use database defaults
        id: accountKey, // deterministic id based on provider + providerAccountId
        idToken: nextauthAccount.id_token ?? undefined,
        providerId: nextauthAccount.provider,
        refreshToken: nextauthAccount.refresh_token ?? undefined,
        scope: convertScope(nextauthAccount.scope),
        userId: nextauthAccount.userId,
      };

      accountRows.push(accountRow);
      accountKeys.push(accountKey);
      bumpProviderCount(nextauthAccount.provider);
    }

    if (!IS_DRY_RUN) {
      await db.transaction(async (tx) => {
        if (accountRows.length > 0) {
          await tx.insert(schema.account).values(accountRows).onConflictDoNothing();
        }

        const accountKeyValues = accountKeys.map((key) => sql`(${key})`);
        if (accountKeyValues.length > 0) {
          await tx.execute(sql`
            INSERT INTO ${PROGRESS_TABLE} (account_key)
            VALUES ${sql.join(accountKeyValues, sql`, `)}
            ON CONFLICT (account_key) DO NOTHING;
          `);
        }
      });
    }

    processed += batch.length;
    console.log(
      `[nextauth-to-betterauth] batch ${batchIndex + 1}/${batches.length} done, accounts ${processed}/${unprocessedAccounts.length}, dryRun=${IS_DRY_RUN}`,
    );
  }

  console.log(
    `[nextauth-to-betterauth] completed accounts=${GREEN_BOLD}${processed}${RESET}, skipped=${skipped}, dryRun=${IS_DRY_RUN}, elapsed=${formatDuration(Date.now() - startedAt)}`,
  );

  const providerCountsText = Object.entries(providerCounts)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([providerId, count]) => `${providerId}=${count}`)
    .join(', ');

  console.log(`[nextauth-to-betterauth] provider counts: ${providerCountsText || 'none recorded'}`);
}

async function main() {
  const startedAt = Date.now();
  const mode = getMigrationMode();

  console.log('');
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║        NextAuth to Better Auth Migration Script            ║');
  console.log('╠════════════════════════════════════════════════════════════╣');
  console.log(`║  Mode:     ${mode.padEnd(48)}║`);
  console.log(`║  Dry Run:  ${(IS_DRY_RUN ? 'YES (no changes will be made)' : 'NO').padEnd(48)}║`);
  console.log(`║  Batch:    ${String(BATCH_SIZE).padEnd(48)}║`);
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log('');

  if (mode === 'prod' && !IS_DRY_RUN) {
    console.log('⚠️  WARNING: Running in PRODUCTION mode. Data will be modified!');
    console.log('   Type "yes" to continue or press Ctrl+C to abort.');
    console.log('');

    const readline = await import('node:readline');
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const answer = await new Promise<string>((resolve) => {
      rl.question('   Confirm (yes/no): ', (ans) => {
        resolve(ans);
      });
    });
    rl.close();

    if (answer.toLowerCase() !== 'yes') {
      console.log('❌ Aborted by user.');
      process.exitCode = 0;
      await pool.end();
      return;
    }
    console.log('');
  }

  try {
    await migrateFromNextAuth();
    console.log('');
    console.log(
      `${GREEN_BOLD}✅ Migration success!${RESET} (${formatDuration(Date.now() - startedAt)})`,
    );
  } catch (error) {
    console.log('');
    console.error(
      `${RED_BOLD}❌ Migration failed${RESET} (${formatDuration(Date.now() - startedAt)}):`,
      error,
    );
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

void main();
