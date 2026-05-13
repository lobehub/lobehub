import { getTrustedClientTokenForSession } from '@/libs/trusted-client';
import { MarketService } from '@/server/services/market';

const MARKET_BASE_URL = process.env.MARKET_BASE_URL || 'https://market.lobehub.com';
const ALLOWED_OIDC_ENDPOINTS = new Set(['handoff', 'token', 'userinfo']);

const methodNotAllowed = (methods: string[]) =>
  Response.json(
    {
      error: 'method_not_allowed',
      message: `Allowed methods: ${methods.join(', ')}`,
      status: 'error',
    },
    {
      headers: { Allow: methods.join(', ') },
      status: 405,
    },
  );

const badRequest = (error: string, message: string) =>
  Response.json(
    {
      error,
      message,
      status: 'error',
    },
    { status: 400 },
  );

const notFound = (reason: string) =>
  Response.json(
    {
      error: 'not_found',
      message: reason,
      status: 'error',
    },
    { status: 404 },
  );

export interface MarketSegmentsParams {
  segments?: string[];
}

interface PaginationParams {
  limit?: number;
  offset?: number;
}

const createPaginationParams = (request: Request): PaginationParams => {
  const url = new URL(request.url);
  const limit = url.searchParams.get('pageSize') || url.searchParams.get('limit');
  const offset = url.searchParams.get('offset');

  return {
    limit: limit ? Number(limit) : undefined,
    offset: offset ? Number(offset) : undefined,
  };
};

const resolveTargetValue = (targetIdOrIdentifier: string) => {
  const isNumeric = /^\d+$/.test(targetIdOrIdentifier);
  return isNumeric ? Number(targetIdOrIdentifier) : targetIdOrIdentifier;
};

const resolveBodyTargetValue = (payload: { identifier?: string; targetId?: number }) =>
  (payload.identifier ?? payload.targetId) as string;

const readCount = (response: unknown): number => {
  if (typeof response !== 'object' || response === null) return 0;

  const counts = response as Partial<Record<'total' | 'totalCount', unknown>>;
  if (typeof counts.totalCount === 'number') return counts.totalCount;
  if (typeof counts.total === 'number') return counts.total;

  return 0;
};

const ensureOIDCEndpoint = (segments?: string[]) => {
  if (!segments || segments.length === 0) {
    return { error: 'missing_endpoint', status: 404 } as const;
  }

  if (segments.length !== 1) {
    return { error: 'unsupported_nested_path', status: 404 } as const;
  }

  const endpoint = segments[0];

  if (!ALLOWED_OIDC_ENDPOINTS.has(endpoint)) {
    return { error: 'unknown_endpoint', status: 404 } as const;
  }

  return { endpoint } as const;
};

export interface MarketUserProfileParams {
  username: string;
}

export const marketUserProfileAPIHandler = async (
  request: Request,
  params: MarketUserProfileParams,
) => {
  const decodedUsername = decodeURIComponent(params.username);
  const marketService = await MarketService.createFromRequest(request);
  const { market } = marketService;

  try {
    const response = await market.user.getUserInfo(decodedUsername);

    if (!response?.user) {
      return Response.json(
        {
          error: 'user_not_found',
          message: `User not found: ${decodedUsername}`,
          status: 'error',
        },
        { status: 404 },
      );
    }

    const { user } = response;

    return Response.json({
      avatarUrl: user.avatarUrl || null,
      bannerUrl: user.meta?.bannerUrl || null,
      createdAt: user.createdAt,
      description: user.meta?.description || null,
      displayName: user.displayName || null,
      id: user.id,
      namespace: user.namespace,
      socialLinks: user.meta?.socialLinks || null,
      type: user.type || null,
      userName: user.userName || null,
    });
  } catch (error) {
    console.error('[Market] Failed to get user profile:', error);

    return Response.json(
      {
        error: 'get_user_profile_failed',
        message: error instanceof Error ? error.message : 'Unknown error',
        status: 'error',
      },
      { status: 500 },
    );
  }
};

