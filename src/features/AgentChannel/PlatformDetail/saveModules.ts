import isEqual from 'fast-deep-equal';

import type { ChannelTab, ChannelValues } from './channelTabs';
import { pickKeys, replyDiffers } from './replySettings';
import {
  groupAccessFields,
  groupReplyFields,
  groupWakeFields,
  type SettingsGroup,
} from './settingsGroups';

/**
 * The page saves one block at a time. A block is a titled group of options with its own Save
 * button: the long page has no single button to scroll to, and a person who changes an option
 * knows exactly what pressing Save will write.
 *
 * How a reply looks is not a block: those options take effect as soon as they change and save
 * themselves. How the bot talks (its reply style and emoji) is long text, so it is a block.
 */
export type SaveModuleId =
  | `access-${'conversation' | 'device' | 'identity'}`
  | 'advanced'
  | 'connection'
  | 'credentials'
  | 'reply-style'
  | `wake-${'channels' | 'judgement' | 'keywords' | 'more' | 'pace'}`;

export interface SaveModule {
  /**
   * Settings keys written with this block that no field of it shows: the hidden wake switch, so
   * a bot saved before the wake options existed still gets it, and the owner's ID with the
   * conversation block, which a pairing policy needs.
   */
  alsoWrites?: string[];
  id: SaveModuleId;
  /** `settings` keys the block owns. For `credentials`, the credential keys (plus the app id). */
  keys: string[];
  kind: 'credentials' | 'settings';
}

/** Written with every wake block; the form shows no switch for it (see `WAKE_MASTER_KEY`). */
const WAKE_MASTER = 'botWakeEnabled';

/**
 * Split a platform's settings into the blocks the page saves, in page order.
 *
 * Use when:
 * - Building the page's save buttons, from the same groups the page renders
 *
 * Returns:
 * - A `credentials` block when the platform asks for credentials, then one block per titled group
 *   of settings. Every option the page shows, other than how a reply looks, is in exactly one.
 */
export const resolveSaveModules = (
  groups: SettingsGroup[],
  hasCredentials: boolean,
  credentialKeys: string[] = [],
): SaveModule[] => {
  const modules: SaveModule[] = [];
  const settings = (id: SaveModuleId, fields: { key: string }[], alsoWrites?: string[]) => {
    const keys = fields.map((f) => f.key).filter((key) => key !== WAKE_MASTER);
    if (keys.length > 0) modules.push({ alsoWrites, id, keys, kind: 'settings' });
  };

  if (hasCredentials)
    modules.push({ id: 'credentials', keys: credentialKeys, kind: 'credentials' });

  for (const group of groups) {
    switch (group.key) {
      case 'connect': {
        settings('connection', group.fields);
        break;
      }
      case 'access': {
        for (const section of groupAccessFields(group.fields)) {
          // Approving strangers needs the approver: saving that choice saves the owner's ID too,
          // or the server would refuse a pairing policy with no one to approve.
          settings(
            `access-${section.key}`,
            section.fields,
            section.key === 'conversation' ? ['userId'] : undefined,
          );
        }
        break;
      }
      case 'advanced': {
        settings(group.key, group.fields);
        break;
      }
      case 'wake': {
        for (const section of groupWakeFields(group.fields)) {
          settings(`wake-${section.key}`, section.fields, [WAKE_MASTER]);
        }
        break;
      }
      case 'reply': {
        // How a reply looks saves itself; only how the bot talks waits for a Save.
        for (const section of groupReplyFields(group.fields)) {
          if (section.key === 'style') settings('reply-style', section.fields);
        }
        break;
      }
    }
  }

  return modules;
};

/** The tab a block sits on, to mark a tab that holds unsaved changes. */
export const tabOfModule = (id: SaveModuleId): ChannelTab => {
  if (id === 'credentials' || id === 'connection') return 'connect';
  if (id.startsWith('access-')) return 'access';
  if (id === 'advanced') return id;
  if (id === 'reply-style') return 'reply';

  return 'wake';
};

/** Whether the form holds a change in this block that is not stored yet. */
export const moduleDirty = (
  module: SaveModule,
  values: ChannelValues,
  stored: ChannelValues,
): boolean => {
  if (module.kind === 'credentials') {
    return (
      (values.applicationId ?? '') !== (stored.applicationId ?? '') ||
      !isEqual(
        pickCredentials(values.credentials, module.keys),
        pickCredentials(stored.credentials, module.keys),
      )
    );
  }

  return replyDiffers(values.settings, stored.settings, module.keys);
};

const pickCredentials = (credentials: Record<string, string> | undefined, keys: string[]) =>
  Object.fromEntries(
    (keys.length > 0 ? keys : Object.keys(credentials ?? {}))
      .filter((key) => (credentials?.[key] ?? '') !== '')
      .map((key) => [key, credentials![key]]),
  );

export const dirtyModuleIds = (
  modules: SaveModule[],
  values: ChannelValues,
  stored: ChannelValues,
): SaveModuleId[] =>
  modules.filter((module) => moduleDirty(module, values, stored)).map((module) => module.id);

/**
 * The whole settings column to write when saving one block: what is stored, with this block's
 * options taken from the form. Another block's unsaved edits are not in it, so saving one block
 * never saves (or loses) another. An option the form cleared is dropped, not kept as stored.
 */
export const settingsToSave = (
  module: SaveModule,
  values: ChannelValues,
  stored: ChannelValues,
): Record<string, unknown> => {
  const owned = [...module.keys, ...(module.alsoWrites ?? [])];
  const kept = Object.fromEntries(
    Object.entries(stored.settings ?? {}).filter(([key]) => !owned.includes(key)),
  );

  return { ...kept, ...pickKeys(values.settings, owned) };
};

/**
 * What to put back in the form to discard a block's edits: its stored values, and `undefined`
 * for an option that was never stored.
 */
export const discardPatch = (module: SaveModule, stored: ChannelValues): Record<string, unknown> =>
  Object.fromEntries(module.keys.map((key) => [key, stored.settings?.[key]]));
