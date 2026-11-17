import { DEFAULT_AVATAR } from '@lobechat/const';

/**
 * Prefix of an `avatar` that picks a generated character: `generated:<seed>`
 * draws the character of that seed instead of the agent id's own one. Stored
 * in the same text column as an emoji or image URL, so it needs no migration.
 */
export const GENERATED_AGENT_AVATAR_PREFIX = 'generated:';

/** The `avatar` value that picks the generated character of `seed`. */
export const toGeneratedAgentAvatar = (seed: string): string =>
  `${GENERATED_AGENT_AVATAR_PREFIX}${seed}`;

/** The seed an `avatar` picked, if it picked a generated character. */
export const parseGeneratedAgentAvatar = (avatar?: string | null): string | undefined => {
  if (!avatar?.startsWith(GENERATED_AGENT_AVATAR_PREFIX)) return undefined;

  return avatar.slice(GENERATED_AGENT_AVATAR_PREFIX.length).trim() || undefined;
};

/**
 * Whether an agent has no avatar of its own. Selectors still fill the legacy
 * default image in as a placeholder, so it counts as empty too.
 */
export const isDefaultAgentAvatar = (avatar?: string | null): boolean =>
  !avatar || avatar === DEFAULT_AVATAR;

/**
 * Whether an agent avatar draws a generated character rather than an emoji or
 * image: it has none of its own, or it picked one (`generated:<seed>`). Only
 * the other values may go to an `Avatar`, an `<img>` or anywhere else as is.
 */
export const isGeneratedAgentAvatar = (avatar?: string | null): boolean =>
  isDefaultAgentAvatar(avatar) || avatar!.startsWith(GENERATED_AGENT_AVATAR_PREFIX);

/** The avatar as an emoji or image, or `undefined` when it draws a generated character. */
export const customAgentAvatar = (avatar?: string | null): string | undefined =>
  isGeneratedAgentAvatar(avatar) ? undefined : avatar!;

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
 * Decide what an agent avatar draws. A picked character (`generated:<seed>`)
 * wins; otherwise the generated character is seeded by the agent id, so
 * renaming an agent keeps its character; only an agent without an id falls
 * back to its name.
 */
export const resolveAgentAvatar = ({
  agentId,
  avatar,
  name,
  title,
}: ResolveAgentAvatarParams): ResolvedAgentAvatar => {
  const label = name || title || undefined;
  const seed = parseGeneratedAgentAvatar(avatar) || agentId || label;

  return isGeneratedAgentAvatar(avatar)
    ? { kind: 'generated', label, seed }
    : { avatar: avatar!, kind: 'custom', label, seed };
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
