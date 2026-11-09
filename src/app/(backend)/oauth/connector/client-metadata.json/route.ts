import { NextResponse } from 'next/server';

import { buildConnectorClientMetadata } from '@/server/services/connector/oauth';

/**
 * Client ID Metadata Document for custom-connector OAuth. Authorization servers
 * fetch it without a session; APP_URL is read at request time so self-hosted
 * images built once still serve their own origin.
 */
export const GET = () =>
  NextResponse.json(buildConnectorClientMetadata(), {
    headers: { 'cache-control': 'public, max-age=3600' },
  });

export const dynamic = 'force-dynamic';
