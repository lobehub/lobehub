import { NextRequest, NextResponse } from 'next/server';

import { getServerDB } from '@/database/core/db-adaptor';
import { McpOauthModel } from '@/database/models/mcpOauth';
import { appEnv } from '@/envs/app';
import { exchangeCode } from '@/server/services/mcp/oauth';

export const dynamic = 'force-dynamic';

const ERROR_PATH = '/oauth/callback/error';

function isBindAddress(host: string): boolean {
  const h = host.toLowerCase();
  return h === '0.0.0.0' || h === '127.0.0.1' || h === 'localhost' || h.startsWith('127.');
}

/** Base URL for redirects. Uses X-Forwarded-* when APP_URL is a bind address. */
function getRedirectBase(request: NextRequest): string {
  let appUrl: URL;
  try {
    appUrl = new URL(appEnv.APP_URL);
  } catch {
    return appEnv.APP_URL;
  }
  if (!isBindAddress(appUrl.hostname)) return appEnv.APP_URL;
  const proto = request.headers.get('x-forwarded-proto') || appUrl.protocol.replace(':', '');
  const host = request.headers.get('x-forwarded-host') || request.headers.get('host');
  if (host) return `${proto}://${host}`;
  return appEnv.APP_URL;
}

function redirectToError(request: NextRequest, reason: string, errorMessage?: string) {
  const base = getRedirectBase(request);
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

    const base = getRedirectBase(request);
    const successUrl = new URL(pending.redirectUri);
    const redirectTo = new URL(successUrl.pathname + successUrl.search, base);
    return NextResponse.redirect(redirectTo.toString());
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Token exchange failed';
    const isInvalidGrant = message.startsWith('invalid_grant');
    return redirectToError(request, isInvalidGrant ? 'invalid_grant' : 'server_error', message);
  }
}
