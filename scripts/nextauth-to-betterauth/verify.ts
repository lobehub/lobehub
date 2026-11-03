import { getMigrationMode } from './_internal/config';
import { db, pool, schema } from './_internal/db';

type ExpectedAccount = {
  accountId: string;
  providerId: string;
  scope?: string;
  userId: string;
};

type ActualAccount = {
  accountId: string;
  providerId: string;
  scope: string | null;
  userId: string;
};

const MAX_SAMPLES = 5;

const formatDuration = (ms: number) => `${(ms / 1000).toFixed(1)}s`;

function buildAccountKey(account: { accountId: string; providerId: string; userId: string }) {
  return `${account.userId}__${account.providerId}__${account.accountId}`;
}

async function loadNextAuthAccounts() {
  const rows = await db.select().from(schema.nextauthAccounts);
  return rows;
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

function buildExpectedAccounts(nextauthAccounts: Awaited<ReturnType<typeof loadNextAuthAccounts>>) {
  const expectedAccounts: ExpectedAccount[] = [];

  for (const nextauthAccount of nextauthAccounts) {
    expectedAccounts.push({
      accountId: nextauthAccount.providerAccountId,
      providerId: nextauthAccount.provider,
      scope: nextauthAccount.scope ?? undefined,
      userId: nextauthAccount.userId,
    });
  }

  return { expectedAccounts };
}

async function main() {
  const startedAt = Date.now();
  const mode = getMigrationMode();

  console.log('');
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║     NextAuth to Better Auth Verification Script            ║');
  console.log('╠════════════════════════════════════════════════════════════╣');
  console.log(`║  Mode:     ${mode.padEnd(48)}║`);
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log('');

  const [nextauthAccounts, actualAccounts] = await Promise.all([
    loadNextAuthAccounts(),
    loadActualAccounts(),
  ]);

  console.log(`📦 [verify] Loaded nextauth_accounts=${nextauthAccounts.length}`);

  const { expectedAccounts } = buildExpectedAccounts(nextauthAccounts);

  console.log(`🧮 [verify] Expected accounts=${expectedAccounts.length}`);
  console.log(`🗄️ [verify] DB snapshot: accounts=${actualAccounts.length}`);

  const expectedAccountSet = new Set(expectedAccounts.map(buildAccountKey));
  const actualAccountSet = new Set(actualAccounts.map(buildAccountKey));

  let missingAccounts = 0;
  const missingAccountSamples: string[] = [];
  for (const account of expectedAccounts) {
    const key = buildAccountKey(account);
    if (!actualAccountSet.has(key)) {
      missingAccounts += 1;
      if (missingAccountSamples.length < MAX_SAMPLES) {
        missingAccountSamples.push(`${account.providerId}/${account.accountId}`);
      }
    }
  }

  let unexpectedAccounts = 0;
  const unexpectedAccountSamples: string[] = [];
  for (const account of actualAccounts) {
    const key = buildAccountKey(account);
    if (!expectedAccountSet.has(key)) {
      unexpectedAccounts += 1;
      if (unexpectedAccountSamples.length < MAX_SAMPLES) {
        unexpectedAccountSamples.push(`${account.providerId}/${account.accountId}`);
      }
    }
  }

  // Provider counts
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

  // Check for missing scope in actual accounts
  let missingScopeNonCredential = 0;
  const sampleMissingScope: string[] = [];

  for (const account of actualAccounts) {
    if (account.providerId !== 'credential' && !account.scope) {
      // Find corresponding nextauth account to check if it had scope
      const nextauthAccount = nextauthAccounts.find(
        (na) => na.provider === account.providerId && na.providerAccountId === account.accountId,
      );
      if (nextauthAccount?.scope) {
        missingScopeNonCredential += 1;
        if (sampleMissingScope.length < MAX_SAMPLES) {
          sampleMissingScope.push(`${account.providerId}/${account.accountId}`);
        }
      }
    }
  }

  console.log('');
  console.log('📋 [verify] Summary:');
  console.log(
    `   - Missing accounts: ${missingAccounts} ${missingAccountSamples.length > 0 ? `(samples: ${missingAccountSamples.join(', ')})` : ''}`,
  );
  console.log(
    `   - Unexpected accounts: ${unexpectedAccounts} ${unexpectedAccountSamples.length > 0 ? `(samples: ${unexpectedAccountSamples.join(', ')})` : '(accounts not from nextauth)'}`,
  );
  console.log(
    `   - Missing scope (had in nextauth): ${missingScopeNonCredential} ${sampleMissingScope.length > 0 ? `(samples: ${sampleMissingScope.join(', ')})` : ''}`,
  );

  console.log('');
  if (missingAccounts === 0) {
    console.log(
      `✅ Verification success! All nextauth accounts migrated. (${formatDuration(Date.now() - startedAt)})`,
    );
  } else {
    console.log(
      `⚠️ Verification completed with ${missingAccounts} missing accounts. (${formatDuration(Date.now() - startedAt)})`,
    );
  }
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
