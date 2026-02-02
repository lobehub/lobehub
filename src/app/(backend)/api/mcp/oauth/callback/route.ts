import { NextRequest, NextResponse } from 'next/server';

import { getServerDB } from '@/database/core/db-adaptor';
import { McpOauthModel } from '@/database/models/mcpOauth';
import { exchangeCode } from '@/server/services/mcp/oauth';

export const dynamic = 'force-dynamic';

const ERROR_PATH = '/oauth/callback/error';

function redirectToError(request: NextRequest, reason: string, errorMessage?: string) {
  const url = new URL(ERROR_PATH, request.url);
  url.searchParams.set('reason', reason);
  if (errorMessage) url.searchParams.set('errorMessage', errorMessage);
  return NextResponse.redirect(url.toString());
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const state = searchParams.get('state');
  const code = searchParams.get('code');

  if (!state) {
    return redirectToError(request, 'invalid_state');
  }
  if (!code) {
    return redirectToError(request, 'invalid_request', 'Missing code');
  }

  const serverDB = await getServerDB();
  const mcpOauthModel = new McpOauthModel(serverDB);
  const pending = await mcpOauthModel.consumePending(state);
  if (!pending) {
    return redirectToError(request, 'invalid_state');
  }

  const tokenEndpoint = pending.tokenEndpoint;
  if (!tokenEndpoint || !pending.clientId) {
    return redirectToError(request, 'invalid_state');
  }

  try {
    const tokens = await exchangeCode({
      clientId: pending.clientId,
      code,
      codeVerifier: pending.codeVerifier,
      redirectUri: pending.redirectUri,
      tokenEndpoint,
    });

    const expiresAt = tokens.expires_in ? new Date(Date.now() + tokens.expires_in * 1000) : null;
    await mcpOauthModel.upsertTokens({
      accessToken: tokens.access_token,
      clientId: pending.clientId,
      expiresAt,
      pluginIdentifier: pending.pluginIdentifier,
      refreshToken: tokens.refresh_token ?? null,
      tokenEndpoint,
      userId: pending.userId,
    });

    return NextResponse.redirect(pending.redirectUri);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Token exchange failed';
    const isInvalidGrant = message.startsWith('invalid_grant');
    return redirectToError(request, isInvalidGrant ? 'invalid_grant' : 'server_error', message);
  }
}
