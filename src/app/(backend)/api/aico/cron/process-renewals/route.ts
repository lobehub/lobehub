import { NextResponse } from 'next/server';

import { getServerDB } from '@/database/core/db-adaptor';
import { assertCronAuth } from '@/server/services/aico/cronAuth';
import { processDueRenewals } from '@/server/services/aico/renewalScheduler';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Org member period renewals (self-hosted / ops scheduler).
 * Suggested interval: every 1–5 minutes.
 * Auth: `Authorization: Bearer $CRON_SECRET`
 */
export const GET = async (req: Request) => {
  const denied = assertCronAuth(req);
  if (denied) {
    return NextResponse.json({ error: denied.error }, { status: denied.status });
  }

  const db = await getServerDB();
  const results = await processDueRenewals(db);

  return NextResponse.json({
    failed: results.filter((r) => r.status === 'failed').length,
    funded: results.filter((r) => r.status === 'funded').length,
    orgs: results.length,
    results,
    skipped: results.filter((r) => r.status === 'skipped').length,
  });
};
