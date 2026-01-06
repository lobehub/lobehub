import { type LobeChatDatabase } from '@lobechat/database';
import { and, eq } from 'drizzle-orm';
import { type Adapter, type AdapterAccount } from 'next-auth/adapters';
import { NextResponse } from 'next/server';

import { UserModel } from '@/database/models/user';
import {
  type UserItem,
  nextauthAccounts,
  nextauthAuthenticators,
  nextauthSessions,
  nextauthVerificationTokens,
  users,
} from '@/database/schemas';
import { pino } from '@/libs/logger';
import { merge } from '@/utils/merge';

import {
  mapAdapterUserToLobeUser,
  mapAuthenticatorQueryResutlToAdapterAuthenticator,
  mapLobeUserToAdapterUser,
  partialMapAdapterUserToLobeUser,
} from './utils';

export class NextAuthUserService {
  private db: LobeChatDatabase;

  constructor(db: LobeChatDatabase) {
    this.db = db;
  }

  safeUpdateUser = async (
    { providerAccountId, provider }: { provider: string; providerAccountId: string },
    data: Partial<UserItem>,
  ) => {
    pino.info(`updating user "${JSON.stringify({ provider, providerAccountId })}" due to webhook`);
    // 1. Find User by account
    const user = await this.getUserByAccount({
      provider,
      providerAccountId,
    });

    // 2. If found, Update user data from provider
    if (user?.id) {
      const userModel = new UserModel(this.db, user.id);

      // Perform update
      await userModel.updateUser({
        avatar: data?.avatar,
        email: data?.email,
        fullName: data?.fullName,
      });
    } else {
      pino.warn(
        `[${provider}]: Webhooks handler user "${JSON.stringify({ provider, providerAccountId })}" update for "${JSON.stringify(data)}", but no user was found by the providerAccountId.`,
      );
    }
    return NextResponse.json({ message: 'user updated', success: true }, { status: 200 });
  };

  safeSignOutUser = async ({
    providerAccountId,
    provider,
  }: {
    provider: string;
    providerAccountId: string;
  }) => {
    pino.info(`Signing out user "${JSON.stringify({ provider, providerAccountId })}"`);
    const user = await this.getUserByAccount({
      provider,
      providerAccountId,
    });

    // 2. If found, Update user data from provider
    if (user?.id) {
      // Perform update
      await this.db.delete(nextauthSessions).where(eq(nextauthSessions.userId, user.id));
    } else {
      pino.warn(
        `[${provider}]: Webhooks handler user "${JSON.stringify({ provider, providerAccountId })}" to signout", but no user was found by the providerAccountId.`,
      );
    }
    return NextResponse.json({ message: 'user signed out', success: true }, { status: 200 });
  };

  createAuthenticator: NonNullable<Adapter['createAuthenticator']> = async (authenticator) => {
    return await this.db
      .insert(nextauthAuthenticators)
      .values(authenticator)
      .returning()
      .then((res: any) => res[0] ?? undefined);
  };

  createSession: NonNullable<Adapter['createSession']> = async (data) => {
    return await this.db
      .insert(nextauthSessions)
      .values(data)
      .returning()
      .then((res: any) => res[0]);
  };

  createUser: NonNullable<Adapter['createUser']> = async (user) => {
    const { id, name, email, emailVerified, image, providerAccountId } = user;
    // return the user if it already exists
    let existingUser =
      email && typeof email === 'string' && email.trim()
        ? await UserModel.findByEmail(this.db, email)
        : undefined;
    // If the user is not found by email, try to find by providerAccountId
    if (!existingUser && providerAccountId) {
      existingUser = await UserModel.findById(this.db, providerAccountId);
    }
    if (existingUser) {
      const adapterUser = mapLobeUserToAdapterUser(existingUser);
      return adapterUser;
    }

    // create a new user if it does not exist
    // Use id from provider if it exists, otherwise use id assigned by next-auth
    // ref: https://github.com/lobehub/lobe-chat/pull/2935
    const uid = providerAccountId ?? id;
    await UserModel.createUser(
      this.db,
      mapAdapterUserToLobeUser({
        email,
        emailVerified,
        // Use providerAccountId as userid to identify if the user exists in a SSO provider
        id: uid,
        image,
        name,
      }),
    );

    return { ...user, id: uid };
  };

  createVerificationToken: NonNullable<Adapter['createVerificationToken']> = async (data) => {
    return await this.db
      .insert(nextauthVerificationTokens)
      .values(data)
      .returning()
      .then((res: any) => res[0]);
  };

  deleteSession: NonNullable<Adapter['deleteSession']> = async (sessionToken) => {
    await this.db.delete(nextauthSessions).where(eq(nextauthSessions.sessionToken, sessionToken));
  };

  deleteUser: NonNullable<Adapter['deleteUser']> = async (id) => {
    const user = await UserModel.findById(this.db, id);
    if (!user) throw new Error('NextAuth: Delete User not found');
    await UserModel.deleteUser(this.db, id);
  };

  getAccount: NonNullable<Adapter['getAccount']> = async (providerAccountId, provider) => {
    return (await this.db
      .select()
      .from(nextauthAccounts)
      .where(
        and(
          eq(nextauthAccounts.provider, provider),
          eq(nextauthAccounts.providerAccountId, providerAccountId),
        ),
      )
      .then((res: any) => res[0] ?? null)) as Promise<AdapterAccount | null>;
  };

