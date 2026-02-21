import { type NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { getTrustedClientTokenForSession } from '@/libs/trusted-client';
import { MarketService } from '@/server/services/market';

const MARKET_BASE_URL = process.env.NEXT_PUBLIC_MARKET_BASE_URL || 'https://market.lobehub.com';

type RouteContext = {
  params: Promise<{
    segments?: string[];
  }>;
};
const ALLOWED_ENDPOINTS = new Set(['handoff', 'token', 'userinfo']);

const ensureEndpoint = (segments?: string[]) => {
  if (!segments || segments.length === 0) {
    return { error: 'missing_endpoint', status: 404 } as const;
  }

  if (segments.length !== 1) {
    return { error: 'unsupported_nested_path', status: 404 } as const;
  }

  const endpoint = segments[0];

  if (!ALLOWED_ENDPOINTS.has(endpoint)) {
    return { error: 'unknown_endpoint', status: 404 } as const;
  }

  return { endpoint } as const;
};

const methodNotAllowed = (allowed: string[]) =>
  NextResponse.json(
    {
      error: 'method_not_allowed',
      message: `Allowed methods: ${allowed.join(', ')}`,
      status: 'error',
    },
    {
      headers: { Allow: allowed.join(', ') },
      status: 405,
    },
  );

const handleProxy = async (req: NextRequest, context: RouteContext) => {
  const marketService = new MarketService();
  const market = marketService.market;

  const { segments } = await context.params;
  const endpointResult = ensureEndpoint(segments);

  if ('error' in endpointResult) {
    return NextResponse.json(
      {
        error: endpointResult.error,
        message: 'Requested endpoint is not available.',
        status: 'error',
      },
      { status: endpointResult.status },
    );
  }

  const endpoint = endpointResult.endpoint;

  switch (endpoint) {
    case 'handoff': {
      try {
        const id = req.nextUrl.searchParams.get('id');
        if (id) {
          const handoff = await market.auth.getOAuthHandoff(id);
          return new NextResponse(JSON.stringify(handoff), { status: 200 });
        } else {
          return NextResponse.json(
            {
              error: 'missing_id',
              message: 'ID is required for handoff proxy.',
              status: 'error',
            },
            { status: 400 },
          );
        }
      } catch (error) {
        return NextResponse.json(
          {
            error: 'handoff_proxy_failed',
            message: error instanceof Error ? error.message : 'Unknown error',
            status: 'error',
          },
          { status: 500 },
        );
      }
    }

    case 'token': {
      if (req.method !== 'POST') {
        return methodNotAllowed(['POST']);
      }

      try {
        const body = await req.text();
        const form = new URLSearchParams(body);

        const grantType = (form.get('grant_type') || 'authorization_code') as
          | 'authorization_code'
          | 'refresh_token';

        if (grantType === 'authorization_code') {
          const clientId = form.get('client_id');
          const code = form.get('code');
          const codeVerifier = form.get('code_verifier');
          const redirectUri = form.get('redirect_uri');

          const response = await market.auth.exchangeOAuthToken({
            clientId: clientId as string,
            code: code as string,
            codeVerifier: codeVerifier as string,
            grantType: 'authorization_code',
            redirectUri: redirectUri as string,
          });

          return NextResponse.json(response);
        }

        if (grantType === 'refresh_token') {
          const refreshToken = form.get('refresh_token');
          const clientId = form.get('client_id');

          const response = await market.auth.exchangeOAuthToken({
            clientId: clientId ?? undefined,
            grantType: 'refresh_token',
            refreshToken: refreshToken as string,
          });

          return NextResponse.json(response);
        }

        return NextResponse.json(
          {
            error: 'unsupported_grant_type',
            message: `Unsupported grant_type: ${grantType}`,
            status: 'error',
          },
          { status: 400 },
        );
      } catch (error) {
        console.error('[MarketOIDC] Failed to proxy token request:', error);
        return NextResponse.json(
          {
            error: 'token_proxy_failed',
            message: error instanceof Error ? error.message : 'Unknown error',
            status: 'error',
          },
          { status: 500 },
        );
      }
    }

    case 'userinfo': {
      if (req.method !== 'POST') {
        return methodNotAllowed(['POST']);
      }

      try {
        const { token } = (await req.json()) as { token?: string };

        // 如果没有 token，尝试使用 trustedClientToken
        if (!token) {
          const trustedClientToken = await getTrustedClientTokenForSession();

          if (!trustedClientToken) {
            return NextResponse.json(
              {
                error: 'missing_token',
                message: 'Token is required for userinfo proxy.',
                status: 'error',
              },
              { status: 400 },
            );
          }

          // 使用 trustedClientToken 直接调用 Market userinfo 端点
          const userInfoUrl = `${MARKET_BASE_URL}/lobehub-oidc/userinfo`;
          const response = await fetch(userInfoUrl, {
            headers: {
              'Content-Type': 'application/json',
              'x-lobe-trust-token': trustedClientToken,
            },
            method: 'GET',
          });

          if (!response.ok) {
            throw new Error(`Failed to fetch user info: ${response.status} ${response.statusText}`);
          }

          const userInfo = await response.json();
          return NextResponse.json(userInfo);
        }

        const response = await market.auth.getUserInfo(token);
        return NextResponse.json(response);
      } catch (error) {
        console.error('[MarketOIDC] Failed to proxy userinfo request:', error);
        return NextResponse.json(
          {
            error: 'userinfo_proxy_failed',
            message: error instanceof Error ? error.message : 'Unknown error',
            status: 'error',
          },
          { status: 500 },
        );
      }
    }

    default: {
      return NextResponse.json(
        {
          error: 'unsupported_endpoint',
          message: 'Requested endpoint is not supported.',
          status: 'error',
        },
        { status: 404 },
      );
    }
  }
};

export const GET = (req: NextRequest, context: RouteContext) => handleProxy(req, context);
export const POST = (req: NextRequest, context: RouteContext) => handleProxy(req, context);

export const dynamic = 'force-dynamic';
