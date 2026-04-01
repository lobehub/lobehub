import { type LobeChatDatabase } from '@lobechat/database';

import { SharedAgentModel } from '@/database/models/sharedAgent';
import { PRESET_AGENTS } from '@/server/services/user/presetAgents';

interface PresetSharedAgentValue {
  avatar?: string | null;
  backgroundColor?: string | null;
  description?: string | null;
  model?: string | null;
  provider?: string | null;
  tags: string[];
  title?: string | null;
}

const normalizeNullableValue = (value?: string | null) => value ?? null;

const isSameTags = (current: string[] | null | undefined, next: string[]) => {
  if ((current?.length || 0) !== next.length) return false;

  return next.every((tag, index) => current?.[index] === tag);
};

const buildPresetValue = (preset: (typeof PRESET_AGENTS)[number]): PresetSharedAgentValue => ({
  avatar: preset.avatar,
  backgroundColor: preset.backgroundColor,
  description: preset.description,
  model: preset.model,
  provider: preset.provider,
  tags: preset.tags,
  title: preset.title,
});

const shouldUpdatePresetSharedAgent = (
  current: {
    avatar?: string | null;
    backgroundColor?: string | null;
    description?: string | null;
    model?: string | null;
    provider?: string | null;
    tags?: string[] | null;
    title?: string | null;
  },
  next: PresetSharedAgentValue,
) => {
  if (normalizeNullableValue(current.avatar) !== normalizeNullableValue(next.avatar)) return true;
  if (
    normalizeNullableValue(current.backgroundColor) !== normalizeNullableValue(next.backgroundColor)
  )
    return true;
  if (normalizeNullableValue(current.description) !== normalizeNullableValue(next.description))
    return true;
  if (normalizeNullableValue(current.model) !== normalizeNullableValue(next.model)) return true;
  if (normalizeNullableValue(current.provider) !== normalizeNullableValue(next.provider))
    return true;
  if (normalizeNullableValue(current.title) !== normalizeNullableValue(next.title)) return true;

  return !isSameTags(current.tags, next.tags);
};

export const syncPresetSharedAgents = async (db: LobeChatDatabase) => {
  const sharedAgentModel = new SharedAgentModel(db);
  const existingAgents = await sharedAgentModel.listAll();
  const existingAgentMap = new Map(
    existingAgents.filter((item) => !!item.title).map((item) => [item.title as string, item]),
  );

  for (const [sort, preset] of PRESET_AGENTS.entries()) {
    const nextValue = buildPresetValue(preset);
    const current = existingAgentMap.get(preset.title);

    if (!current) {
      await sharedAgentModel.create({ ...nextValue, enabled: true, sort });
      continue;
    }

    if (!shouldUpdatePresetSharedAgent(current, nextValue)) continue;

    await sharedAgentModel.update(current.id, nextValue);
  }
};
