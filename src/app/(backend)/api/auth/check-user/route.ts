import { eq } from 'drizzle-orm';
import { type NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { users } from '@/database/schemas/user';
import { serverDB } from '@/database/server';

import { consumeCheckUserRateLimit } from './rateLimit';

export interface CheckUserResponseData {
  exists: boolean;
}

const clientKeyFromRequest = (req: NextRequest): string => {
  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim();
    if (first) return first;
  }
  return req.headers.get('x-real-ip')?.trim() || 'anonymous';
};

/**
 * Check if a user exists by email.
 *
 * AUTH-001: Do not disclose `hasPassword` / auth methods. Rate-limit by client IP.
 */
export async function POST(req: NextRequest) {
  try {
    const clientKey = clientKeyFromRequest(req);
    if (!consumeCheckUserRateLimit(clientKey)) {
      return NextResponse.json(
        { error: 'Too many requests', exists: false },
        { status: 429, headers: { 'Retry-After': '60' } },
      );
    }

    const body = await req.json();
    const { email } = body;

    if (!email || typeof email !== 'string') {
      return NextResponse.json({ error: 'Email is required', exists: false }, { status: 400 });
    }

    const [user] = await serverDB
      .select({
        id: users.id,
      })
      .from(users)
      .where(eq(users.email, email.toLowerCase().trim()))
      .limit(1);

    if (!user) {
      return NextResponse.json({ exists: false } satisfies CheckUserResponseData);
    }

    // Intentionally omit hasPassword / emailVerified — auth-method oracle (AUTH-001).
    return NextResponse.json({ exists: true } satisfies CheckUserResponseData);
  } catch (error) {
    console.error('Error checking user existence:', error);
    return NextResponse.json({ error: 'Internal server error', exists: false }, { status: 500 });
  }
}
