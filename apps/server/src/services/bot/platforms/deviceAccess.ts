import { parseIdList } from './const';
import type { FieldSchema } from './types';

/**
 * Who on a bot may use the owner's devices (local system, remote device).
 *
 * - `owner` (default): only the sender whose ID equals `settings.userId`.
 * - `allowlist`: the owner, plus the user IDs in `deviceAllowFrom`.
 * - `channel`: the owner anywhere, plus everyone in the channels listed in
 *   `deviceChannelAllowFrom`. Only platforms with group chat offer it.
 *
 * Kept apart from `allowFrom`: being allowed to talk to the bot is not being
 * trusted with the owner's machine, so neither list implies the other.
 */
export type DevicePolicy = 'allowlist' | 'channel' | 'owner';

export const devicePolicyField: FieldSchema = {
  key: 'devicePolicy',
  default: 'owner',
  description: 'channel.devicePolicyHint',
  enum: ['owner', 'allowlist', 'channel'],
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
 *
 * Under `devicePolicy: 'channel'` the list grants access instead of limiting
 * it (`extractDeviceChannelGrantlist`), so no restriction applies.
 */
export const extractDeviceChannelAllowlist = (
  settings: Record<string, unknown> | null | undefined,
): string[] | undefined => {
  if (settings?.devicePolicy === 'channel') return undefined;
  if (settings?.deviceChannelPolicy !== 'allowlist') return undefined;
  return parseIdList(settings.deviceChannelAllowFrom);
};

/**
 * The channel IDs whose members may all use the owner's devices
 * (`devicePolicy: 'channel'`), or `undefined` under any other policy. An empty
 * list grants nobody, leaving only the owner.
 */
export const extractDeviceChannelGrantlist = (
  settings: Record<string, unknown> | null | undefined,
): string[] | undefined => {
  if (settings?.devicePolicy !== 'channel') return undefined;
  return parseIdList(settings.deviceChannelAllowFrom);
};

/**
 * Whether a conversation sits in one of `channelList`. DMs never match: a DM is
 * not a channel. `candidateChannelIds` are the same raw IDs the group policy
 * matches (`extractChatId` plus `extraGroupAllowlistChannels`), so a Discord
 * reply thread counts as its parent channel.
 */
const isInDeviceChannels = (params: {
  candidateChannelIds: ReadonlyArray<string | undefined>;
  channelList: string[];
  isDM: boolean;
}): boolean => {
  const { candidateChannelIds, channelList, isDM } = params;
  if (isDM) return false;
  return candidateChannelIds.some((id) => !!id && channelList.includes(id));
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
  return !isInDeviceChannels({ candidateChannelIds, channelList: channelAllowlist, isDM });
};

/**
 * Whether everyone in the conversation may use the owner's devices because it
 * sits in a channel the owner granted (`devicePolicy: 'channel'`). DMs are
 * never granted; there only the owner may use the devices.
 */
export const isDeviceChannelGranted = (params: {
  candidateChannelIds: ReadonlyArray<string | undefined>;
  channelGrantlist: string[] | undefined;
  isDM: boolean;
}): boolean => {
  const { candidateChannelIds, channelGrantlist, isDM } = params;
  if (!channelGrantlist) return false;
  return isInDeviceChannels({ candidateChannelIds, channelList: channelGrantlist, isDM });
};
