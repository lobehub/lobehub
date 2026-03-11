import { type NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { MarketService } from '@/server/services/market';

type RouteContext = {
  params: Promise<{
    username: string;
  }>;
};

/**
 * GET /market/user/[username]
 *
 * Fetches user profile information from Market SDK.
 * Returns only user basic info (no agents list).
 */
export const GET = async (req: NextRequest, context: RouteContext) => {
  const { username } = await context.params;
  const decodedUsername = decodeURIComponent(username);

  const marketService = await MarketService.createFromRequest(req);
  const market = marketService.market;

  try {
    const response = await market.user.getUserInfo(decodedUsername);

    if (!response?.user) {
      return NextResponse.json(
        {
          error: 'user_not_found',
          message: `User not found: ${decodedUsername}`,
          status: 'error',
        },
        { status: 404 },
      );
    }

    // Return only user profile info (without agents)
    const { user } = response;

    return NextResponse.json({
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
    return NextResponse.json(
      {
        error: 'get_user_profile_failed',
        message: error instanceof Error ? error.message : 'Unknown error',
        status: 'error',
      },
      { status: 500 },
    );
  }
};

export const dynamic = 'force-dynamic';
