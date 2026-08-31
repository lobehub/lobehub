import type { AgentItem, NewAgent } from '../schemas';

/**
 * The field-copy core shared by every agent clone site: the group transfer's
 * referenced-member clone, the group copy, and the agent transfer's history
 * tombstone. One list, or the sites drift apart on which config a clone
 * carries.
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
