import { NextResponse } from 'next/server';

import { getServerDB } from '@/database/core/db-adaptor';
import { assertCronAuth } from '@/server/services/aico/cronAuth';
import { processKeyOutbox } from '@/server/services/aico/renewalScheduler';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Drain OpenRouter key outbox (disable/reclaim after local revoke or failed renewal).
 * Self-hosted / ops scheduler. Suggested interval: every 1 minute.
 * Auth: `Authorization: Bearer $CRON_SECRET`
 */
export const GET = async (req: Request) => {
  const denied = assertCronAuth(req);
  if (denied) {
    return NextResponse.json({ error: denied.error }, { status: denied.status });
  }

  const db = await getServerDB();
  const result = await processKeyOutbox(db);

  const ok = result.failed === 0;
  return NextResponse.json(result, { status: ok ? 200 : 207 });
};
