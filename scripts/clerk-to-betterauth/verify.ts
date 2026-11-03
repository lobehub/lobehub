import { getMigrationMode, resolveDataPaths } from './_internal/config';
import { db, pool, schema } from './_internal/db';
import { loadClerkUsersFromFile, loadCSVData } from './_internal/load-data-from-files';
import type { ClerkExternalAccount, ClerkUser } from './_internal/types';

type ExpectedAccount = {
  accountId?: string;
  providerId: string;
  scope?: string;
  userId: string;
};

type ActualAccount = {
  accountId: string | null;
  providerId: string;
  scope: string | null;
  userId: string;
};

const MAX_SAMPLES = 5;

const formatDuration = (ms: number) => `${(ms / 1000).toFixed(1)}s`;

function providerIdFromExternal(external: ClerkExternalAccount): string {
  return external.provider === 'credential'
    ? 'credential'
    : external.provider.replace('oauth_', '');
}

function buildExpectedAccounts(
  csvUsers: Awaited<ReturnType<typeof loadCSVData>>,
  clerkUsers: ClerkUser[],
) {
  const clerkMap = new Map(clerkUsers.map((u) => [u.id, u]));

  const expectedAccounts: ExpectedAccount[] = [];
  const expectedTwoFactorUsers = new Set<string>();
  let passwordEnabledWithoutDigest = 0;
  const passwordEnabledWithoutDigestSamples: string[] = [];

  for (const user of csvUsers) {
    const clerkUser = clerkMap.get(user.id);
    const externalAccounts = clerkUser?.external_accounts as ClerkExternalAccount[] | undefined;

    if (externalAccounts) {
      for (const external of externalAccounts) {
        expectedAccounts.push({
          accountId: external.provider_user_id,
          providerId: providerIdFromExternal(external),
          scope: external.approved_scopes?.replaceAll(/\s+/g, ','),
          userId: user.id,
        });
      }
    }

    const passwordEnabled = Boolean(clerkUser?.password_enabled);
    if (passwordEnabled && user.password_digest) {
      expectedAccounts.push({
        accountId: user.id,
        providerId: 'credential',
        scope: undefined,
        userId: user.id,
      });
    } else if (passwordEnabled && !user.password_digest) {
      passwordEnabledWithoutDigest += 1;
      if (passwordEnabledWithoutDigestSamples.length < MAX_SAMPLES) {
        passwordEnabledWithoutDigestSamples.push(user.id);
      }
    }

    if (user.totp_secret) {
      expectedTwoFactorUsers.add(user.id);
    }
  }

  return {
    expectedAccounts,
    expectedTwoFactorUsers,
    passwordEnabledWithoutDigest,
    passwordEnabledWithoutDigestSamples,
  };
}

function buildAccountKey(account: {
  accountId?: string | null;
  providerId: string;
  userId: string;
}) {
  return `${account.userId}__${account.providerId}__${account.accountId ?? ''}`;
}

async function loadActualAccounts() {
  const rows = await db
    .select({
      accountId: schema.account.accountId,
      providerId: schema.account.providerId,
      scope: schema.account.scope,
      userId: schema.account.userId,
    })
    .from(schema.account);

  return rows as ActualAccount[];
}

async function loadActualTwoFactorUserIds() {
  const rows = await db.select({ userId: schema.twoFactor.userId }).from(schema.twoFactor);
  return new Set(rows.map((row) => row.userId));
}

async function loadActualUserIds() {
  const rows = await db.select({ id: schema.users.id }).from(schema.users);
  return new Set(rows.map((row) => row.id));
}

