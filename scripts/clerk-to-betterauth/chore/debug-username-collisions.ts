/* eslint-disable unicorn/prefer-top-level-await */
import { sql } from 'drizzle-orm';

import { getMigrationMode } from '../config';
import { db, pool, schema } from '../db';
import '../env';
import { loadCSVData } from '../load-data-from-files';

type DbUserRow = {
  email: string | null;
  id: string;
  username: string | null;
};

type CsvInfo = {
  email: string;
  id: string;
};

async function main() {
  const mode = getMigrationMode();
  console.log(`🔎 [username-debug] mode=${mode}`);

  const csvUsers = await loadCSVData();
  const csvMap = new Map<string, CsvInfo>();
  let csvDupCount = 0;

  for (const row of csvUsers) {
    const username = row.username?.trim();
    if (!username) continue;

    if (csvMap.has(username)) {
      csvDupCount += 1;
      continue;
    }

    csvMap.set(username, {
      email: row.primary_email_address,
      id: row.id,
    });
  }

  const dbResult = await db.execute<DbUserRow>(
    sql`SELECT id, username, email FROM ${schema.users} WHERE username IS NOT NULL;`,
  );
  const dbRows = (dbResult as { rows?: DbUserRow[] }).rows ?? [];
  const dbMap = new Map<string, DbUserRow>();
  for (const row of dbRows) {
    if (row.username) {
      dbMap.set(row.username, row);
    }
  }

  const collisions: Array<{
    csvEmail: string;
    csvId: string;
    dbEmail: string | null;
    dbId: string;
    username: string;
  }> = [];

  for (const [username, csvInfo] of csvMap) {
    const dbInfo = dbMap.get(username);
    if (dbInfo && dbInfo.id !== csvInfo.id) {
      collisions.push({
        csvEmail: csvInfo.email,
        csvId: csvInfo.id,
        dbEmail: dbInfo.email,
        dbId: dbInfo.id,
        username,
      });
    }
  }

  console.log(`🧾 [username-debug] CSV users: ${csvUsers.length}`);
  console.log(
    `🧾 [username-debug] CSV unique usernames: ${csvMap.size} (dup usernames in CSV: ${csvDupCount})`,
  );
  console.log(`🧾 [username-debug] DB usernames: ${dbMap.size}`);
  console.log(
    `⚠️ [username-debug] Username collisions (same name, different id): ${collisions.length}`,
  );

  collisions.slice(0, 20).forEach((item, index) => {
    console.log(
      `#${index + 1} username=${item.username} dbId=${item.dbId} dbEmail=${item.dbEmail ?? 'NULL'} csvId=${item.csvId} csvEmail=${item.csvEmail}`,
    );
  });

  if (collisions.length > 20) {
    console.log(`...and ${collisions.length - 20} more`);
  }
}

async function run() {
  try {
    await main();
  } catch (error) {
    console.error('[username-debug] failed:', error);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

void run();
