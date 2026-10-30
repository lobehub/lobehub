import { parseIdList } from './const';
import type { FieldSchema } from './types';

/**
 * Who on a bot may use the owner's devices (local system, remote device).
 *
 * - `owner` (default): only the sender whose ID equals `settings.userId`.
 * - `allowlist`: the owner, plus the user IDs in `deviceAllowFrom`.
 *
 * Kept apart from `allowFrom`: being allowed to talk to the bot is not being
 * trusted with the owner's machine, so neither list implies the other.
 */
export type DevicePolicy = 'allowlist' | 'owner';

export const devicePolicyField: FieldSchema = {
  key: 'devicePolicy',
  default: 'owner',
  description: 'channel.devicePolicyHint',
  enum: ['owner', 'allowlist'],
  label: 'channel.devicePolicy',
  type: 'string',
};

/** Same `{ id, name? }` rows as `allowFrom`, so the page renders and parses it the same way. */
export const deviceAllowFromField: FieldSchema = {
  key: 'deviceAllowFrom',
  default: [],
  description: 'channel.deviceAllowFromHint',
  items: {
    key: 'item',
    label: '',
    properties: [
      {
        key: 'id',
        label: 'channel.allowFromIdLabel',
        placeholder: 'channel.allowFromIdPlaceholder',
        required: true,
        type: 'string',
      },
      {
        key: 'name',
        label: 'channel.allowFromNameLabel',
        placeholder: 'channel.allowFromNamePlaceholder',
        type: 'string',
      },
    ],
    type: 'object',
  },
  label: 'channel.deviceAllowFrom',
  type: 'array',
};

export const deviceAccessFields: FieldSchema[] = [devicePolicyField, deviceAllowFromField];

/**
 * Where on a bot the owner's devices may be used, on top of who may use them.
 *
 * - `any` (default): no channel restriction; only `devicePolicy` decides.
 * - `allowlist`: outside DMs, only in the channels listed in
 *   `deviceChannelAllowFrom`. Elsewhere even the owner falls back to the
 *   sandbox.
 *
 * Mirrors `groupPolicy` / `groupAllowFrom`: same raw channel IDs, same rows.
 * Only platforms with group chat declare it.
 */
export type DeviceChannelPolicy = 'allowlist' | 'any';

export const deviceChannelPolicyField: FieldSchema = {
  key: 'deviceChannelPolicy',
  default: 'any',
  description: 'channel.deviceChannelPolicyHint',
  enum: ['any', 'allowlist'],
  label: 'channel.deviceChannelPolicy',
  type: 'string',
};

/** Same `{ id, name? }` rows as `groupAllowFrom`, so operators paste the same channel IDs. */
export const deviceChannelAllowFromField: FieldSchema = {
  key: 'deviceChannelAllowFrom',
  default: [],
  description: 'channel.deviceChannelAllowFromHint',
  items: {
    key: 'item',
    label: '',
    properties: [
      {
        key: 'id',
        label: 'channel.groupAllowFromIdLabel',
        placeholder: 'channel.groupAllowFromIdPlaceholder',
        required: true,
        type: 'string',
      },
      {
        key: 'name',
        label: 'channel.groupAllowFromNameLabel',
        placeholder: 'channel.groupAllowFromNamePlaceholder',
        type: 'string',
      },
    ],
    type: 'object',
  },
  label: 'channel.deviceChannelAllowFrom',
  type: 'array',
};

export const deviceChannelFields: FieldSchema[] = [
  deviceChannelPolicyField,
  deviceChannelAllowFromField,
];

/**
 * The user IDs, besides the owner, who may use the owner's devices. Anything
 * but an explicit `allowlist` policy yields an empty list, so a missing or
 * malformed setting fails closed to "owner only".
 */
export const extractDeviceAllowlist = (
  settings: Record<string, unknown> | null | undefined,
): string[] => {
  if (settings?.devicePolicy !== 'allowlist') return [];
  return parseIdList(settings.deviceAllowFrom);
};

/**
 * The channel IDs the owner's devices are limited to, or `undefined` when no
 * channel restriction applies. Anything but an explicit `allowlist` policy is
 * unrestricted, so bots saved before this setting existed keep their behavior.
 * An `allowlist` with no entries restricts every channel (fail-closed, like
 * `groupAllowFrom`).
 */
export const extractDeviceChannelAllowlist = (
  settings: Record<string, unknown> | null | undefined,
): string[] | undefined => {
  if (settings?.deviceChannelPolicy !== 'allowlist') return undefined;
  return parseIdList(settings.deviceChannelAllowFrom);
};

/**
 * Whether the conversation sits outside the channels the owner's devices are
 * limited to. DMs are never restricted: a DM is not a channel, and who may use
 * the devices there is already decided by `devicePolicy`.
 *
 * `candidateChannelIds` are the same raw IDs the group policy matches
 * (`extractChatId` plus `extraGroupAllowlistChannels`), so a Discord reply
 * thread counts as its parent channel.
 */
export const isDeviceChannelRestricted = (params: {
  candidateChannelIds: ReadonlyArray<string | undefined>;
  channelAllowlist: string[] | undefined;
  isDM: boolean;
}): boolean => {
  const { candidateChannelIds, channelAllowlist, isDM } = params;
  if (!channelAllowlist || isDM) return false;
  return !candidateChannelIds.some((id) => !!id && channelAllowlist.includes(id));
};