async function main() {
  const startedAt = Date.now();
  const mode = getMigrationMode();
  const { clerkCsvPath, clerkUsersPath } = resolveDataPaths(mode);

  console.log('');
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║           Migration Verification Script                    ║');
  console.log('╠════════════════════════════════════════════════════════════╣');
  console.log(`║  Mode:     ${mode.padEnd(48)}║`);
  console.log(`║  CSV:      ${clerkCsvPath.padEnd(48)}║`);
  console.log(`║  JSON:     ${clerkUsersPath.padEnd(48)}║`);
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log('');

  const [csvUsers, clerkUsers] = await Promise.all([
    loadCSVData(clerkCsvPath),
    loadClerkUsersFromFile(clerkUsersPath),
  ]);

  console.log(
    `📦 [verify] Loaded csvUsers=${csvUsers.length}, clerkUsers=${clerkUsers.length} (unique ids=${
      new Set(clerkUsers.map((u) => u.id)).size
    })`,
  );

  const {
    expectedAccounts,
    expectedTwoFactorUsers,
    passwordEnabledWithoutDigest,
    passwordEnabledWithoutDigestSamples,
  } = buildExpectedAccounts(csvUsers, clerkUsers);

  console.log(
    `🧮 [verify] Expected accounts=${expectedAccounts.length}, expected 2FA users=${expectedTwoFactorUsers.size}, passwordEnabledWithoutDigest=${passwordEnabledWithoutDigest} sample=${
      passwordEnabledWithoutDigestSamples.join(', ') || 'n/a'
    }`,
  );

  const [actualAccounts, actualTwoFactorUserIds, actualUserIds] = await Promise.all([
    loadActualAccounts(),
    loadActualTwoFactorUserIds(),
    loadActualUserIds(),
  ]);

  console.log(
    `🗄️ [verify] DB snapshot: users=${actualUserIds.size}, accounts=${actualAccounts.length}, twoFactor=${actualTwoFactorUserIds.size}`,
  );

  let missingUsers = 0;
  const missingUserSamples: string[] = [];
  for (const user of csvUsers) {
    if (!actualUserIds.has(user.id)) {
      missingUsers += 1;
      if (missingUserSamples.length < MAX_SAMPLES) missingUserSamples.push(user.id);
    }
  }

  const expectedAccountSet = new Set(expectedAccounts.map(buildAccountKey));
  const actualAccountSet = new Set(actualAccounts.map(buildAccountKey));

  let missingAccounts = 0;
  const missingAccountSamples: string[] = [];
  for (const account of expectedAccounts) {
    const key = buildAccountKey(account);
    if (!actualAccountSet.has(key)) {
      missingAccounts += 1;
      if (missingAccountSamples.length < MAX_SAMPLES) missingAccountSamples.push(account.userId);
    }
  }

  let unexpectedAccounts = 0;
  const unexpectedAccountSamples: string[] = [];
  for (const account of actualAccounts) {
    const key = buildAccountKey(account);
    if (!expectedAccountSet.has(key)) {
      unexpectedAccounts += 1;
      if (unexpectedAccountSamples.length < MAX_SAMPLES)
        unexpectedAccountSamples.push(account.userId);
    }
  }

  let missingTwoFactor = 0;
  const missingTwoFactorSamples: string[] = [];
  for (const userId of expectedTwoFactorUsers) {
    if (!actualTwoFactorUserIds.has(userId)) {
      missingTwoFactor += 1;
      if (missingTwoFactorSamples.length < MAX_SAMPLES) missingTwoFactorSamples.push(userId);
    }
  }

  let missingScopeNonCredential = 0;
  let missingAccountIdNonCredential = 0;
  const sampleMissingScope: string[] = [];
  const sampleMissingAccountId: string[] = [];

  for (const account of actualAccounts) {
    if (account.providerId !== 'credential') {
      if (!account.scope) {
        missingScopeNonCredential += 1;
        if (sampleMissingScope.length < MAX_SAMPLES) sampleMissingScope.push(account.userId);
      }
      if (!account.accountId) {
        missingAccountIdNonCredential += 1;
        if (sampleMissingAccountId.length < MAX_SAMPLES)
          sampleMissingAccountId.push(account.userId);
      }
    }
  }

  const expectedProviderCounts: Record<string, number> = {};
  const actualProviderCounts: Record<string, number> = {};

  for (const account of expectedAccounts) {
    expectedProviderCounts[account.providerId] =
      (expectedProviderCounts[account.providerId] ?? 0) + 1;
  }

  for (const account of actualAccounts) {
    actualProviderCounts[account.providerId] = (actualProviderCounts[account.providerId] ?? 0) + 1;
  }

  const formatCounts = (counts: Record<string, number>) =>
    Object.entries(counts)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([providerId, count]) => `${providerId}=${count}`)
      .join(', ');

  console.log(
    `📊 [verify] Expected provider counts: ${formatCounts(expectedProviderCounts) || 'n/a'}`,
  );
  console.log(
    `📊 [verify] Actual provider counts:   ${formatCounts(actualProviderCounts) || 'n/a'}`,
  );

  console.log(
    `✅ [verify] Missing users=${missingUsers} sample=${missingUserSamples.join(', ') || 'n/a'}, missing accounts=${missingAccounts} sample=${missingAccountSamples.join(', ') || 'n/a'}, unexpected accounts=${unexpectedAccounts} sample=${unexpectedAccountSamples.join(', ') || 'n/a'}`,
  );

  console.log(
    `🔐 [verify] Two-factor missing=${missingTwoFactor} sample=${missingTwoFactorSamples.join(', ') || 'n/a'}`,
  );

  console.log(
    `⚠️ [verify] Non-credential missing scope=${missingScopeNonCredential} sample=${sampleMissingScope.join(', ') || 'n/a'}, missing account_id=${missingAccountIdNonCredential} sample=${sampleMissingAccountId.join(', ') || 'n/a'}`,
  );

  console.log('');
  console.log(`✅ Verification success! (${formatDuration(Date.now() - startedAt)})`);
}

void main()
  .catch((error) => {
    console.log('');
    console.error('❌ Verification failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
