import { sql } from 'drizzle-orm';

import { getMigrationMode } from './_internal/config';
import { db, pool, schema } from './_internal/db';
import { loadClerkUsersFromFile, loadCSVData } from './_internal/load-data-from-files';
import type { ClerkExternalAccount } from './_internal/types';
import { generateBackupCodes, safeDateConversion } from './_internal/utils';

const BATCH_SIZE = Number(process.env.CLERK_TO_BETTERAUTH_BATCH_SIZE) || 300;
const PROGRESS_TABLE = sql.identifier('clerk_migration_progress');
const IS_DRY_RUN =
  process.argv.includes('--dry-run') || process.env.CLERK_TO_BETTERAUTH_DRY_RUN === '1';
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

function computeBanExpires(lockoutSeconds?: number | null): Date | undefined {
  if (typeof lockoutSeconds !== 'number') return undefined;
  return new Date(Date.now() + lockoutSeconds * 1000);
}

async function migrateFromClerk() {
  const mode = getMigrationMode();
  const csvUsers = await loadCSVData();
  const clerkUsers = await loadClerkUsersFromFile();
  const clerkUserMap = new Map(clerkUsers.map((u) => [u.id, u]));

  if (!IS_DRY_RUN) {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS ${PROGRESS_TABLE} (
        user_id TEXT PRIMARY KEY,
        processed_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
  }

  const processedUsers = new Set<string>();

  if (!IS_DRY_RUN) {
    try {
      const processedResult = await db.execute<{ user_id: string }>(
        sql`SELECT user_id FROM ${PROGRESS_TABLE};`,
      );
      const rows = (processedResult as { rows?: { user_id: string }[] }).rows ?? [];

      for (const row of rows) {
        const userId = row?.user_id;
        if (typeof userId === 'string') {
          processedUsers.add(userId);
        }
      }
    } catch (error) {
      console.warn('[clerk-to-betterauth] failed to read progress table, treating as empty', error);
    }
  }

  console.log(`[clerk-to-betterauth] mode: ${mode} (dryRun=${IS_DRY_RUN})`);
  console.log(`[clerk-to-betterauth] csv users: ${csvUsers.length}`);
  console.log(`[clerk-to-betterauth] clerk api users: ${clerkUsers.length}`);
  console.log(`[clerk-to-betterauth] already processed: ${processedUsers.size}`);

  const unprocessedUsers = csvUsers.filter((user) => !processedUsers.has(user.id));
  const batches = chunk(unprocessedUsers, BATCH_SIZE);
  console.log(
    `[clerk-to-betterauth] batches: ${batches.length} (batchSize=${BATCH_SIZE}, toProcess=${unprocessedUsers.length})`,
  );

  let processed = 0;
  let accountAttempts = 0;
  let twoFactorAttempts = 0;
  const skipped = csvUsers.length - unprocessedUsers.length;
  const startedAt = Date.now();
  const accountCounts: Record<string, number> = {};
  let missingScopeNonCredential = 0;
  let passwordEnabledButNoDigest = 0;
  const sampleMissingScope: string[] = [];
  const sampleMissingDigest: string[] = [];

  const bumpAccountCount = (providerId: string) => {
    accountCounts[providerId] = (accountCounts[providerId] ?? 0) + 1;
  };

  for (let batchIndex = 0; batchIndex < batches.length; batchIndex += 1) {
    const batch = batches[batchIndex];
    const userRows: (typeof schema.users.$inferInsert)[] = [];
    const accountRows: (typeof schema.account.$inferInsert)[] = [];
    const twoFactorRows: (typeof schema.twoFactor.$inferInsert)[] = [];

    for (const user of batch) {
      const clerkUser = clerkUserMap.get(user.id);
      const lockoutSeconds = clerkUser?.lockout_expires_in_seconds;
      const externalAccounts = clerkUser?.external_accounts as ClerkExternalAccount[] | undefined;

      const userRow: typeof schema.users.$inferInsert = {
        avatar: clerkUser?.image_url,
        banExpires: computeBanExpires(lockoutSeconds) ?? undefined,
        banned: Boolean(clerkUser?.banned),
        clerkCreatedAt: safeDateConversion(clerkUser?.created_at),
        email: user.primary_email_address,
        emailVerified: Boolean(user.verified_email_addresses?.length),
        firstName: user.first_name || undefined,
        id: user.id,
        lastName: user.last_name || undefined,
        phone: user.primary_phone_number || undefined,
        phoneNumberVerified: Boolean(user.verified_phone_numbers?.length),
        role: 'user',
        twoFactorEnabled: Boolean(clerkUser?.two_factor_enabled),
        username: user.username || undefined,
      };
      userRows.push(userRow);

      if (externalAccounts) {
        for (const externalAccount of externalAccounts) {
          const provider = externalAccount.provider;
          const providerUserId = externalAccount.provider_user_id;

          /**
           * Clerk external accounts never contain credential providers and always include provider_user_id.
           * Enforce this assumption to avoid inserting invalid account rows.
           */
          if (provider === 'credential') {
            throw new Error(
              `[clerk-to-betterauth] unexpected credential external account: userId=${user.id}, externalAccountId=${externalAccount.id}`,
            );
          }
          if (!providerUserId) {
            throw new Error(
              `[clerk-to-betterauth] missing provider_user_id: userId=${user.id}, externalAccountId=${externalAccount.id}, provider=${provider}`,
            );
          }

          const providerId = provider.replace('oauth_', '');

          if (!externalAccount.approved_scopes) {
            missingScopeNonCredential += 1;
            if (sampleMissingScope.length < 5) sampleMissingScope.push(user.id);
          }

          accountRows.push({
            accountId: providerUserId,
            createdAt: safeDateConversion(externalAccount.created_at),
            id: externalAccount.id,
            providerId,
            scope: externalAccount.approved_scopes?.replaceAll(/\s+/g, ',') || undefined,
            updatedAt: safeDateConversion(externalAccount.updated_at),
            userId: user.id,
          });
          accountAttempts += 1;
          bumpAccountCount(providerId);
        }
      }

      // Clerk API 不返回 credential external_account；若用户开启密码并且 CSV 提供散列，则补齐本地密码账号
      const passwordEnabled = Boolean(clerkUser?.password_enabled);
      if (passwordEnabled && user.password_digest) {
        const passwordUpdatedAt = clerkUser?.password_last_updated_at;

        accountRows.push({
          accountId: user.id,
          createdAt: safeDateConversion(clerkUser?.created_at),
          id: 'cred_' + user.id,
          password: user.password_digest,
          providerId: 'credential',
          updatedAt: safeDateConversion(
            passwordUpdatedAt ?? clerkUser?.updated_at ?? clerkUser?.created_at,
          ),
          userId: user.id,
        });
        accountAttempts += 1;
        bumpAccountCount('credential');
      } else if (passwordEnabled && !user.password_digest) {
        passwordEnabledButNoDigest += 1;
        if (sampleMissingDigest.length < 5) sampleMissingDigest.push(user.id);
      }

      if (user.totp_secret) {
        twoFactorRows.push({
          backupCodes: await generateBackupCodes(user.totp_secret),
          id: `tf_${user.id}`,
          secret: user.totp_secret,
          userId: user.id,
        });
        twoFactorAttempts += 1;
      }
    }

    if (!IS_DRY_RUN) {
      await db.transaction(async (tx) => {
        await tx
          .insert(schema.users)
          .values(userRows)
          .onConflictDoUpdate({
            set: {
              avatar: sql`excluded.avatar`,
              banExpires: sql`excluded.ban_expires`,
              banned: sql`excluded.banned`,
              clerkCreatedAt: sql`excluded.clerk_created_at`,
              email: sql`excluded.email`,
              emailVerified: sql`excluded.email_verified`,
              firstName: sql`excluded.first_name`,
              lastName: sql`excluded.last_name`,
              phone: sql`excluded.phone`,
              phoneNumberVerified: sql`excluded.phone_number_verified`,
              role: sql`excluded.role`,
              twoFactorEnabled: sql`excluded.two_factor_enabled`,
              username: sql`excluded.username`,
            },
            target: schema.users.id,
          });

        if (accountRows.length > 0) {
          await tx.insert(schema.account).values(accountRows).onConflictDoNothing();
        }

        if (twoFactorRows.length > 0) {
          await tx.insert(schema.twoFactor).values(twoFactorRows).onConflictDoNothing();
        }

        const userIdValues = userRows.map((row) => sql`(${row.id})`);
        if (userIdValues.length > 0) {
          await tx.execute(sql`
            INSERT INTO ${PROGRESS_TABLE} (user_id)
            VALUES ${sql.join(userIdValues, sql`, `)}
            ON CONFLICT (user_id) DO NOTHING;
          `);
        }
      });
    }
    processed += batch.length;
    console.log(
      `[clerk-to-betterauth] batch ${batchIndex + 1}/${batches.length} done, users ${processed}/${unprocessedUsers.length}, accounts+=${accountRows.length}, 2fa+=${twoFactorRows.length}, dryRun=${IS_DRY_RUN}`,
    );
  }

  console.log(
    `[clerk-to-betterauth] completed users=${GREEN_BOLD}${processed}${RESET}, skipped=${skipped}, accounts attempted=${accountAttempts}, 2fa attempted=${twoFactorAttempts}, dryRun=${IS_DRY_RUN}, elapsed=${formatDuration(Date.now() - startedAt)}`,
  );

  const accountCountsText = Object.entries(accountCounts)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([providerId, count]) => `${providerId}=${count}`)
    .join(', ');

  console.log(
    `[clerk-to-betterauth] account provider counts: ${accountCountsText || 'none recorded'}`,
  );

  console.log(
    [
      '[clerk-to-betterauth] anomalies:',
      `  - missing scope (non-credential): ${missingScopeNonCredential} sample=${sampleMissingScope.join(';') || 'n/a'}`,
      `  - passwordEnabled without digest: ${passwordEnabledButNoDigest} sample=${sampleMissingDigest.join(';') || 'n/a'}`,
    ].join('\n'),
  );
}
async function main() {
  const startedAt = Date.now();
  const mode = getMigrationMode();

  console.log('');
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║           Clerk to Better Auth Migration Script            ║');
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
    await migrateFromClerk();
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