export const marketUserMeAPIHandler = async (request: Request) => {
  const marketService = await MarketService.createFromRequest(request);
  const { market } = marketService;

  try {
    const payload = await request.json();

    if (typeof payload !== 'object' || payload === null) {
      return Response.json(
        {
          error: 'invalid_payload',
          message: 'Request body must be a JSON object',
          status: 'error',
        },
        { status: 400 },
      );
    }

    const normalizedPayload = {
      ...payload,
      meta: payload.meta ?? {},
    };

    const response = await market.user.updateUserInfo(normalizedPayload);

    return Response.json(response);
  } catch (error) {
    console.error('[Market] Failed to update user profile:', error);

    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const isUserNameTaken = errorMessage.toLowerCase().includes('already taken');

    return Response.json(
      {
        error: isUserNameTaken ? 'username_taken' : 'update_user_profile_failed',
        message: errorMessage,
        status: 'error',
      },
      { status: isUserNameTaken ? 409 : 500 },
    );
  }
};

export const marketAgentAPIHandler = async (
  request: Request,
  { segments }: MarketSegmentsParams,
) => {
  const normalizedSegments = segments?.map((segment) => decodeURIComponent(segment)) ?? [];

  if (normalizedSegments.length === 0) {
    return notFound('Missing agent action.');
  }

  const [action, ...rest] = normalizedSegments;
  const marketService = await MarketService.createFromRequest(request);
  const { market } = marketService;

  if (action === 'create') {
    if (request.method !== 'POST') return methodNotAllowed(['POST']);

    try {
      const payload = await request.json();
      const response = await market.agents.createAgent(payload);
      return Response.json(response);
    } catch (error) {
      console.error('[Market] Failed to create agent:', error);
      return Response.json(
        {
          error: 'create_agent_failed',
          message: error instanceof Error ? error.message : 'Unknown error',
          status: 'error',
        },
        { status: 500 },
      );
    }
  }

  if (action === 'own') {
    if (request.method !== 'GET') return methodNotAllowed(['GET']);

    try {
      const url = new URL(request.url);
      const page = url.searchParams.get('page');
      const pageSize = url.searchParams.get('pageSize');

      const response = await market.agents.getOwnAgents({
        page: page ? Number.parseInt(page, 10) : undefined,
        pageSize: pageSize ? Number.parseInt(pageSize, 10) : undefined,
      });

      return Response.json(response);
    } catch (error) {
      console.error('[Market] Failed to get own agents:', error);
      return Response.json(
        {
          error: 'get_own_agents_failed',
          message: error instanceof Error ? error.message : 'Unknown error',
          status: 'error',
        },
        { status: 500 },
      );
    }
  }

  if (action === 'versions') {
    if (rest.length !== 1 || rest[0] !== 'create') {
      return notFound('Requested agent version endpoint is not available.');
    }

    if (request.method !== 'POST') return methodNotAllowed(['POST']);

    try {
      const payload = await request.json();
      if (typeof payload !== 'object' || payload === null) {
        return badRequest('invalid_payload', 'Request body must be a JSON object.');
      }

      const identifier = (payload as { identifier?: string }).identifier;
      if (!identifier) {
        return badRequest('missing_identifier', 'Identifier is required to create agent version.');
      }

      const response = await market.agents.createAgentVersion(payload);
      return Response.json(response);
    } catch (error) {
      console.error('[Market] Failed to create agent version:', error);
      return Response.json(
        {
          error: 'create_agent_version_failed',
          message: error instanceof Error ? error.message : 'Unknown error',
          status: 'error',
        },
        { status: 500 },
      );
    }
  }

  if (normalizedSegments.length === 2) {
    const [identifier, statusAction] = normalizedSegments;

    if (!['publish', 'unpublish', 'deprecate'].includes(statusAction)) {
      return notFound(`Unknown agent action: ${statusAction}`);
    }

    if (request.method !== 'POST') return methodNotAllowed(['POST']);

    try {
      let response;
      switch (statusAction) {
        case 'publish': {
          response = await market.agents.publish(identifier);
          break;
        }
        case 'unpublish': {
          response = await market.agents.unpublish(identifier);
          break;
        }
        case 'deprecate': {
          response = await market.agents.deprecate(identifier);
          break;
        }
      }
      return Response.json(response ?? { success: true });
    } catch (error) {
      console.error(`[Market] Failed to ${statusAction} agent:`, error);
      return Response.json(
        {
          error: `${statusAction}_agent_failed`,
          message: error instanceof Error ? error.message : 'Unknown error',
          status: 'error',
        },
        { status: 500 },
      );
    }
  }

  if (normalizedSegments.length === 1) {
    if (request.method !== 'GET') return methodNotAllowed(['GET']);

    try {
      const response = await market.agents.getAgentDetail(action);
      return Response.json(response);
    } catch (error) {
      console.error('[Market] Failed to get agent detail:', error);
      return Response.json(
        {
          error: 'get_agent_detail_failed',
          message: error instanceof Error ? error.message : 'Unknown error',
          status: 'error',
        },
        { status: 500 },
      );
    }
  }

  return notFound('Requested agent endpoint is not available.');
};

