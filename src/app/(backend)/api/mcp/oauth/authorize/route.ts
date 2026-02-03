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
  getPublicBaseUrl,
  isBindAddress,
  registerClient,
} from '@/server/services/mcp/oauth';

export const dynamic = 'force-dynamic';

const PENDING_TTL_MS = 10 * 60 * 1000; // 10 minutes

export async function POST(request: NextRequest) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const userId = session.user.id;

  let body: {
    callbackBase?: string;
    mcpUrl: string;
    pluginId: string;
    redirectUri: string;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const {
    callbackBase: clientCallbackBase,
    mcpUrl,
    pluginId,
    redirectUri: successRedirectUri,
  } = body;
  if (!mcpUrl || !pluginId || !successRedirectUri) {
    return NextResponse.json(
      { error: 'mcpUrl, pluginId, and redirectUri are required' },
      { status: 400 },
    );
  }
  let callbackBase: string;
  if (clientCallbackBase) {
    try {
      const u = new URL(clientCallbackBase);
      if (!isBindAddress(u.hostname)) callbackBase = u.origin;
      else callbackBase = getPublicBaseUrl(appEnv.APP_URL, request.headers);
    } catch {
      callbackBase = getPublicBaseUrl(appEnv.APP_URL, request.headers);
    }
  } else {
    callbackBase = getPublicBaseUrl(appEnv.APP_URL, request.headers);
  }
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
