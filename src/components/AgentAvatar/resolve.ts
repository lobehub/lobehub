import { DEFAULT_AVATAR } from '@lobechat/const';

/**
 * Whether an agent has no avatar of its own. Selectors still fill the legacy
 * default image in as a placeholder, so it counts as empty too.
 */
export const isDefaultAgentAvatar = (avatar?: string | null): boolean =>
  !avatar || avatar === DEFAULT_AVATAR;

interface ResolveAgentAvatarParams {
  agentId?: string | null;
  avatar?: string | null;
  name?: string | null;
  title?: string | null;
}

export type ResolvedAgentAvatar =
  | { avatar: string; kind: 'custom'; label?: string; seed?: string }
  | { kind: 'generated'; label?: string; seed?: string };

/**
 * Decide what an agent avatar draws. The generated character is seeded by the
 * agent id, so renaming an agent keeps its character; only an agent without an
 * id falls back to its name.
 */
export const resolveAgentAvatar = ({
  agentId,
  avatar,
  name,
  title,
}: ResolveAgentAvatarParams): ResolvedAgentAvatar => {
  const label = name || title || undefined;
  const seed = agentId || label;

  return isDefaultAgentAvatar(avatar)
    ? { kind: 'generated', label, seed }
    : { avatar: avatar!, kind: 'custom', label, seed };
};
