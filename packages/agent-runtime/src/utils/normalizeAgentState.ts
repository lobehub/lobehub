import type { AgentRunBinding, AgentState, AgentWorldSnapshot } from '../types';

/**
 * Legacy `state.metadata` keys that now have a typed home on the state, and
 * where each one goes. Kept as data so the lift and the key strip stay in
 * sync and the mapping is greppable from either side.
 */
const WORLD_KEYS = {
  agentConfig: 'agent',
  agentGroup: 'group',
  connectorOwnershipNote: 'connectorOwnershipNote',
  evalContext: 'eval',
  projectInstructions: 'projectInstructions',
  searchDecision: 'searchDecision',
  userMemory: 'userMemory',
  userTimezone: 'userTimezone',
} as const satisfies Record<string, keyof AgentWorldSnapshot>;

const CHANNEL_KEYS = {
  botPlatformContext: 'botPlatform',
  discordContext: 'discord',
} as const satisfies Record<string, keyof NonNullable<AgentWorldSnapshot['channel']>>;

const DEVICE_KEYS = {
  activeDeviceId: 'id',
  devicePlatform: 'platform',
  deviceSystemInfo: 'systemInfo',
} as const satisfies Record<string, keyof NonNullable<AgentRunBinding['device']>>;

const LEGACY_KEYS = [
  ...Object.keys(WORLD_KEYS),
  ...Object.keys(CHANNEL_KEYS),
  ...Object.keys(DEVICE_KEYS),
];

const hasOwn = (record: Record<string, unknown>, key: string) =>
  Object.prototype.hasOwnProperty.call(record, key) && record[key] !== undefined;

/**
 * Lift legacy `metadata.*` run context into the typed `world` / `binding`
 * slots so every reader can rely on the slots alone.
 *
 * Runs at the persistence boundary (state load) for blobs written before the
 * slots existed. Slot values already present win over legacy keys, and the
 * legacy keys are removed from `metadata` so the blob is not carried twice
 * (the in-flight state blob has a hard 10MB ceiling). Returns the same object
 * when nothing needed lifting.
 */
export const normalizeAgentState = <T extends AgentState>(state: T): T => {
  const metadata = state.metadata;
  if (!metadata || !LEGACY_KEYS.some((key) => hasOwn(metadata, key))) return state;

  const world: AgentWorldSnapshot = { ...state.world };
  for (const [legacyKey, slotKey] of Object.entries(WORLD_KEYS)) {
    if (hasOwn(metadata, legacyKey) && world[slotKey] === undefined) {
      (world as Record<string, unknown>)[slotKey] = metadata[legacyKey];
    }
  }

  const channel = { ...world.channel };
  for (const [legacyKey, slotKey] of Object.entries(CHANNEL_KEYS)) {
    if (hasOwn(metadata, legacyKey) && channel[slotKey] === undefined) {
      (channel as Record<string, unknown>)[slotKey] = metadata[legacyKey];
    }
  }
  if (Object.keys(channel).length > 0) world.channel = channel;

  const device = { ...state.binding?.device };
  for (const [legacyKey, slotKey] of Object.entries(DEVICE_KEYS)) {
    if (hasOwn(metadata, legacyKey) && device[slotKey] === undefined) {
      (device as Record<string, unknown>)[slotKey] = metadata[legacyKey];
    }
  }
  const binding: AgentRunBinding | undefined =
    Object.keys(device).length > 0 ? { ...state.binding, device } : state.binding;

  const strippedMetadata: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (!LEGACY_KEYS.includes(key)) strippedMetadata[key] = value;
  }

  return {
    ...state,
    ...(binding && { binding }),
    metadata: strippedMetadata,
    ...(Object.keys(world).length > 0 && { world }),
  };
};
