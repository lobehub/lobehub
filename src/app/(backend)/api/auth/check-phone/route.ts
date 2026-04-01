import { and, eq } from 'drizzle-orm';
import { type NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { account } from '@/database/schemas/betterAuth';
import { users } from '@/database/schemas/user';
import { serverDB } from '@/database/server';

export interface CheckPhoneResponseData {
  exists: boolean;
  hasPassword?: boolean;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { phone } = body;

    if (!phone || typeof phone !== 'string') {
      return NextResponse.json({ error: 'Phone is required', exists: false }, { status: 400 });
    }

    const [user] = await serverDB
      .select({ id: users.id })
      .from(users)
      .where(eq(users.phone, phone.trim()))
      .limit(1);

    if (!user) {
      return NextResponse.json({ exists: false } satisfies CheckPhoneResponseData);
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

    return NextResponse.json({ exists: true, hasPassword } satisfies CheckPhoneResponseData);
  } catch (error) {
    console.error('Error checking phone existence:', error);
    return NextResponse.json({ error: 'Internal server error', exists: false }, { status: 500 });
  }
}
