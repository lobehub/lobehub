import { UserGuide, UserKeyVaults, UserPreference, UserSettings } from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import dayjs from 'dayjs';
import { eq } from 'drizzle-orm';
import type { AdapterAccount } from 'next-auth/adapters';
import type { PartialDeep } from 'type-fest';

import { merge } from '@/utils/merge';
import { today } from '@/utils/time';

import {
  NewUser,
  UserItem,
  UserSettingsItem,
  nextauthAccounts,
  userSettings,
  users,
} from '../schemas';
import { LobeChatDatabase } from '../type';

type DecryptUserKeyVaults = (
  encryptKeyVaultsStr: string | null,
  userId?: string,
) => Promise<UserKeyVaults>;

export class UserNotFoundError extends TRPCError {
  constructor() {
    super({ code: 'UNAUTHORIZED', message: 'user not found' });
  }
}

export class UserModel {
  private userId: string;
  private db: LobeChatDatabase;

  constructor(db: LobeChatDatabase, userId: string) {
    this.userId = userId;
    this.db = db;
  }

  getUserRegistrationDuration = async (): Promise<{
    createdAt: string;
    duration: number;
    updatedAt: string;
  }> => {
    const user = await this.db.query.users.findFirst({ where: eq(users.id, this.userId) });
    if (!user)
      return {
        createdAt: today().format('YYYY-MM-DD'),
        duration: 1,
        updatedAt: today().format('YYYY-MM-DD'),
      };

    return {
      createdAt: dayjs(user.createdAt).format('YYYY-MM-DD'),
      duration: dayjs().diff(dayjs(user.createdAt), 'day') + 1,
      updatedAt: today().format('YYYY-MM-DD'),
    };
  };

  getUserState = async (decryptor: DecryptUserKeyVaults) => {
    const result = await this.db
      .select({
        avatar: users.avatar,
        email: users.email,
        firstName: users.firstName,
        fullName: users.fullName,
        isOnboarded: users.isOnboarded,
        lastName: users.lastName,
        preference: users.preference,
        settingsDefaultAgent: userSettings.defaultAgent,

        settingsGeneral: userSettings.general,
        settingsHotkey: userSettings.hotkey,
        settingsImage: userSettings.image,
        settingsKeyVaults: userSettings.keyVaults,
        settingsLanguageModel: userSettings.languageModel,
        settingsSystemAgent: userSettings.systemAgent,
        settingsTTS: userSettings.tts,
        settingsTool: userSettings.tool,
        username: users.username,
      })
      .from(users)
      .where(eq(users.id, this.userId))
      .leftJoin(userSettings, eq(users.id, userSettings.id));

    if (!result || !result[0]) {
      throw new UserNotFoundError();
    }

    const state = result[0];

    // Decrypt keyVaults
    let decryptKeyVaults = {};

    try {
      decryptKeyVaults = await decryptor(state.settingsKeyVaults, this.userId);
    } catch {
      /* empty */
    }

    const settings: PartialDeep<UserSettings> = {
      defaultAgent: state.settingsDefaultAgent || {},
      general: state.settingsGeneral || {},
      hotkey: state.settingsHotkey || {},
      image: state.settingsImage || {},
      keyVaults: decryptKeyVaults,
      languageModel: state.settingsLanguageModel || {},
      systemAgent: state.settingsSystemAgent || {},
      tool: state.settingsTool || {},
      tts: state.settingsTTS || {},
    };

    return {
      avatar: state.avatar || undefined,
      email: state.email || undefined,
      firstName: state.firstName || undefined,
      fullName: state.fullName || undefined,
      isOnboarded: state.isOnboarded,
      lastName: state.lastName || undefined,
      preference: state.preference as UserPreference,
      settings,
      userId: this.userId,
      username: state.username || undefined,
    };
  };

  getUserSSOProviders = async () => {
    const result = await this.db
      .select({
        expiresAt: nextauthAccounts.expires_at,
        provider: nextauthAccounts.provider,
        providerAccountId: nextauthAccounts.providerAccountId,
        scope: nextauthAccounts.scope,
        type: nextauthAccounts.type,
        userId: nextauthAccounts.userId,
      })
      .from(nextauthAccounts)
      .where(eq(nextauthAccounts.userId, this.userId));
    return result as unknown as AdapterAccount[];
  };

  getUserSettings = async () => {
    return this.db.query.userSettings.findFirst({ where: eq(userSettings.id, this.userId) });
  };

  updateUser = async (value: Partial<UserItem>) => {
    return this.db
      .update(users)
      .set({ ...value, updatedAt: new Date() })
      .where(eq(users.id, this.userId));
  };

  deleteSetting = async () => {
    return this.db.delete(userSettings).where(eq(userSettings.id, this.userId));
  };

  updateSetting = async (value: Partial<UserSettingsItem>) => {
    return this.db
      .insert(userSettings)
      .values({
        id: this.userId,
        ...value,
      })
      .onConflictDoUpdate({
        set: value,
        target: userSettings.id,
      });
  };

  updatePreference = async (value: Partial<UserPreference>) => {
    const user = await this.db.query.users.findFirst({ where: eq(users.id, this.userId) });
    if (!user) return;

    return this.db
      .update(users)
      .set({ preference: merge(user.preference, value) })
      .where(eq(users.id, this.userId));
  };

  updateGuide = async (value: Partial<UserGuide>) => {
    const user = await this.db.query.users.findFirst({ where: eq(users.id, this.userId) });
    if (!user) return;

    const prevPreference = (user.preference || {}) as UserPreference;
    return this.db
      .update(users)
      .set({ preference: { ...prevPreference, guide: merge(prevPreference.guide || {}, value) } })
      .where(eq(users.id, this.userId));
  };

  // Static method
  static makeSureUserExist = async (db: LobeChatDatabase, userId: string) => {
    await db.insert(users).values({ id: userId }).onConflictDoNothing();
  };

  static createUser = async (db: LobeChatDatabase, params: NewUser) => {
    // if user already exists, skip creation
    if (params.id) {
      const user = await db.query.users.findFirst({ where: eq(users.id, params.id) });
      if (!!user) return { duplicate: true };
    }

    const [user] = await db
      .insert(users)
      .values({ ...params })
      .returning();

    return { duplicate: false, user };
  };

  static deleteUser = async (db: LobeChatDatabase, id: string) => {
    return db.delete(users).where(eq(users.id, id));
  };

  static findById = async (db: LobeChatDatabase, id: string) => {
    return db.query.users.findFirst({ where: eq(users.id, id) });
  };

  static findByEmail = async (db: LobeChatDatabase, email: string) => {
    return db.query.users.findFirst({ where: eq(users.email, email) });
  };

  static getUserApiKeys = async (
    db: LobeChatDatabase,
    id: string,
    decryptor: DecryptUserKeyVaults,
  ) => {
    const result = await db
      .select({
        settingsKeyVaults: userSettings.keyVaults,
      })
      .from(userSettings)
      .where(eq(userSettings.id, id));

    if (!result || !result[0]) {
      throw new UserNotFoundError();
    }

    const state = result[0];

    // Decrypt keyVaults
    return await decryptor(state.settingsKeyVaults, id);
  };
}
