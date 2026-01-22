/* eslint-disable unicorn/prefer-top-level-await */
import { writeFile } from 'node:fs/promises';

import { resolveDataPaths } from '../config';
import { loadClerkUsersFromFile } from '../load-data-from-files';
import { ClerkUser } from '../types';

type Row = {
  otherAuth: string;
  primaryEmail: string | undefined;
  providerId: string;
  provider_user_id: string | undefined;
  scope: string | undefined;
  user_id: string;
  verificationStatus: boolean;
};

function providerIdFromExternal(provider: string) {
  return provider === 'credential' ? 'credential' : provider.replace('oauth_', '');
}

function collectOtherAuth(user: ClerkUser, currentProviderId: string) {
  const providers = new Set<string>();
  for (const acc of user.external_accounts ?? []) {
    const pid = providerIdFromExternal(acc.provider);
    if (pid !== currentProviderId) providers.add(pid);
  }
  // 如果用户开启密码（password_enabled），视为 credential 登录能力
  if (user.password_enabled) providers.add('credential');
  return Array.from(providers).join('|');
}

function toCsv(rows: Row[]): string {
  const headers = [
    'user_id',
    'primary_email',
    'provider_user_id',
    'scope',
    'providerId',
    'otherAuth',
    'VerifyStatus',
  ];
  const lines = [headers.join(',')];
  for (const row of rows) {
    const cells = [
      row.user_id,
      row.primaryEmail ?? '',
      row.provider_user_id ?? '',
      row.scope ?? '',
      row.providerId,
      row.otherAuth,
      String(row.verificationStatus),
    ];
    lines.push(cells.map((c) => c.replaceAll('"', '""')).join(','));
  }
  return lines.join('\n');
}

async function main() {
  const { clerkUsersPath } = resolveDataPaths();
  const users = await loadClerkUsersFromFile(clerkUsersPath);

  const rows: Row[] = [];

  for (const user of users) {
    for (const acc of user.external_accounts ?? []) {
      const providerId = providerIdFromExternal(acc.provider);
      const missingProviderUserId = !acc.provider_user_id;
      const missingScope = !acc.approved_scopes;
      if (missingProviderUserId || missingScope) {
        rows.push({
          otherAuth: collectOtherAuth(user, providerId),
          primaryEmail: user.primaryEmail,
          providerId,
          provider_user_id: acc.provider_user_id,
          scope: acc.approved_scopes,
          user_id: user.id,
          verificationStatus: acc.verificationStatus ?? false,
        });
      }
    }
  }

  const output = toCsv(rows);
  const outPath = 'scripts/clerk-to-betterauth/chore/missing-external-accounts.csv';
  await writeFile(outPath, output, 'utf8');

  const missingProviderUserIdCount = rows.filter((r) => !r.provider_user_id).length;
  const missingScopeCount = rows.filter((r) => !r.scope).length;

  console.log(`Total rows: ${rows.length}`);
  console.log(`Missing provider_user_id: ${missingProviderUserIdCount}`);
  console.log(`Missing scope: ${missingScopeCount}`);
  console.log(`CSV saved to ${outPath}`);
}

void main().catch((error) => {
  console.error('[analyze-missing-external-accounts] failed:', error);
  process.exitCode = 1;
});
