import { eq } from 'drizzle-orm';
import { type NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { users } from '@/database/schemas/user';
import { serverDB } from '@/database/server';

export interface ResolveUsernameResponseData {
  email?: string | null;
  exists: boolean;
}

/**
 * Resolve a username to the associated email address.
 * @param req - POST request with { username: string }
 * @returns { exists: boolean, email?: string | null }
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { username } = body;

    if (!username || typeof username !== 'string') {
      return NextResponse.json({ error: 'Username is required', exists: false }, { status: 400 });
    }

    const normalizedUsername = username.trim();

    if (!normalizedUsername) {
      return NextResponse.json({ error: 'Username is required', exists: false }, { status: 400 });
    }

    const [user] = await serverDB
      .select({ email: users.email })
      .from(users)
      .where(eq(users.username, normalizedUsername))
      .limit(1);

    if (!user || !user.email) {
      return NextResponse.json({ exists: false } satisfies ResolveUsernameResponseData);
    }

    return NextResponse.json({
      email: user.email,
      exists: true,
    } satisfies ResolveUsernameResponseData);
  } catch (error) {
    console.error('Error resolving username to email:', error);
    return NextResponse.json({ error: 'Internal server error', exists: false }, { status: 500 });
  }
}

export const runtime = 'nodejs';
