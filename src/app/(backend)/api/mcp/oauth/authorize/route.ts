import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'node:crypto';
import urlJoin from 'url-join';

import { auth } from '@/auth';
import { getServerDB } from '@/database/core/db-adaptor';
import { McpOauthModel } from '@/database/models/mcpOauth';
import { appEnv } from '@/envs/app';
import {
  buildAuthorizeUrl,
  discover,
  generatePKCE,
  registerClient,
} from '@/server/services/mcp/oauth';

export const dynamic = 'force-dynamic';

const PENDING_TTL_MS = 10 * 60 * 1000; // 10 minutes

/** Host is a bind address or localhost; OAuth providers cannot reach it. */
function isBindAddress(host: string): boolean {
  const h = host.toLowerCase();
  return h === '0.0.0.0' || h === '127.0.0.1' || h === 'localhost' || h.startsWith('127.');
}

/** Base URL for OAuth callback. When APP_URL is a bind address, use proxy headers or Origin/Referer. */
function getOAuthCallbackBase(request: NextRequest): string {
  let appUrl: URL;
  try {
    appUrl = new URL(appEnv.APP_URL);
  } catch {
    return appEnv.APP_URL;
  }
  if (!isBindAddress(appUrl.hostname)) return appEnv.APP_URL;

  const proto = request.headers.get('x-forwarded-proto') || appUrl.protocol.replace(':', '');
  const forwardedHost = request.headers.get('x-forwarded-host');
  if (forwardedHost) return `${proto}://${forwardedHost}`;

  const origin = request.headers.get('origin');
  if (origin) {
    try {
      const u = new URL(origin);
      if (!isBindAddress(u.hostname)) return origin;
    } catch {
      // ignore invalid origin
    }
  }

  const referer = request.headers.get('referer');
  if (referer) {
    try {
      const u = new URL(referer);
      if (!isBindAddress(u.hostname)) return u.origin;
    } catch {
      // ignore invalid referer
    }
  }

  return appEnv.APP_URL;
}

export async function POST(request: NextRequest) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const userId = session.user.id;

  let body: { mcpUrl: string; pluginId: string; redirectUri: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const { mcpUrl, pluginId, redirectUri: successRedirectUri } = body;
  if (!mcpUrl || !pluginId || !successRedirectUri) {
    return NextResponse.json(
      { error: 'mcpUrl, pluginId, and redirectUri are required' },
      { status: 400 },
    );
  }
  // OAuth provider redirects here; use public base (from APP_URL or X-Forwarded-* when APP_URL is bind address)
  const callbackBase = getOAuthCallbackBase(request);
  const oauthRedirectUri = urlJoin(callbackBase, '/api/mcp/oauth/callback');

  let mcpBaseUrl: string;
  try {
    mcpBaseUrl = new URL(mcpUrl).toString();
  } catch {
    return NextResponse.json({ error: 'Invalid mcpUrl' }, { status: 400 });
  }

  try {
    const discoverResult = await discover(mcpBaseUrl);
    if (!discoverResult.requiresOAuth) {
      return NextResponse.json(
        { error: 'MCP server does not require OAuth or discovery failed' },
        { status: 400 },
      );
    }
    const { serverMetadata } = discoverResult;
    const registrationEndpoint = serverMetadata.registration_endpoint;
    if (!registrationEndpoint) {
      return NextResponse.json({ error: 'MCP_OAuth_NoRegistrationEndpoint' }, { status: 400 });
    }

    const client = await registerClient(
      registrationEndpoint,
      serverMetadata,
      oauthRedirectUri,
      `LobeHub MCP (${pluginId})`,
    );

    const { codeChallenge, codeVerifier } = generatePKCE();
    const state = randomBytes(24).toString('base64url');
    const expiresAt = new Date(Date.now() + PENDING_TTL_MS);

    const serverDB = await getServerDB();
    const mcpOauthModel = new McpOauthModel(serverDB);
    await mcpOauthModel.createPending({
      clientId: client.client_id,
      codeVerifier,
      expiresAt,
      mcpUrl: mcpBaseUrl,
      metadata: { pluginId },
      pluginIdentifier: pluginId,
      redirectUri: successRedirectUri,
      state,
      tokenEndpoint: serverMetadata.token_endpoint,
      userId,
    });

    const authorizationUrl = buildAuthorizeUrl({
      authorizationEndpoint: serverMetadata.authorization_endpoint,
      clientId: client.client_id,
      codeChallenge,
      redirectUri: oauthRedirectUri,
      scope: Array.isArray(serverMetadata.scopes_supported)
        ? serverMetadata.scopes_supported.join(' ')
        : undefined,
      state,
    });

    return NextResponse.json({ authorizationUrl });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Authorize failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
