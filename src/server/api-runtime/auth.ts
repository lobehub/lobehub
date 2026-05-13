import { and, eq } from 'drizzle-orm';

import { account } from '@/database/schemas/betterAuth';
import { users } from '@/database/schemas/user';
import { serverDB } from '@/database/server';

export interface CheckUserResponseData {
  exists: boolean;
  hasPassword?: boolean;
}

export interface ResolveUsernameResponseData {
  email?: string | null;
  exists: boolean;
}

export const checkUserAPIHandler = async (request: Request): Promise<Response> => {
  try {
    const body = (await request.json()) as { email?: unknown };
    const { email } = body;

    if (!email || typeof email !== 'string') {
      return Response.json({ error: 'Email is required', exists: false }, { status: 400 });
    }

    const [user] = await serverDB
      .select({
        emailVerified: users.emailVerified,
        id: users.id,
      })
      .from(users)
      .where(eq(users.email, email.toLowerCase().trim()))
      .limit(1);

    if (!user) {
      return Response.json({ exists: false });
    }

    const accounts = await serverDB
      .select({
        password: account.password,
        providerId: account.providerId,
      })
      .from(account)
      .where(and(eq(account.userId, user.id)));
    const hasPassword = accounts.some(
      (item) =>
        item.providerId === 'credential' &&
        typeof item.password === 'string' &&
        item.password.length > 0,
    );

    return Response.json({
      exists: true,
      hasPassword,
    } satisfies CheckUserResponseData);
  } catch (error) {
    console.error('Error checking user existence:', error);
    return Response.json({ error: 'Internal server error', exists: false }, { status: 500 });
  }
};

export const resolveUsernameAPIHandler = async (request: Request): Promise<Response> => {
  try {
    const body = (await request.json()) as { username?: unknown };
    const { username } = body;

    if (!username || typeof username !== 'string') {
      return Response.json({ error: 'Username is required', exists: false }, { status: 400 });
    }

    const normalizedUsername = username.trim();

    if (!normalizedUsername) {
      return Response.json({ error: 'Username is required', exists: false }, { status: 400 });
    }

    const [user] = await serverDB
      .select({ email: users.email })
      .from(users)
      .where(eq(users.username, normalizedUsername))
      .limit(1);

    if (!user || !user.email) {
      return Response.json({ exists: false } satisfies ResolveUsernameResponseData);
    }

    return Response.json({
      email: user.email,
      exists: true,
    } satisfies ResolveUsernameResponseData);
  } catch (error) {
    console.error('Error resolving username to email:', error);
    return Response.json({ error: 'Internal server error', exists: false }, { status: 500 });
  }
};
