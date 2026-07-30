/**
 * Seed the first platform (super) admin.
 *
 * Usage:
 *   bun run scripts/seedPlatformAdmin.mts <userId>
 *   bun run scripts/seedPlatformAdmin.mts --email user@example.com
 */
import { eq } from 'drizzle-orm';

import { getServerDB } from '../packages/database/src/server';
import { OrganizationModel } from '../packages/database/src/models/organization';
import { users } from '../packages/database/src/schemas';

const arg = process.argv[2];
const emailFlag = process.argv[2] === '--email' ? process.argv[3] : undefined;

if (!arg) {
  console.error('Usage: bun run scripts/seedPlatformAdmin.mts <userId>');
  console.error('   or: bun run scripts/seedPlatformAdmin.mts --email <email>');
  process.exit(1);
}

const db = await getServerDB();
const model = new OrganizationModel(db);

let userId = emailFlag ? undefined : arg;
if (emailFlag) {
  const row = await db.query.users.findFirst({
    where: eq(users.email, emailFlag.trim().toLowerCase()),
  });
  if (!row) {
    console.error(`No user with email ${emailFlag}`);
    process.exit(1);
  }
  userId = row.id;
}

const row = await model.addPlatformAdmin(userId!);
console.log(row ? `Seeded platform admin: ${userId}` : `Already platform admin: ${userId}`);
process.exit(0);
