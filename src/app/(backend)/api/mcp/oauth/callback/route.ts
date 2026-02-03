import { NextRequest, NextResponse } from 'next/server';
import urlJoin from 'url-join';

import { getServerDB } from '@/database/core/db-adaptor';
import { McpOauthModel } from '@/database/models/mcpOauth';
import { appEnv } from '@/envs/app';
import { exchangeCode, getPublicBaseUrl } from '@/server/services/mcp/oauth';

export const dynamic = 'force-dynamic';

const ERROR_PATH = '/oauth/callback/error';

function redirectToError(request: NextRequest, reason: string, errorMessage?: string) {
  const base = getPublicBaseUrl(appEnv.APP_URL, request.headers);
  const url = new URL(ERROR_PATH, base);
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

  // Must match the redirect_uri sent to the provider in the authorize step (our API callback URL).
  const base = getPublicBaseUrl(appEnv.APP_URL, request.headers);
  const oauthCallbackUrl = urlJoin(base, '/api/mcp/oauth/callback');

  try {
    const tokens = await exchangeCode({
      clientId: pending.clientId,
      code,
      codeVerifier: pending.codeVerifier,
      redirectUri: oauthCallbackUrl,
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

    const successUrl = new URL(pending.redirectUri);
    const redirectTo = new URL(successUrl.pathname + successUrl.search, base);
    return NextResponse.redirect(redirectTo.toString());
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Token exchange failed';
    const isInvalidGrant = message.startsWith('invalid_grant');
    return redirectToError(request, isInvalidGrant ? 'invalid_grant' : 'server_error', message);
  }
}