export const marketOIDCAPIHandler = async (
  request: Request,
  { segments }: MarketSegmentsParams,
) => {
  const endpointResult = ensureOIDCEndpoint(segments);

  if ('error' in endpointResult) {
    return Response.json(
      {
        error: endpointResult.error,
        message: 'Requested endpoint is not available.',
        status: 'error',
      },
      { status: endpointResult.status },
    );
  }

  const marketService = new MarketService();
  const { market } = marketService;
  const endpoint = endpointResult.endpoint;

  switch (endpoint) {
    case 'handoff': {
      try {
        const id = new URL(request.url).searchParams.get('id');
        if (id) {
          const handoff = await market.auth.getOAuthHandoff(id);
          return new Response(JSON.stringify(handoff), { status: 200 });
        }

        return Response.json(
          {
            error: 'missing_id',
            message: 'ID is required for handoff proxy.',
            status: 'error',
          },
          { status: 400 },
        );
      } catch (error) {
        return Response.json(
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
      if (request.method !== 'POST') return methodNotAllowed(['POST']);

      try {
        const body = await request.text();
        const form = new URLSearchParams(body);

        const grantType = (form.get('grant_type') || 'authorization_code') as
          | 'authorization_code'
          | 'refresh_token';

        if (grantType === 'authorization_code') {
          const response = await market.auth.exchangeOAuthToken({
            clientId: form.get('client_id') as string,
            code: form.get('code') as string,
            codeVerifier: form.get('code_verifier') as string,
            grantType: 'authorization_code',
            redirectUri: form.get('redirect_uri') as string,
          });

          return Response.json(response);
        }

        if (grantType === 'refresh_token') {
          const refreshToken = form.get('refresh_token');
          const clientId = form.get('client_id');

          const response = await market.auth.exchangeOAuthToken({
            clientId: clientId ?? undefined,
            grantType: 'refresh_token',
            refreshToken: refreshToken as string,
          });

          return Response.json(response);
        }

        return Response.json(
          {
            error: 'unsupported_grant_type',
            message: `Unsupported grant_type: ${grantType}`,
            status: 'error',
          },
          { status: 400 },
        );
      } catch (error) {
        console.error('[MarketOIDC] Failed to proxy token request:', error);
        return Response.json(
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
      if (request.method !== 'POST') return methodNotAllowed(['POST']);

      try {
        const { token } = (await request.json()) as { token?: string };

        if (!token) {
          const trustedClientToken = await getTrustedClientTokenForSession();

          if (!trustedClientToken) {
            return Response.json(
              {
                error: 'missing_token',
                message: 'Token is required for userinfo proxy.',
                status: 'error',
              },
              { status: 400 },
            );
          }

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
          return Response.json(userInfo);
        }

        const response = await market.auth.getUserInfo(token);
        return Response.json(response);
      } catch (error) {
        console.error('[MarketOIDC] Failed to proxy userinfo request:', error);
        return Response.json(
          {
            error: 'userinfo_proxy_failed',
            message: error instanceof Error ? error.message : 'Unknown error',
            status: 'error',
          },
          { status: 500 },
        );
      }
    }
  }

  return Response.json(
    {
      error: 'unsupported_endpoint',
      message: 'Requested endpoint is not supported.',
      status: 'error',
    },
    { status: 404 },
  );
};

export const marketSocialAPIHandler = async (
  request: Request,
  { segments }: MarketSegmentsParams,
) => {
  const normalizedSegments = segments?.map((segment) => decodeURIComponent(segment)) ?? [];
  const action = normalizedSegments[0];

  const marketService = await MarketService.createFromRequest(request);
  const { market } = marketService;

  if (request.method === 'POST') {
    try {
      const body = await request.json();

      switch (action) {
        case 'follow': {
          const { followingId } = body as { followingId: number };
          await market.follows.follow(followingId);
          return Response.json({ success: true });
        }

        case 'unfollow': {
          const { followingId } = body as { followingId: number };
          await market.follows.unfollow(followingId);
          return Response.json({ success: true });
        }

        case 'favorite': {
          const payload = body as {
            identifier?: string;
            targetId?: number;
            targetType: 'agent' | 'plugin';
          };
          await market.favorites.addFavorite(payload.targetType, resolveBodyTargetValue(payload));
          return Response.json({ success: true });
        }

        case 'unfavorite': {
          const payload = body as {
            identifier?: string;
            targetId?: number;
            targetType: 'agent' | 'plugin';
          };
          await market.favorites.removeFavorite(
            payload.targetType,
            resolveBodyTargetValue(payload),
          );
          return Response.json({ success: true });
        }

        case 'like': {
          const payload = body as {
            identifier?: string;
            targetId?: number;
            targetType: 'agent' | 'plugin';
          };
          await market.likes.like(payload.targetType, resolveBodyTargetValue(payload));
          return Response.json({ success: true });
        }

        case 'unlike': {
          const payload = body as {
            identifier?: string;
            targetId?: number;
            targetType: 'agent' | 'plugin';
          };
          await market.likes.unlike(payload.targetType, resolveBodyTargetValue(payload));
          return Response.json({ success: true });
        }

        case 'toggle-like': {
          const payload = body as {
            identifier?: string;
            targetId?: number;
            targetType: 'agent' | 'plugin';
          };
          const result = await market.likes.toggleLike(
            payload.targetType,
            resolveBodyTargetValue(payload),
          );
          return Response.json(result);
        }

        default: {
          return Response.json(
            { error: 'not_found', message: `Unknown action: ${action}` },
            { status: 404 },
          );
        }
      }
    } catch (error) {
      console.error('[Market Social] Action failed:', error);
      return Response.json(
        {
          error: 'action_failed',
          message: error instanceof Error ? error.message : 'Unknown error',
        },
        { status: 500 },
      );
    }
  }

  if (request.method !== 'GET') return methodNotAllowed(['GET', 'POST']);

  const paginationParams = createPaginationParams(request);

  try {
    switch (action) {
      case 'follow-status': {
        const targetUserId = Number(normalizedSegments[1]);
        const result = await market.follows.checkFollowStatus(targetUserId);
        return Response.json(result);
      }

      case 'following': {
        const userId = Number(normalizedSegments[1]);
        const result = await market.follows.getFollowing(userId, paginationParams);
        return Response.json(result);
      }

      case 'followers': {
        const userId = Number(normalizedSegments[1]);
        const result = await market.follows.getFollowers(userId, paginationParams);
        return Response.json(result);
      }

      case 'follow-counts': {
        const userId = Number(normalizedSegments[1]);
        const [following, followers] = await Promise.all([
          market.follows.getFollowing(userId, { limit: 1 }),
          market.follows.getFollowers(userId, { limit: 1 }),
        ]);

        return Response.json({
          followersCount: readCount(followers),
          followingCount: readCount(following),
        });
      }

      case 'favorite-status': {
        const targetType = normalizedSegments[1] as 'agent' | 'plugin';
        const targetValue = resolveTargetValue(normalizedSegments[2]);
        const result = await market.favorites.checkFavorite(targetType, targetValue as number);
        return Response.json(result);
      }

      case 'favorites': {
        const result = await market.favorites.getMyFavorites(paginationParams);
        return Response.json(result);
      }

      case 'user-favorites': {
        const userId = Number(normalizedSegments[1]);
        const result = await market.favorites.getUserFavorites(userId, paginationParams);
        return Response.json(result);
      }

      case 'favorite-agents': {
        const userId = Number(normalizedSegments[1]);
        const result = await market.favorites.getUserFavoriteAgents(userId, paginationParams);
        return Response.json(result);
      }

      case 'favorite-plugins': {
        const userId = Number(normalizedSegments[1]);
        const result = await market.favorites.getUserFavoritePlugins(userId, paginationParams);
        return Response.json(result);
      }

      case 'like-status': {
        const targetType = normalizedSegments[1] as 'agent' | 'plugin';
        const targetValue = resolveTargetValue(normalizedSegments[2]);
        const result = await market.likes.checkLike(targetType, targetValue as number);
        return Response.json(result);
      }

      case 'liked-agents': {
        const userId = Number(normalizedSegments[1]);
        const result = await market.likes.getUserLikedAgents(userId, paginationParams);
        return Response.json(result);
      }

      case 'liked-plugins': {
        const userId = Number(normalizedSegments[1]);
        const result = await market.likes.getUserLikedPlugins(userId, paginationParams);
        return Response.json(result);
      }

      default: {
        return Response.json(
          { error: 'not_found', message: `Unknown action: ${action}` },
          { status: 404 },
        );
      }
    }
  } catch (error) {
    console.error('[Market Social] Query failed:', error);
    return Response.json(
      {
        error: 'query_failed',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 },
    );
  }
};
