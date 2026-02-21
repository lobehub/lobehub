import { type NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { MarketService } from '@/server/services/market';

/**
 * PUT /market/user/me
 *
 * Updates the authenticated user's profile information.
 * Requires authentication via Bearer token or trusted client token.
 *
 * Request body:
 * - userName?: string - User's unique username
 * - displayName?: string - User's display name
 * - avatarUrl?: string - User's avatar URL
 * - meta?: { description?: string; socialLinks?: { github?: string; twitter?: string; website?: string } }
 */
export const PUT = async (req: NextRequest) => {
  const marketService = await MarketService.createFromRequest(req);
  const market = marketService.market;

  try {
    const payload = await req.json();

    // Validate payload
    if (typeof payload !== 'object' || payload === null) {
      return NextResponse.json(
        {
          error: 'invalid_payload',
          message: 'Request body must be a JSON object',
          status: 'error',
        },
        { status: 400 },
      );
    }

    // Ensure meta is at least an empty object
    const normalizedPayload = {
      ...payload,
      meta: payload.meta ?? {},
    };

    const response = await market.user.updateUserInfo(normalizedPayload);

    return NextResponse.json(response);
  } catch (error) {
    console.error('[Market] Failed to update user profile:', error);

    // Check for specific error types
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const isUserNameTaken = errorMessage.toLowerCase().includes('already taken');

    return NextResponse.json(
      {
        error: isUserNameTaken ? 'username_taken' : 'update_user_profile_failed',
        message: errorMessage,
        status: 'error',
      },
      { status: isUserNameTaken ? 409 : 500 },
    );
  }
};

export const dynamic = 'force-dynamic';
