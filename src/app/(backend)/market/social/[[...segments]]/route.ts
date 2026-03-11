import { type NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { MarketService } from '@/server/services/market';

type RouteContext = {
  params: Promise<{
    segments?: string[];
  }>;
};

/**
 * POST /market/social/follow
 * POST /market/social/unfollow
 * POST /market/social/favorite
 * POST /market/social/unfavorite
 * POST /market/social/like
 * POST /market/social/unlike
 * POST /market/social/toggle-like
 */
export const POST = async (req: NextRequest, context: RouteContext) => {
  const { segments = [] } = await context.params;
  const action = segments[0];

  const marketService = await MarketService.createFromRequest(req);
  const market = marketService.market;

  try {
    const body = await req.json();

    switch (action) {
      // Follow actions
      case 'follow': {
        const { followingId } = body;
        await market.follows.follow(followingId);
        return NextResponse.json({ success: true });
      }

      case 'unfollow': {
        const { followingId } = body;
        await market.follows.unfollow(followingId);
        return NextResponse.json({ success: true });
      }

      // Favorite actions
      case 'favorite': {
        const { targetType, targetId, identifier } = body;
        // SDK accepts both number (targetId) and string (identifier)
        await market.favorites.addFavorite(targetType, identifier ?? targetId);
        return NextResponse.json({ success: true });
      }

      case 'unfavorite': {
        const { targetType, targetId, identifier } = body;
        // SDK accepts both number (targetId) and string (identifier)
        await market.favorites.removeFavorite(targetType, identifier ?? targetId);
        return NextResponse.json({ success: true });
      }

      // Like actions
      case 'like': {
        const { targetType, targetId, identifier } = body;
        await market.likes.like(targetType, identifier ?? targetId);
        return NextResponse.json({ success: true });
      }

      case 'unlike': {
        const { targetType, targetId, identifier } = body;
        await market.likes.unlike(targetType, identifier ?? targetId);
        return NextResponse.json({ success: true });
      }

      case 'toggle-like': {
        const { targetType, targetId, identifier } = body;
        const result = await market.likes.toggleLike(targetType, identifier ?? targetId);
        return NextResponse.json(result);
      }

      default: {
        return NextResponse.json(
          { error: 'not_found', message: `Unknown action: ${action}` },
          { status: 404 },
        );
      }
    }
  } catch (error) {
    console.error('[Market Social] Action failed:', error);
    return NextResponse.json(
      {
        error: 'action_failed',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 },
    );
  }
};

/**
 * GET /market/social/follow-status/[userId]
 * GET /market/social/following/[userId]
 * GET /market/social/followers/[userId]
 * GET /market/social/favorite-status/[targetType]/[targetId]
 * GET /market/social/favorites/[userId]
 * GET /market/social/favorite-agents/[userId]
 * GET /market/social/favorite-plugins/[userId]
 * GET /market/social/liked-agents/[userId]
 * GET /market/social/liked-plugins/[userId]
 */
export const GET = async (req: NextRequest, context: RouteContext) => {
  const { segments = [] } = await context.params;
  const action = segments[0];

  const marketService = await MarketService.createFromRequest(req);
  const market = marketService.market;

  const url = new URL(req.url);
  const limit = url.searchParams.get('pageSize') || url.searchParams.get('limit');
  const offset = url.searchParams.get('offset');

  // Build params compatible with SDK API (limit/offset based)
  const paginationParams: { limit?: number; offset?: number } = {};
  if (limit) paginationParams.limit = Number(limit);
  if (offset) paginationParams.offset = Number(offset);

  try {
    switch (action) {
      // Follow queries
      case 'follow-status': {
        const targetUserId = Number(segments[1]);
        const result = await market.follows.checkFollowStatus(targetUserId);
        return NextResponse.json(result);
      }

      case 'following': {
        const userId = Number(segments[1]);
        const result = await market.follows.getFollowing(userId, paginationParams);
        return NextResponse.json(result);
      }

      case 'followers': {
        const userId = Number(segments[1]);
        const result = await market.follows.getFollowers(userId, paginationParams);
        return NextResponse.json(result);
      }

      case 'follow-counts': {
        const userId = Number(segments[1]);
        const [following, followers] = await Promise.all([
          market.follows.getFollowing(userId, { limit: 1 }),
          market.follows.getFollowers(userId, { limit: 1 }),
        ]);
        return NextResponse.json({
          followersCount: (followers as any).totalCount || (followers as any).total || 0,
          followingCount: (following as any).totalCount || (following as any).total || 0,
        });
      }

      // Favorite queries
      case 'favorite-status': {
        const targetType = segments[1] as 'agent' | 'plugin';
        const targetIdOrIdentifier = segments[2];
        // SDK accepts both number (targetId) and string (identifier)
        const isNumeric = /^\d+$/.test(targetIdOrIdentifier);
        const targetValue = isNumeric ? Number(targetIdOrIdentifier) : targetIdOrIdentifier;
        const result = await market.favorites.checkFavorite(targetType, targetValue as number);
        return NextResponse.json(result);
      }

      case 'favorites': {
        const result = await market.favorites.getMyFavorites(paginationParams);
        return NextResponse.json(result);
      }

      case 'user-favorites': {
        const userId = Number(segments[1]);
        const result = await market.favorites.getUserFavorites(userId, paginationParams);
        return NextResponse.json(result);
      }

      case 'favorite-agents': {
        const userId = Number(segments[1]);
        const result = await market.favorites.getUserFavoriteAgents(userId, paginationParams);
        return NextResponse.json(result);
      }

      case 'favorite-plugins': {
        const userId = Number(segments[1]);
        const result = await market.favorites.getUserFavoritePlugins(userId, paginationParams);
        return NextResponse.json(result);
      }

      // Like queries
      case 'like-status': {
        const targetType = segments[1] as 'agent' | 'plugin';
        const targetIdOrIdentifier = segments[2];
        const isNumeric = /^\d+$/.test(targetIdOrIdentifier);
        const targetValue = isNumeric ? Number(targetIdOrIdentifier) : targetIdOrIdentifier;
        const result = await market.likes.checkLike(targetType, targetValue as number);
        return NextResponse.json(result);
      }

      case 'liked-agents': {
        const userId = Number(segments[1]);
        const result = await market.likes.getUserLikedAgents(userId, paginationParams);
        return NextResponse.json(result);
      }

      case 'liked-plugins': {
        const userId = Number(segments[1]);
        const result = await market.likes.getUserLikedPlugins(userId, paginationParams);
        return NextResponse.json(result);
      }

      default: {
        return NextResponse.json(
          { error: 'not_found', message: `Unknown action: ${action}` },
          { status: 404 },
        );
      }
    }
  } catch (error) {
    console.error('[Market Social] Query failed:', error);
    return NextResponse.json(
      {
        error: 'query_failed',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 },
    );
  }
};

export const dynamic = 'force-dynamic';
