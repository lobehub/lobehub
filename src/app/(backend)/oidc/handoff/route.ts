import debug from 'debug';
import { type NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { OAuthHandoffModel } from '@/database/models/oauthHandoff';
import { serverDB } from '@/database/server';

const log = debug('lobe-oidc:handoff');

/**
 * GET /oidc/handoff?id=xxx&client=xxx
 * 轮询获取并消费认证凭证
 */
export async function GET(request: NextRequest) {
  log('Received GET request for /oidc/handoff');

  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    const client = searchParams.get('client');

    if (!id || !client) {
      return NextResponse.json(
        { error: 'Missing required parameters: id and client' },
        { status: 400 },
      );
    }

    log('Fetching handoff record - id=%s, client=%s', id, client);

    const authHandoffModel = new OAuthHandoffModel(serverDB);
    const result = await authHandoffModel.fetchAndConsume(id, client);

    if (!result) {
      log('Handoff record not found or expired - id=%s', id);
      return NextResponse.json({ error: 'Handoff record not found or expired' }, { status: 404 });
    }

    log('Handoff record found and consumed - id=%s', id);

    return NextResponse.json({ data: result, success: true });
  } catch (error) {
    log('Error fetching handoff record: %O', error);

    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
