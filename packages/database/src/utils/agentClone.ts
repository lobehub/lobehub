import type { AgentItem, NewAgent } from '../schemas';

/**
 * The field-copy core for clone sites that need a WORKING replacement agent:
 * the group transfer's referenced-member clone and the group copy. (The agent
 * transfer's history tombstone deliberately does NOT use this — see
 * {@link buildAgentTombstoneValues}.)
 *
 * Deliberately never copies `slug` (the schema default mints a fresh random
 * one — a clone must not steal the source's identity) or `clientId` (device
 * sync identity is not clonable).
 */
export const buildAgentCopyValues = (
  source: AgentItem | undefined,
  target: { userId: string; workspaceId: string | null },
  fallbackTitle: string,
  targetVisibility?: 'private' | 'public',
): NewAgent => ({
  agencyConfig: source?.agencyConfig,
  avatar: source?.avatar,
  backgroundColor: source?.backgroundColor,
  chatConfig: source?.chatConfig,
  description: source?.description,
  editorData: source?.editorData,
  fewShots: source?.fewShots,
  model: source?.model,
  // `agentDisplayName` prefers `name` over `title` for author attribution —
  // dropping it would make preserved history render the role instead of the
  // original speaker.
  name: source?.name,
  openingMessage: source?.openingMessage,
  openingQuestions: source?.openingQuestions,
  params: source?.params,
  pinned: source?.pinned,
  plugins: source?.plugins,
  provider: source?.provider,
  systemRole: source?.systemRole,
  tags: source?.tags,
  title: source?.title || fallbackTitle,
  tts: source?.tts,
  userId: target.userId,
  virtual: source?.virtual ?? true,
  ...(target.workspaceId && targetVisibility ? { visibility: targetVisibility } : {}),
  workspaceId: target.workspaceId,
});

/**
 * The history tombstone's field set: ONLY what rendering a past speaker needs
 * (`agentDisplayName` + avatar treatment). Nothing operational is copied — a
 * tombstone lands in the GROUP's scope, which may belong to someone the
 * source agent's owner never shared configuration with, and a rosterless
 * clone sits outside the parent-group permission cap; copying `systemRole` /
 * `plugins` / `params` / `agencyConfig` would hand the tombstone's owner a
 * readable snapshot of configuration `getAgentConfigById` would otherwise
 * redact.
 */
export const buildAgentTombstoneValues = (
  source: AgentItem | undefined,
  target: { userId: string; workspaceId: string | null },
  fallbackTitle: string,
): NewAgent => ({
  avatar: source?.avatar,
  backgroundColor: source?.backgroundColor,
  name: source?.name,
  // Explicit null, or the schema's `$defaultFn` mints a random slug and this
  // display-only internal row becomes addressable through slug lookups.
  slug: null,
  title: source?.title || fallbackTitle,
  userId: target.userId,
  virtual: true,
  workspaceId: target.workspaceId,
});
