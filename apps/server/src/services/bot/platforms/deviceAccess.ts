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
