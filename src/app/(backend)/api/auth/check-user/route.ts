import { and, eq } from 'drizzle-orm';
import { type NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { account } from '@/database/schemas/betterAuth';
import { users } from '@/database/schemas/user';
import { serverDB } from '@/database/server';

export interface CheckUserResponseData {
  exists: boolean;
  hasPassword?: boolean;
}

/**
 * Check if a user exists by email
 * @param req - POST request with { email: string }
 * @returns { exists: boolean, emailVerified?: boolean }
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { email } = body;

    if (!email || typeof email !== 'string') {
      return NextResponse.json({ error: 'Email is required', exists: false }, { status: 400 });
    }

    // Query database for user with this email
    const [user] = await serverDB
      .select({
        emailVerified: users.emailVerified,
        id: users.id,
      })
      .from(users)
      .where(eq(users.email, email.toLowerCase().trim()))
      .limit(1);

    if (!user) {
      return NextResponse.json({ exists: false });
    }

    const accounts = await serverDB
      .select({
        password: account.password,
        providerId: account.providerId,
      })
      .from(account)
      .where(and(eq(account.userId, user.id)));
    const hasPassword = accounts.some(
      (a) =>
        a.providerId === 'credential' && typeof a.password === 'string' && a.password.length > 0,
    );

    return NextResponse.json({
      exists: true,
      hasPassword,
    } satisfies CheckUserResponseData);
  } catch (error) {
    console.error('Error checking user existence:', error);
    return NextResponse.json({ error: 'Internal server error', exists: false }, { status: 500 });
  }
}

export const runtime = 'nodejs';
