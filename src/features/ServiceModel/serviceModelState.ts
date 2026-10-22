import { SERVICE_MODEL_TIER_SLOTS } from '@lobechat/const';
import type { PartialDeep } from 'type-fest';

import type {
  ServiceModelTier,
  ServiceModelTierItem,
  SystemAgentItem,
  UserServiceModelConfig,
  UserServiceModelConfigKey,
  UserSettings,
} from '@/types/user/settings';

/** The raw `systemAgent` column as stored for the user (only what they changed). */
export type StoredSystemAgent = PartialDeep<UserSettings['systemAgent']>;

export interface ModelRef {
  model: string;
  provider: string;
}

/**
 * Slots whose runtime honours `enabled: false`, so 「不启用」 really turns the
 * feature off. Other slots have no off switch at runtime and get no such option.
 */
const ENABLED_FLAG_SLOTS = new Set<UserServiceModelConfigKey>([
  'followUpAction',
  'inputCompletion',
  'promptRewrite',
  'topicAutoSummary',
]);

/** Speech-to-text treats an empty model as unconfigured, which hides voice input. */
const EMPTY_MODEL_OFF_SLOTS = new Set<UserServiceModelConfigKey>(['asr']);

export const canDisableSlot = (slot: UserServiceModelConfigKey) =>
  ENABLED_FLAG_SLOTS.has(slot) || EMPTY_MODEL_OFF_SLOTS.has(slot);

export const tierOfSlot = (slot: UserServiceModelConfigKey): ServiceModelTier | undefined =>
  (Object.keys(SERVICE_MODEL_TIER_SLOTS) as ServiceModelTier[]).find((tier) =>
    SERVICE_MODEL_TIER_SLOTS[tier].includes(slot),
  );

export type SlotState =
  | { kind: 'custom'; value: ModelRef }
  /** `value` is the model the slot actually runs. */
  | { kind: 'follow'; tier?: ServiceModelTier; value?: ModelRef }
  | { kind: 'off'; tier?: ServiceModelTier };

export type SlotChoice = { kind: 'follow' } | { kind: 'off' } | { kind: 'custom'; value: ModelRef };

const toRef = (item?: Partial<SystemAgentItem> | ServiceModelTierItem): ModelRef | undefined =>
  item?.model && item.provider ? { model: item.model, provider: item.provider } : undefined;

export const isSameModel = (a?: ModelRef, b?: ModelRef) =>
  !!a && !!b && a.model === b.model && a.provider === b.provider;

/** A slot pinned to exactly its tier's model is following that tier (the tier wrote it there). */
const isFollowing = (pinned: ModelRef | undefined, tierItem: ModelRef | undefined) =>
  !pinned || isSameModel(pinned, tierItem);

export const getTierItem = (stored: StoredSystemAgent | undefined, tier: ServiceModelTier) =>
  toRef(stored?.tiers?.[tier]);

/** The model a slot runs while it follows: its tier's pick, else the system recommendation. */
export const resolveFollowModel = (
  stored: StoredSystemAgent | undefined,
  defaults: UserServiceModelConfig,
  slot: UserServiceModelConfigKey,
): ModelRef | undefined => {
  const tier = tierOfSlot(slot);
  return (tier ? getTierItem(stored, tier) : undefined) ?? toRef(defaults[slot]);
};

/**
 * @param defaults the system-recommended config (code defaults plus the
 * deployment's `SYSTEM_AGENT` overrides), i.e. `defaultSettings.systemAgent`
 */
export const resolveSlotState = (
  stored: StoredSystemAgent | undefined,
  defaults: UserServiceModelConfig,
  slot: UserServiceModelConfigKey,
): SlotState => {
  const storedItem = stored?.[slot] as Partial<SystemAgentItem> | undefined;
  const tier = tierOfSlot(slot);

  if (EMPTY_MODEL_OFF_SLOTS.has(slot)) {
    const model = storedItem?.model ?? defaults[slot].model;
    const provider = storedItem?.provider ?? defaults[slot].provider;
    if (!model || !provider) return { kind: 'off', tier };
  }

  if (ENABLED_FLAG_SLOTS.has(slot) && (storedItem?.enabled ?? defaults[slot].enabled) === false)
    return { kind: 'off', tier };

  const pinned = toRef(storedItem);
  const tierItem = tier ? getTierItem(stored, tier) : undefined;

  if (isFollowing(pinned, tierItem))
    return { kind: 'follow', tier, value: resolveFollowModel(stored, defaults, slot) };

  return { kind: 'custom', value: pinned! };
};

