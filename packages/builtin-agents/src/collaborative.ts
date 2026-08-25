import { BUILTIN_AGENT_SLUGS } from './types';

/**
 * Builtin agents that a Workspace provisions once and every member then works
 * in together, rather than one member owning them.
 *
 * The row is created lazily by whichever member reaches the feature first, so
 * `agents.user_id` records an accident of timing rather than authorship, and no
 * `resource_permissions` row is ever written for it. Two rules follow, and both
 * read this set:
 *
 * - authorization treats the row as workspace infrastructure instead of the
 *   creator's private content (see `isCollaborativeBuiltinAgent` in the server's
 *   resourcePermission service);
 * - the model choice stays personal for every member, admins included (see
 *   `AgentModelConfig.personalModelSelection`).
 *
 * Deliberately NOT the whole of `BUILTIN_AGENT_SLUGS`: the internal automation
 * agents (`nightly-review`, `self-reflection`, `self-feedback-intent`,
 * `skill-management`, `verify-agent`, `task-agent`, the onboarding agents, the
 * group supervisor) have no configuration surface, and letting any member
 * repoint their persisted model / chatConfig would silently change background
 * automation for the entire workspace. They keep the ordinary creator + General
 * access rules, which still allow every member to reach them through whatever
 * level the workspace grants.
 */
export const COLLABORATIVE_BUILTIN_AGENT_SLUGS: ReadonlySet<string> = new Set<string>([
  BUILTIN_AGENT_SLUGS.agentBuilder,
  BUILTIN_AGENT_SLUGS.groupAgentBuilder,
  BUILTIN_AGENT_SLUGS.inbox,
  BUILTIN_AGENT_SLUGS.pageAgent,
]);

/**
 * Whether an agent row is one of the shared Workspace builtins above.
 *
 * `virtual` is what provisioning writes; a legacy row that merely holds a
 * reserved slug (the passthrough config endpoint used to allow that) stays an
 * ordinary agent, so no migration is needed to keep it out.
 */
export const isCollaborativeBuiltinAgentRow = (row: {
  slug?: string | null;
  virtual?: boolean | null;
  workspaceId?: string | null;
}): boolean =>
  !!row.workspaceId &&
  row.virtual === true &&
  !!row.slug &&
  COLLABORATIVE_BUILTIN_AGENT_SLUGS.has(row.slug);
