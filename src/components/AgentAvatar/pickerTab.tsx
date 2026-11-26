'use client';

import {
  AgentAvatarPicker,
  createAgentAvatarTab,
  type EmojiPickerProps,
  getAgentAvatarTraits,
  parseAgentAvatar,
  stringifyAgentAvatar,
} from '@lobehub/ui';

type EmojiPickerCustomTab = NonNullable<EmojiPickerProps['customTabs']>[number];

/**
 * The shape and color the picker opens on: the character the agent picked, else the one its id
 * generates — so opening the picker shows what the agent wears now, not an empty selection.
 */
export const agentAvatarPickerDefault = (avatar?: string | null, agentId?: string | null) => {
  const picked = parseAgentAvatar(avatar);
  if (picked) return picked;
  if (!agentId) return undefined;

  const { color, shape } = getAgentAvatarTraits(agentId);
  return { color, shape };
};

/**
 * The `EmojiPicker` tab for picking an Agent's character. Same tab as `@lobehub/ui`'s
 * `createAgentAvatarTab`, except that it opens on the character the agent wears now. A pick keeps
 * the popup open so shapes and colors can be tried in a row; the value is an
 * `agent-avatar:<shape>:<color>` string, drawn by `AgentAvatar`.
 */
export const createAgentCharacterTab = (agentId?: string | null): EmojiPickerCustomTab => ({
  ...createAgentAvatarTab(),
  render: (handleAvatarChange, avatar) => (
    <AgentAvatarPicker
      defaultValue={agentAvatarPickerDefault(avatar, agentId)}
      style={{ width: 300 }}
      onChange={(choice) => handleAvatarChange(stringifyAgentAvatar(choice), { keepOpen: true })}
    />
  ),
});