const cloneStored = (stored: StoredSystemAgent | undefined): Record<string, any> =>
  structuredClone((stored ?? {}) as Record<string, any>);

const clearPin = (next: Record<string, any>, slot: string) => {
  const item = next[slot];
  if (!item || typeof item !== 'object') return;
  delete item.model;
  delete item.provider;
  if (Object.keys(item).length === 0) delete next[slot];
};

/**
 * Write each set tier's model into the slots that follow it. Runtimes read a
 * slot's own model and know nothing about tiers, so following must be stored.
 */
const syncTierPins = (
  next: Record<string, any>,
  skipSlots: ReadonlySet<UserServiceModelConfigKey>,
) => {
  for (const tier of Object.keys(SERVICE_MODEL_TIER_SLOTS) as ServiceModelTier[]) {
    const tierItem = toRef(next.tiers?.[tier]);
    if (!tierItem) continue;

    for (const slot of SERVICE_MODEL_TIER_SLOTS[tier]) {
      if (skipSlots.has(slot) || toRef(next[slot])) continue;
      next[slot] = { ...next[slot], ...tierItem };
    }
  }
  return next as StoredSystemAgent;
};

export interface ApplyOptions {
  /** Slots this surface does not manage (e.g. personal chat-assist rows inside a workspace). */
  skipSlots?: ReadonlySet<UserServiceModelConfigKey>;
}

const NO_SKIP: ReadonlySet<UserServiceModelConfigKey> = new Set();

export const applyTierChoice = (
  stored: StoredSystemAgent | undefined,
  tier: ServiceModelTier,
  value: ModelRef | undefined,
  { skipSlots = NO_SKIP }: ApplyOptions = {},
): StoredSystemAgent => {
  const next = cloneStored(stored);
  const prevTierItem = getTierItem(stored, tier);

  // Slots that followed the old tier value follow the new one; pinned slots stay.
  for (const slot of SERVICE_MODEL_TIER_SLOTS[tier]) {
    if (skipSlots.has(slot)) continue;
    if (isFollowing(toRef(next[slot]), prevTierItem)) clearPin(next, slot);
  }

  const tiers = { ...next.tiers };
  if (value) tiers[tier] = { model: value.model, provider: value.provider };
  else delete tiers[tier];
  if (Object.keys(tiers).length > 0) next.tiers = tiers;
  else delete next.tiers;

  return syncTierPins(next, skipSlots);
};

export const applySlotChoice = (
  stored: StoredSystemAgent | undefined,
  slot: UserServiceModelConfigKey,
  choice: SlotChoice,
  { skipSlots = NO_SKIP }: ApplyOptions = {},
): StoredSystemAgent => {
  const next = cloneStored(stored);
  const item: Record<string, unknown> = { ...next[slot] };

  if (choice.kind === 'off') {
    if (EMPTY_MODEL_OFF_SLOTS.has(slot)) Object.assign(item, { model: '', provider: '' });
    else item.enabled = false;
    next[slot] = item;
    return syncTierPins(next, skipSlots);
  }

  if (choice.kind === 'custom') Object.assign(item, choice.value);
  else {
    delete item.model;
    delete item.provider;
  }
  // Picking a model (or the follow item) is how a disabled task comes back on.
  if (ENABLED_FLAG_SLOTS.has(slot)) item.enabled = true;

  if (Object.keys(item).length > 0) next[slot] = item;
  else delete next[slot];

  return syncTierPins(next, skipSlots);
};

/** 「全部恢复」: every pinned slot follows again; disabled tasks stay disabled. */
export const restoreAllSlots = (
  stored: StoredSystemAgent | undefined,
  defaults: UserServiceModelConfig,
  slots: UserServiceModelConfigKey[],
  options: ApplyOptions = {},
): StoredSystemAgent => {
  let next = stored;
  for (const slot of slots) {
    if (resolveSlotState(next, defaults, slot).kind === 'custom')
      next = applySlotChoice(next, slot, { kind: 'follow' }, options);
  }
  return next ?? {};
};
