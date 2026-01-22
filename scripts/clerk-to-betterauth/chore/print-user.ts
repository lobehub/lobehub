/* eslint-disable unicorn/prefer-top-level-await */
import { createClerkClient } from '@clerk/backend';

import { getClerkSecret, getMigrationMode } from '../config';

async function main() {
  const userId = process.argv[2];

  if (!userId) {
    console.error('Usage: tsx scripts/clerk-to-betterauth/chore/print-user.ts <user_id>');
    process.exitCode = 1;
    return;
  }

  const mode = getMigrationMode();
  const secretKey = getClerkSecret(mode);
  const clerk = createClerkClient({ secretKey });

  const user = await clerk.users.getUser(userId);

  // Clerk SDK 里 user.raw 是最完整的响应；fallback 保底输出 user 对象
  const payload = user.raw ?? user;

  console.log(JSON.stringify(payload, null, 2));
}

void main().catch((error) => {
  console.error('[print-user] failed:', error);
  process.exitCode = 1;
});
