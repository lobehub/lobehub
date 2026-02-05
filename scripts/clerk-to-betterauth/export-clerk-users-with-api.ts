import './_internal/env';

import { writeFile } from 'node:fs/promises';

import { getClerkSecret, getMigrationMode, resolveDataPaths } from './_internal/config';
import type { ClerkApiUser, ClerkUser } from './_internal/types';

/**
 * Fetch all Clerk users via REST API and persist them into a local JSON file.
 *
 * Usage:
 *   tsx scripts/clerk-to-betterauth/export-clerk-users.ts [outputPath]
 *
 * Env vars required (set by CLERK_TO_BETTERAUTH_MODE=test|prod):
 *   - TEST_CLERK_TO_BETTERAUTH_CLERK_SECRET_KEY (test)
 *   - PROD_CLERK_TO_BETTERAUTH_CLERK_SECRET_KEY (prod)
 */
const PAGE_SIZE = 500;
const CONCURRENCY = Number(process.env.CLERK_EXPORT_CONCURRENCY ?? 10);
const MAX_RETRIES = Number(process.env.CLERK_EXPORT_RETRIES ?? 10);
const RETRY_DELAY_MS = 1000;
const ORDER_BY = '+created_at';
const DEFAULT_OUTPUT_PATH = resolveDataPaths().clerkUsersPath;
const formatDuration = (ms: number) => `${(ms / 1000).toFixed(1)}s`;

const CLERK_API_BASE = 'https://api.clerk.com/v1';

const sleep = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

async function fetchClerkApi<T>(secretKey: string, endpoint: string): Promise<T> {
  const response = await fetch(`${CLERK_API_BASE}${endpoint}`, {
    headers: {
      Authorization: `Bearer ${secretKey}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Clerk API error: ${response.status} ${response.statusText}`);
  }

  return response.json() as Promise<T>;
}

function mapClerkUser(user: ClerkApiUser): ClerkUser {
  const primaryEmail = user.email_addresses?.find(
    (email) => email.id === user.primary_email_address_id,
  )?.email_address;

  return {
    banned: user.banned,
    created_at: user.created_at,
    external_accounts: (user.external_accounts ?? []).map((acc) => ({
      approved_scopes: acc.approved_scopes,
      created_at: acc.created_at,
      id: acc.id,
      provider: acc.provider,
      provider_user_id: acc.provider_user_id,
      updated_at: acc.updated_at,
      verificationStatus: acc.verification?.status === 'verified',
    })),
    id: user.id,
    image_url: user.image_url,
    lockout_expires_in_seconds: user.lockout_expires_in_seconds,
    password_enabled: user.password_enabled,
    password_last_updated_at: user.password_last_updated_at,
    primaryEmail,
    two_factor_enabled: user.two_factor_enabled,
    updated_at: user.updated_at,
  } satisfies ClerkUser;
}

async function fetchClerkUserPage(
  offset: number,
  secretKey: string,
  pageIndex: number,
): Promise<ClerkUser[]> {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
    try {
      console.log(
        `🚚 [clerk-export] Fetching page #${pageIndex + 1} offset=${offset} limit=${PAGE_SIZE} (attempt ${attempt}/${MAX_RETRIES})`,
      );

      const params = new URLSearchParams({
        limit: String(PAGE_SIZE),
        offset: String(offset),
        order_by: ORDER_BY,
      });

      const data = await fetchClerkApi<ClerkApiUser[]>(secretKey, `/users?${params}`);

      console.log(
        `📥 [clerk-export] Received page #${pageIndex + 1} (${data.length} users) offset=${offset}`,
      );

      return data.map(mapClerkUser);
    } catch (error) {
      const isLastAttempt = attempt === MAX_RETRIES;
      const message = error instanceof Error ? error.message : String(error);
      console.warn(
        `⚠️ [clerk-export] Page #${pageIndex + 1} offset=${offset} failed (attempt ${attempt}/${MAX_RETRIES}): ${message}`,
      );

      if (isLastAttempt) {
        throw error;
      }

      await sleep(RETRY_DELAY_MS);
    }
  }

  // Unreachable, but satisfies TypeScript return.
  return [];
}

async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<void>,
): Promise<void> {
  const queue = [...items];
  const inFlight: Promise<void>[] = [];
  let index = 0;

  const launchNext = () => {
    if (!queue.length) return;
    const currentItem = queue.shift() as T;
    const currentIndex = index;
    index += 1;
    const task = worker(currentItem, currentIndex).finally(() => {
      const pos = inFlight.indexOf(task);
      if (pos !== -1) inFlight.splice(pos, 1);
    });
    inFlight.push(task);
  };

  for (let i = 0; i < concurrency && queue.length; i += 1) {
    launchNext();
  }

  while (inFlight.length) {
    await Promise.race(inFlight);
    launchNext();
  }
}

async function fetchAllClerkUsers(secretKey: string): Promise<ClerkUser[]> {
  const userMap = new Map<string, ClerkUser>();

  // Get total count first
  const countResponse = await fetchClerkApi<{ total_count: number }>(secretKey, '/users/count');
  const totalCount = countResponse.total_count;
  const totalPages = Math.ceil(totalCount / PAGE_SIZE);
  const offsets = Array.from({ length: totalPages }, (_, pageIndex) => pageIndex * PAGE_SIZE);

  console.log(
    `📊 [clerk-export] Total users: ${totalCount}. Pages: ${totalPages}. Concurrency: ${CONCURRENCY}.`,
  );

  await runWithConcurrency(offsets, CONCURRENCY, async (offset, index) => {
    const page = await fetchClerkUserPage(offset, secretKey, index);

    for (const user of page) {
      userMap.set(user.id, user);
    }

    if ((index + 1) % CONCURRENCY === 0 || index === offsets.length - 1) {
      console.log(
        `⏳ [clerk-export] Progress: ${userMap.size}/${totalCount} unique users collected.`,
      );
    }
  });

  const uniqueCount = userMap.size;
  const extraUsers = Math.max(0, uniqueCount - totalCount);

  console.log(
    `🆕 [clerk-export] Snapshot total=${totalCount}, final unique=${uniqueCount}, new during export=${extraUsers}`,
  );

  return Array.from(userMap.values());
}

async function main() {
  const startedAt = Date.now();
  const mode = getMigrationMode();
  const secretKey = getClerkSecret();
  const outputPath = process.argv[2] ?? DEFAULT_OUTPUT_PATH;

  console.log('');
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║           Clerk Users Export Script (via API)              ║');
  console.log('╠════════════════════════════════════════════════════════════╣');
  console.log(`║  Mode:     ${mode.padEnd(48)}║`);
  console.log(`║  Output:   ${outputPath.padEnd(48)}║`);
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log('');

  const clerkUsers = await fetchAllClerkUsers(secretKey);

  await writeFile(outputPath, JSON.stringify(clerkUsers, null, 2), 'utf8');

  console.log('');
  console.log(
    `✅ Export success! Saved ${clerkUsers.length} users to ${outputPath} (${formatDuration(Date.now() - startedAt)})`,
  );
}

void main().catch((error) => {
  console.log('');
  console.error('❌ Export failed:', error);
  process.exit(1);
});
