import { NextResponse } from 'next/server';

import { discover as discoverOAuth } from '@/server/services/mcp/oauth';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const url = searchParams.get('url');
  if (!url) {
    return NextResponse.json({ error: 'url is required' }, { status: 400 });
  }
  let mcpBaseUrl: string;
  try {
    mcpBaseUrl = new URL(url).toString();
  } catch {
    return NextResponse.json({ error: 'Invalid url' }, { status: 400 });
  }
  try {
    const result = await discoverOAuth(mcpBaseUrl);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Discovery failed';
    if (message === 'MCP_OAuth_NoRegistrationEndpoint') {
      return NextResponse.json(
        { error: 'MCP_OAuth_NoRegistrationEndpoint', requiresOAuth: false },
        { status: 400 },
      );
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
