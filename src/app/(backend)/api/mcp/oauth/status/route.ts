import { NextRequest, NextResponse } from 'next/server';

import { auth } from '@/auth';
import { getServerDB } from '@/database/core/db-adaptor';
import { McpOauthModel } from '@/database/models/mcpOauth';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const userId = session.user.id;

  const { searchParams } = new URL(request.url);
  const pluginId = searchParams.get('pluginId');
  if (!pluginId) {
    return NextResponse.json({ error: 'pluginId is required' }, { status: 400 });
  }

  const serverDB = await getServerDB();
  const mcpOauthModel = new McpOauthModel(serverDB);
  const connected = await mcpOauthModel.hasTokens(userId, pluginId);
  return NextResponse.json({ connected });
}
