import type { ConversationHistoryEntry } from './cloudHeteroContext';

/**
 * Builds the system context injected before every user prompt for hetero runs
 * dispatched to a **remote device** (`lh connect`), as opposed to a cloud
 * sandbox.
 *
 * Unlike {@link buildCloudHeteroContext}, this deliberately strips all the
 * cloud-sandbox boilerplate (ephemeral `/workspace`, pre-cloned repo list,
 * "commit-or-lose-your-work" warnings, injected GITHUB_TOKEN). A device is the
 * user's own persistent machine with their real filesystem and credentials, so
 * none of that applies — injecting it would actively mislead the agent.
 *
 * What remains is only what's genuinely useful on a device:
 * - the agent-level static context (workspace conventions / rules), and
 * - prior conversation turns when a session is resumed without a native session
 *   file.
 *
 * Returns `undefined` when there's nothing meaningful to inject, so the caller
 * can omit the extra content block entirely.
 */
export function buildRemoteDeviceHeteroContext(params: {
  /** Static systemContext from HeterogeneousProviderConfig.systemContext (agent-level). */
  agentSystemContext?: string;
  /**
   * Recent conversation turns to inject when resuming a session whose native
   * context is unavailable (e.g. a fresh CLI process on the device).
   */
  conversationHistory?: ConversationHistoryEntry[];
  /** Working directory the agent will run in, surfaced so it can orient itself. */
  cwd?: string;
}): string | undefined {
  const { agentSystemContext, conversationHistory, cwd } = params;

  const parts: string[] = [];

  // --- Agent-level static context (highest priority, goes first) ---
  if (agentSystemContext?.trim()) {
    parts.push(agentSystemContext.trim());
  }

  // --- Device workspace note (minimal — it's the user's real machine) ---
  if (cwd?.trim()) {
    parts.push(
      [
        '## Workspace',
        `You are running on the user's own machine. Your working directory is \`${cwd.trim()}\`.`,
        'This is a persistent local filesystem — changes are not lost when the task ends, so',
        'there is no need to commit or push purely to preserve your work.',
      ].join('\n'),
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

  return parts.length > 0 ? parts.join('\n\n') : undefined;
}
