import { MarketSDK } from '@lobehub/market-sdk';
import { type NextRequest, NextResponse } from 'next/server';

import { getTrustedClientTokenForSession } from '@/libs/trusted-client';

const MARKET_BASE_URL = process.env.NEXT_PUBLIC_MARKET_BASE_URL || 'https://market.lobehub.com';

const extractAccessToken = (req: NextRequest) => {
  const authorization = req.headers.get('authorization');
  if (!authorization) return undefined;

  const [scheme, token] = authorization.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !token) return undefined;

  return token;
};

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
  const accessToken = extractAccessToken(req);
  const trustedClientToken = await getTrustedClientTokenForSession();

  const market = new MarketSDK({
    accessToken,
    baseURL: MARKET_BASE_URL,
    trustedClientToken,
  });

  // Only require accessToken if trusted client token is not available
  if (!accessToken && !trustedClientToken) {
    return NextResponse.json(
      {
        error: 'unauthorized',
        message: 'Authentication required to update user profile',
        status: 'error',
      },
      { status: 401 },
    );
  }

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
