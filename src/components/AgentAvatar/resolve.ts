import { DEFAULT_AVATAR } from '@lobechat/const';
import { type AgentAvatarValue, parseAgentAvatar } from '@lobehub/ui';

/**
 * Whether an agent has no avatar of its own. Selectors still fill the legacy
 * default image in as a placeholder, so it counts as empty too.
 */
export const isDefaultAgentAvatar = (avatar?: string | null): boolean =>
  !avatar || avatar === DEFAULT_AVATAR;

/**
 * Whether an agent wears the generated character: none of its own, or one its
 * owner picked (an `agent-avatar:<shape>:<color>` value, which is no emoji or
 * image and must never reach a plain Avatar as one).
 */
export const isGeneratedAgentAvatar = (avatar?: string | null): boolean =>
  isDefaultAgentAvatar(avatar) || !!parseAgentAvatar(avatar);

interface ResolveAgentAvatarParams {
  agentId?: string | null;
  avatar?: string | null;
  name?: string | null;
  title?: string | null;
}

export type ResolvedAgentAvatar =
  | { avatar: string; kind: 'custom'; label?: string; seed?: string }
  | {
      /** The shape and color its owner picked; absent = derived from the seed. */
      choice?: AgentAvatarValue;
      kind: 'generated';
      label?: string;
      seed?: string;
    };

/**
 * Decide what an agent avatar draws. The generated character is seeded by the
 * agent id, so renaming an agent keeps its character; only an agent without an
 * id falls back to its name. A picked character keeps its shape and color.
 */
export const resolveAgentAvatar = ({
  agentId,
  avatar,
  name,
  title,
}: ResolveAgentAvatarParams): ResolvedAgentAvatar => {
  const label = name || title || undefined;
  const seed = agentId || label;

  if (isDefaultAgentAvatar(avatar)) return { kind: 'generated', label, seed };

  const choice = parseAgentAvatar(avatar);
  if (choice) return { choice, kind: 'generated', label, seed };

  return { avatar: avatar!, kind: 'custom', label, seed };
};

const DOM_PROP = /^(?:on[A-Z]|aria-|data-)/;
const DOM_PROP_KEYS = new Set(['id', 'role', 'tabIndex']);

/**
 * The props a wrapping trigger (Popover, Tooltip) injects into its child —
 * event handlers, `aria-*` / `data-*` and a few DOM attributes. The generated
 * character is an `<svg>` without the Avatar's own props, so only these are
 * forwarded to the element that wraps it.
 */
export const pickDomProps = (props: Record<string, unknown>): Record<string, unknown> =>
  Object.fromEntries(
    Object.entries(props).filter(([key]) => DOM_PROP.test(key) || DOM_PROP_KEYS.has(key)),
  );
