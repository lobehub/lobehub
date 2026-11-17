import { UserPreferenceSchema } from '@lobechat/types';
import { z } from 'zod';

/**
 * Settings sections the public API reads and writes. Deliberately absent:
 * `keyVaults` (provider / tool credentials — the providers API owns them) and
 * `market` (Marketplace OAuth tokens). Neither is ever returned, and a write
 * that names either is refused by the strict request schema.
 */
export const USER_SETTINGS_SECTIONS = [
  'defaultAgent',
  'general',
  'hotkey',
  'image',
  'languageModel',
  'memory',
  'notification',
  'systemAgent',
  'tool',
  'tts',
] as const;

export type UserSettingsSection = (typeof USER_SETTINGS_SECTIONS)[number];

const sectionDescriptions: Record<UserSettingsSection, string> = {
  defaultAgent: 'Default configuration new agents start from (model, params, chat config).',
  general: 'General preferences: language, response language, theme, font size.',
  hotkey: 'Keyboard shortcut bindings, keyed by action.',
  image: 'Image generation defaults.',
  languageModel: 'Per-provider model list state (enabled models, fetched model cards).',
  memory: 'Memory feature settings.',
  notification: 'Notification channel switches.',
  systemAgent: 'Models used by system agents (topic naming, translation, …).',
  tool: 'Tool settings: human-intervention mode, search / crawler channels.',
  tts: 'Text-to-speech and speech-to-text settings.',
};

/** One settings section: a JSON object whose keys depend on the section. */
const section = (key: UserSettingsSection) =>
  z.record(z.string(), z.unknown()).describe(sectionDescriptions[key]);

const sectionShape = Object.fromEntries(
  USER_SETTINGS_SECTIONS.map((key) => [key, section(key)]),
) as Record<UserSettingsSection, ReturnType<typeof section>>;

/** A user's settings as the API returns them — every section, credentials stripped. */
export const UserSettingsValueSchema = z
  .object(sectionShape)
  .strict()
  .meta({ id: 'UserSettingsValue' });
export type UserSettingsValue = z.infer<typeof UserSettingsValueSchema>;

export const UserPreferenceValueSchema = UserPreferenceSchema.meta({ id: 'UserPreference' });

export const UserSettingsSchema = z
  .object({
    /** UI and client preferences stored on the user row. */
    preference: UserPreferenceValueSchema,
    settings: UserSettingsValueSchema,
  })
  .strict()
  .meta({ id: 'UserSettings' });
export type UserSettingsResult = z.infer<typeof UserSettingsSchema>;

export const UpdateUserSettingsRequestSchema = z
  .object({
    /** Deep-merged into the stored preference (arrays are replaced). */
    preference: UserPreferenceSchema.optional(),
    /**
     * Sections to change. Each one is deep-merged into the stored section —
     * objects merge key by key, arrays and scalars replace. `keyVaults` and
     * `market` are not accepted here.
     */
    settings: z.object(sectionShape).partial().strict().optional(),
  })
  .strict()
  .refine((body) => body.preference !== undefined || body.settings !== undefined, {
    message: 'Provide `settings` and/or `preference`',
  });
export type UpdateUserSettingsRequest = z.infer<typeof UpdateUserSettingsRequestSchema>;

/** Largest accepted avatar data URL (~3 MB of base64, about 2 MB of image). */
export const MAX_AVATAR_DATA_URL_LENGTH = 3 * 1024 * 1024;

export const UpdateUserProfileRequestSchema = z
  .object({
    /**
     * New avatar: a `data:image/png;base64,…` or `data:image/webp;base64,…`
     * URL (uploaded to storage and replaced by its served path), an absolute
     * `http(s)` URL (stored as is), or `""` to clear it.
     */
    avatar: z.string().max(MAX_AVATAR_DATA_URL_LENGTH).optional(),
    fullName: z.string().trim().max(64).optional(),
    /** Letters, digits and `_`, 1–64 characters, unique across users. */
    username: z.string().trim().min(1).max(64).regex(/^\w+$/).optional(),
  })
  .strict()
  .refine((body) => Object.values(body).some((value) => value !== undefined), {
    message: 'Provide at least one of `avatar`, `fullName`, `username`',
  });
export type UpdateUserProfileRequest = z.infer<typeof UpdateUserProfileRequestSchema>;

export interface UserProfile {
  avatar: string | null;
  email: string | null;
  fullName: string | null;
  id: string;
  username: string | null;
}

export const UserProfileSchema = z
  .object({
    /** Served path (`/webapi/user/avatar/…`) or external URL; `null` when unset. */
    avatar: z.string().nullable(),
    email: z.string().nullable(),
    fullName: z.string().nullable(),
    id: z.string(),
    username: z.string().nullable(),
  } satisfies Record<keyof UserProfile, z.ZodType>)
  .strict()
  .meta({ id: 'UserProfile' });