  getAuthenticator: NonNullable<Adapter['getAuthenticator']> = async (credentialID) => {
    const result = await this.db
      .select()
      .from(nextauthAuthenticators)
      .where(eq(nextauthAuthenticators.credentialID, credentialID))
      .then((res) => res[0] ?? null);
    if (!result) throw new Error('NextAuthUserService: Failed to get authenticator');
    return mapAuthenticatorQueryResutlToAdapterAuthenticator(result);
  };

  getSessionAndUser: NonNullable<Adapter['getSessionAndUser']> = async (sessionToken) => {
    const result = await this.db
      .select({
        session: nextauthSessions,
        user: users,
      })
      .from(nextauthSessions)
      .where(eq(nextauthSessions.sessionToken, sessionToken))
      .innerJoin(users, eq(users.id, nextauthSessions.userId))
      .then((res: any) => (res.length > 0 ? res[0] : null));

    if (!result) return null;
    const adapterUser = mapLobeUserToAdapterUser(result.user);
    if (!adapterUser) return null;
    return {
      session: result.session,
      user: adapterUser,
    };
  };

  getUser: NonNullable<Adapter['getUser']> = async (id) => {
    const lobeUser = await UserModel.findById(this.db, id);
    if (!lobeUser) return null;
    return mapLobeUserToAdapterUser(lobeUser);
  };

  getUserByAccount: NonNullable<Adapter['getUserByAccount']> = async (account) => {
    const result = await this.db
      .select({
        account: nextauthAccounts,
        users,
      })
      .from(nextauthAccounts)
      .innerJoin(users, eq(nextauthAccounts.userId, users.id))
      .where(
        and(
          eq(nextauthAccounts.provider, account.provider),
          eq(nextauthAccounts.providerAccountId, account.providerAccountId),
        ),
      )
      .then((res: any) => res[0]);

    return result?.users ? mapLobeUserToAdapterUser(result.users) : null;
  };

  getUserByEmail: NonNullable<Adapter['getUserByEmail']> = async (email) => {
    const lobeUser =
      email && typeof email === 'string' && email.trim()
        ? await UserModel.findByEmail(this.db, email)
        : undefined;
    return lobeUser ? mapLobeUserToAdapterUser(lobeUser) : null;
  };

  linkAccount: NonNullable<Adapter['linkAccount']> = async (data) => {
    const [account] = await this.db
      .insert(nextauthAccounts)
      .values(data as any)
      .returning();
    if (!account) throw new Error('NextAuthAccountModel: Failed to create account');
    // TODO Update type annotation
    return account as any;
  };

  listAuthenticatorsByUserId: NonNullable<Adapter['listAuthenticatorsByUserId']> = async (
    userId,
  ) => {
    const result = await this.db
      .select()
      .from(nextauthAuthenticators)
      .where(eq(nextauthAuthenticators.userId, userId))
      .then((res: any) => res);
    if (result.length === 0)
      throw new Error('NextAuthUserService: Failed to get authenticator list');
    return result.map((r: any) => mapAuthenticatorQueryResutlToAdapterAuthenticator(r));
  };

  unlinkAccount: NonNullable<Adapter['unlinkAccount']> = async (account) => {
    await this.db
      .delete(nextauthAccounts)
      .where(
        and(
          eq(nextauthAccounts.provider, account.provider),
          eq(nextauthAccounts.providerAccountId, account.providerAccountId),
        ),
      );
  };

  updateAuthenticatorCounter: NonNullable<Adapter['updateAuthenticatorCounter']> = async (
    credentialID,
    counter,
  ) => {
    const result = await this.db
      .update(nextauthAuthenticators)
      .set({ counter })
      .where(eq(nextauthAuthenticators.credentialID, credentialID))
      .returning()
      .then((res: any) => res[0]);
    if (!result) throw new Error('NextAuthUserService: Failed to update authenticator counter');
    return mapAuthenticatorQueryResutlToAdapterAuthenticator(result);
  };

  updateSession: NonNullable<Adapter['updateSession']> = async (data) => {
    const res = await this.db
      .update(nextauthSessions)
      .set(data)
      .where(eq(nextauthSessions.sessionToken, data.sessionToken))
      .returning();
    return res[0];
  };

  updateUser: NonNullable<Adapter['updateUser']> = async (user) => {
    const lobeUser = await UserModel.findById(this.db, user?.id);
    if (!lobeUser) throw new Error('NextAuth: User not found');
    const userModel = new UserModel(this.db, user.id);

    const updatedUser = await userModel.updateUser({
      ...partialMapAdapterUserToLobeUser(user),
    });
    if (!updatedUser) throw new Error('NextAuth: Failed to update user');

    // merge new user data with old user data
    const newAdapterUser = mapLobeUserToAdapterUser(lobeUser);
    if (!newAdapterUser) {
      throw new Error('NextAuth: Failed to map user data to adapter user');
    }
    return merge(newAdapterUser, user);
  };

  useVerificationToken: NonNullable<Adapter['useVerificationToken']> = async (identifier_token) => {
    return await this.db
      .delete(nextauthVerificationTokens)
      .where(
        and(
          eq(nextauthVerificationTokens.identifier, identifier_token.identifier),
          eq(nextauthVerificationTokens.token, identifier_token.token),
        ),
      )
      .returning()
      .then((res: any) => (res.length > 0 ? res[0] : null));
  };
}
