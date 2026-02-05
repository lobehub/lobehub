import type {
  SSOProvider,
  UserGeneralConfig,
  UserGuide,
  UserKeyVaults,
  UserPreference,
  UserSettings,
} from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import dayjs from 'dayjs';
import { and, eq, gt, inArray, or } from 'drizzle-orm';
import type { PartialDeep } from 'type-fest';

import { merge } from '@/utils/merge';
import { today } from '@/utils/time';

import type { NewUser, UserItem, UserSettingsItem } from '../schemas';
import { nextauthAccounts, users, userSettings } from '../schemas';
import type { LobeChatDatabase } from '../type';

type DecryptUserKeyVaults = (
  encryptKeyVaultsStr: string | null,
  userId?: string,
) => Promise<UserKeyVaults>;

export class UserNotFoundError extends TRPCError {
  constructor() {
    super({ code: 'UNAUTHORIZED', message: 'user not found' });
  }
}

export interface ListUsersForMemoryExtractorCursor {
  createdAt: Date;
  id: string;
}

export type ListUsersForMemoryExtractorOptions = {
  cursor?: ListUsersForMemoryExtractorCursor;
  limit?: number;
  whitelist?: string[];
};

export interface UserInfoForAIGeneration {
  responseLanguage: string;
  userName: string;
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
        interests: users.interests,
        isOnboarded: users.isOnboarded,
        lastName: users.lastName,
        onboarding: users.onboarding,
        preference: users.preference,
        settingsDefaultAgent: userSettings.defaultAgent,

        settingsGeneral: userSettings.general,
        settingsHotkey: userSettings.hotkey,
        settingsImage: userSettings.image,
        settingsKeyVaults: userSettings.keyVaults,
        settingsLanguageModel: userSettings.languageModel,
        settingsMarket: userSettings.market,
        settingsMemory: userSettings.memory,
        settingsSystemAgent: userSettings.systemAgent,
        settingsTTS: userSettings.tts,
        settingsTool: userSettings.tool,
        username: users.username,
      })
      .from(users)
      .where(eq(users.id, this.userId))
      .leftJoin(userSettings, eq(users.id, userSettings.id))
      .limit(1);

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
      market: state.settingsMarket || undefined,
      memory: state.settingsMemory || {},
      systemAgent: state.settingsSystemAgent || {},
      tool: state.settingsTool || {},
      tts: state.settingsTTS || {},
    };

    return {
      avatar: state.avatar || undefined,
      email: state.email || undefined,
      firstName: state.firstName || undefined,
      fullName: state.fullName || undefined,
      interests: state.interests || undefined,
      isOnboarded: state.isOnboarded,
      lastName: state.lastName || undefined,
      onboarding: state.onboarding || undefined,
      preference: state.preference as UserPreference,
      settings,
      userId: this.userId,
      username: state.username || undefined,
    };
  };

  getUserSSOProviders = async (): Promise<SSOProvider[]> => {
    return this.db
      .select({
        expiresAt: nextauthAccounts.expires_at,
        provider: nextauthAccounts.provider,
        providerAccountId: nextauthAccounts.providerAccountId,
      })
      .from(nextauthAccounts)
      .where(eq(nextauthAccounts.userId, this.userId));
  };

  getUserSettings = async () => {
    return this.db.query.userSettings.findFirst({ where: eq(userSettings.id, this.userId) });
  };

  getUserPreference = async (): Promise<UserPreference | undefined> => {
    const user = await this.db.query.users.findFirst({
      columns: { preference: true },
      where: eq(users.id, this.userId),
    });
    return user?.preference as UserPreference | undefined;
  };

  getUserSettingsDefaultAgentConfig = async () => {
    const result = await this.db
      .select({ defaultAgent: userSettings.defaultAgent })
      .from(userSettings)
      .where(eq(userSettings.id, this.userId))
      .limit(1);

    return result[0]?.defaultAgent;
  };

  updateUser = async (value: Partial<UserItem>) => {
    const nextValue = UserModel.normalizeUniqueUserFields(value);

    return this.db
      .update(users)
      .set({ ...nextValue, updatedAt: new Date() })
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

  /**
   * Normalize unique user fields so empty strings become null, keeping unique constraints safe.
   */
  private static normalizeUniqueUserFields = <
    T extends { email?: string | null; phone?: string | null; username?: string | null },
  >(
    value: T,
  ) => {
    const normalizedEmail =
      typeof value.email === 'string' && value.email.trim() === '' ? null : value.email;
    const normalizedPhone =
      typeof value.phone === 'string' && value.phone.trim() === '' ? null : value.phone;
    const normalizedUsername =
      typeof value.username === 'string' && value.username.trim() === ''
        ? null
        : value.username?.trim();

    return {
      ...value,
      ...(value.email !== undefined ? { email: normalizedEmail } : {}),
      ...(value.phone !== undefined ? { phone: normalizedPhone } : {}),
      ...(value.username !== undefined ? { username: normalizedUsername } : {}),
    };
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

    const normalizedParams = this.normalizeUniqueUserFields(params);
    const [user] = await db.insert(users).values(normalizedParams).returning();

    return { duplicate: false, user };
  };

  static deleteUser = async (db: LobeChatDatabase, id: string) => {
    return db.delete(users).where(eq(users.id, id));
  };

  static findById = async (db: LobeChatDatabase, id: string) => {
    return db.query.users.findFirst({ where: eq(users.id, id) });
  };

  static findByUsername = async (db: LobeChatDatabase, username: string) => {
    const normalizedUsername = username.trim();
    if (!normalizedUsername) return null;

    return db.query.users.findFirst({ where: eq(users.username, normalizedUsername) });
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

  static listUsersForMemoryExtractor = (
    db: LobeChatDatabase,
    options: ListUsersForMemoryExtractorOptions = {},
  ) => {
    const cursorCondition = options.cursor
      ? or(
          gt(users.createdAt, options.cursor.createdAt),
          and(eq(users.createdAt, options.cursor.createdAt), gt(users.id, options.cursor.id)),
        )
      : undefined;

    const whitelistCondition =
      options.whitelist && options.whitelist.length > 0
        ? inArray(users.id, options.whitelist)
        : undefined;

    const where = and(cursorCondition, whitelistCondition);

    return db.query.users.findMany({
      columns: { createdAt: true, id: true },
      limit: options.limit,
      orderBy: (fields, { asc }) => [asc(fields.createdAt), asc(fields.id)],
      where,
    });
  };

  /**
   * Get user info for AI generation (name and language preference)
   */
  static getInfoForAIGeneration = async (
    db: LobeChatDatabase,
    userId: string,
  ): Promise<UserInfoForAIGeneration> => {
    const result = await db
      .select({
        firstName: users.firstName,
        fullName: users.fullName,
        general: userSettings.general,
      })
      .from(users)
      .leftJoin(userSettings, eq(users.id, userSettings.id))
      .where(eq(users.id, userId))
      .limit(1);

    const user = result[0];
    const general = user?.general as UserGeneralConfig | undefined;

    return {
      responseLanguage: general?.responseLanguage || 'en-US',
      userName: user?.fullName || user?.firstName || 'User',
    };
  };
}
