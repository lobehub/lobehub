import type { ConversationHistoryEntry } from './cloudHeteroContext';
import type { UnansweredUserTurn } from './unansweredUserTurns';
import { formatUnansweredUserTurns } from './unansweredUserTurns';

/**
 * Builds the system context injected before every user prompt for hetero runs
 * dispatched to a **remote device** (`lh connect`), as opposed to a cloud
 * sandbox.
 *
 * Unlike {@link buildCloudHeteroContext}, this deliberately strips all the
 * cloud-sandbox boilerplate (ephemeral `/workspace`, pre-cloned repo list,
 * "commit-or-lose-your-work" warnings, injected GITHUB_TOKEN). None of that
 * applies to a device run, so injecting it would actively mislead the agent.
 *
 * What remains is only what's genuinely useful on a device:
 * - the agent-level static context (workspace conventions / rules),
 * - the selected git worktree, which is not the process cwd, and
 * - prior conversation turns when a session is resumed without a native session
 *   file.
 *
 * Returns `undefined` when there's nothing meaningful to inject, so the caller
 * can omit the extra content block entirely.
 */
export function buildRemoteDeviceHeteroContext(params: {
  /**
   * The topic's selected worktree (`workingDirectoryConfig.git.activeWorktree`)
   * and the source repo the CLI is spawned in. The spawn cwd stays on the source
   * so the CLI's per-cwd session survives, which leaves this as the only way the
   * agent learns where the conversation's work lives.
   */
  activeWorktree?: { path: string; sourceDirectory?: string };
  /** Static systemContext from HeterogeneousProviderConfig.systemContext (agent-level). */
  agentSystemContext?: string;
  /**
   * Recent conversation turns to inject when resuming a session whose native
   * context is unavailable (e.g. a fresh CLI process on the device).
   */
  conversationHistory?: ConversationHistoryEntry[];
  /** User messages a resumed session may have missed (see `collectUnansweredUserTurns`). */
  unansweredUserTurns?: UnansweredUserTurn[];
}): string | undefined {
  const { activeWorktree, agentSystemContext, conversationHistory, unansweredUserTurns } = params;

  const parts: string[] = [];

  // --- Agent-level static context (highest priority, goes first) ---
  if (agentSystemContext?.trim()) {
    parts.push(agentSystemContext.trim());
  }

  // --- Selected worktree ---
  // The server cannot see the device's filesystem, so the agent is the one to
  // check that the worktree still exists (it may have removed it last turn).
  if (activeWorktree && activeWorktree.path !== activeWorktree.sourceDirectory) {
    const { path, sourceDirectory } = activeWorktree;
    const fallback = sourceDirectory ? ` If it no longer exists, work in ${sourceDirectory}.` : '';
    parts.push(
      `<active_worktree>\nThis conversation's selected git worktree is ${path}. Your process starts in the source repository, so read, edit and run git commands in the worktree.${fallback}\n</active_worktree>`,
    );
  }

  // --- Previous conversation context (injected when session was reset) ---
  // Mirrors buildCloudHeteroContext truncation: user 1 KB, assistant 2 KB.
  if (conversationHistory && conversationHistory.length > 0) {
    const USER_MAX = 1024;
    const ASST_MAX = 2048;
    const entries = conversationHistory.map((entry) => {
      const limit = entry.role === 'user' ? USER_MAX : ASST_MAX;
      const body =
        entry.content.length > limit
          ? `${entry.content.slice(0, limit)}… [truncated]`
          : entry.content;
      return `<${entry.role}>\n${body}\n</${entry.role}>`;
    });
    parts.push(`<previous_conversation>\n${entries.join('\n')}\n</previous_conversation>`);
  }

  const unanswered = formatUnansweredUserTurns(unansweredUserTurns);
  if (unanswered) parts.push(unanswered);

  return parts.length > 0 ? parts.join('\n\n') : undefined;
}
