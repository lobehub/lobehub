import { eq } from 'drizzle-orm';
import { mergeWith } from 'es-toolkit/compat';

import { UserModel } from '@/database/models/user';
import { users } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';
import { userRouter } from '@/server/routers/lambda/user';

import { BaseService } from '../common/base.service';
import {
  type UpdateUserProfileRequest,
  type UpdateUserSettingsRequest,
  USER_SETTINGS_SECTIONS,
  type UserProfile,
  type UserSettingsResult,
  type UserSettingsValue,
} from '../types/user-settings.type';

/** Objects merge key by key; arrays (and scalars) replace, unlike lodash's index-wise merge. */
const mergePatch = <T>(stored: T, patch: unknown): T =>
  mergeWith({}, stored, patch, (_stored: unknown, next: unknown) =>
    Array.isArray(next) ? next : undefined,
  ) as T;

const toObject = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

/**
 * The caller's own settings, preference and profile (`/users/me/*`).
 *
 * Writes go through the same `user` tRPC procedures the web app calls,
 * invoked server-side without API-key scopes (the REST route has already
 * narrowed the key to `user:*`), so the workspace permission gate on
 * owner-level settings, the username uniqueness check and the avatar upload
 * stay one implementation.
 */
export class UserSettingsRestService extends BaseService {
  private readonly ctx: { userId: string; workspaceId?: string };

  constructor(db: LobeChatDatabase, userId: string | null, workspaceId?: string) {
    super(db, userId, workspaceId);
    this.ctx = { userId: this.userId, workspaceId };
  }

  private get user() {
    return userRouter.createCaller(this.ctx);
  }

  /**
   * Settings without credentials. The key-vault decryptor is a no-op, so the
   * stored provider keys are never even decrypted on this path.
   */
  async getSettings(): Promise<UserSettingsResult> {
    const state = await new UserModel(this.db, this.userId).getUserState(async () => ({}));
    const stored = state.settings as Record<string, unknown>;

    const settings = Object.fromEntries(
      USER_SETTINGS_SECTIONS.map((key) => [key, toObject(stored[key])]),
    ) as UserSettingsValue;

    return { preference: toObject(state.preference), settings };
  }

  async updateSettings(input: UpdateUserSettingsRequest): Promise<UserSettingsResult> {
    if (input.settings && Object.keys(input.settings).length > 0) {
      const { settings: current } = await this.getSettings();
      const next = Object.fromEntries(
        Object.entries(input.settings).map(([key, patch]) => [
          key,
          mergePatch(current[key as keyof UserSettingsValue], patch),
        ]),
      );
      await this.user.updateSettings(next);
    }

    if (input.preference) await this.user.updatePreference(input.preference);

    return this.getSettings();
  }

  async getProfile(): Promise<UserProfile> {
    const row = await this.db.query.users.findFirst({
      columns: { avatar: true, email: true, fullName: true, id: true, username: true },
      where: eq(users.id, this.userId),
    });
    if (!row) throw this.createNotFoundError('User not found');

    return {
      avatar: row.avatar ?? null,
      email: row.email ?? null,
      fullName: row.fullName ?? null,
      id: row.id,
      username: row.username ?? null,
    };
  }

  /**
   * Username first: it is the field that can be refused (409 when taken), so a
   * conflict leaves the rest of the profile untouched.
   */
  async updateProfile(input: UpdateUserProfileRequest): Promise<UserProfile> {
    if (input.username !== undefined) await this.user.updateUsername(input.username);
    if (input.fullName !== undefined) await this.user.updateFullName(input.fullName);
    if (input.avatar !== undefined) await this.user.updateAvatar(input.avatar);

    return this.getProfile();
  }
}
