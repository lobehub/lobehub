import type { CodexForkTarget } from '@lobechat/types';

interface CodexSourceMessage {
  id: string;
  metadata?: { codexTurnId?: string; heteroSessionId?: string } | null;
  parentId?: string | null;
  threadId?: string | null;
}

/**
 * Resolves a saved message to its exact native Codex history boundary.
 *
 * Use when:
 * - Editing, resending, or branching a persisted Codex message.
 * Expects:
 * - The source row carries its own native thread and turn IDs.
 * Returns:
 * - The requested native boundary, or throws when provenance is unavailable.
 */
export const resolveCodexForkTarget = (
  messages: readonly CodexSourceMessage[],
  sourceMessageId: string,
  position: CodexForkTarget['position'],
): CodexForkTarget => {
  const source = messages.find((message) => message.id === sourceMessageId);
  if (!source) throw new Error('The selected Codex message is unavailable');

  const turnId = source.metadata?.codexTurnId;
  if (!turnId) throw new Error('The selected message has no native Codex turn');
  const threadId = source.metadata?.heteroSessionId;
  if (!threadId) throw new Error('The selected message has no native Codex thread');

  return { position, threadId, turnId };
};

/** Run inputs for one Codex branch turn: resume its own child or fork from its origin. */
export interface CodexBranchRun {
  /** Why the turn must not run; the executor settles it as a terminal error. */
  codexBranchError?: string;
  codexForkTarget?: CodexForkTarget;
  resumeSessionId?: string;
}

interface CodexBranchMessage extends CodexSourceMessage {
  content?: string | null;
  error?: unknown;
  role?: string;
  tools?: unknown[] | null;
}

/**
 * Chooses how a Codex branch reaches its native history, using only saved data.
 *
 * Use when:
 * - Sending, retrying, or regenerating inside a thread created by Codex Fork.
 * Expects:
 * - `thread.metadata.codexForkTarget` is the branch's immutable origin; it is never cleared.
 * - `resumeSessionId` is the cwd/binding-validated decision from the thread's own metadata.
 * - `messageId` is the user row this turn answers; `messages` are the loaded branch rows.
 * Returns:
 * - `{ resumeSessionId }` for an established child, recovered from the thread binding or from
 *   the branch's own message provenance when the binding write was lost.
 * - `{ codexForkTarget, resumeSessionId: origin thread }` before the child exists.
 * - `{ codexBranchError }` when the branch already shows a native answer whose child session
 *   was never saved, because forking again would silently drop that visible history.
 */
export const resolveCodexBranchRun = ({
  messageId,
  messages,
  resumeSessionId,
  thread,
}: {
  messageId: string;
  messages: readonly CodexBranchMessage[];
  resumeSessionId?: string;
  thread?: { id: string; metadata?: { codexForkTarget?: CodexForkTarget } | null };
}): CodexBranchRun => {
  const origin = thread?.metadata?.codexForkTarget;
  if (!thread || !origin) return { resumeSessionId };
  // Builds before the immutable origin preset the source as the branch binding.
  if (resumeSessionId && resumeSessionId !== origin.threadId) return { resumeSessionId };

  // Walk only this send's ancestry: sibling branches in the thread own other native children.
  const byId = new Map(messages.map((message) => [message.id, message]));
  const visited = new Set<string>();
  let hasVisibleAnswer = false;
  let currentId: string | null | undefined = messageId;
  while (currentId && !visited.has(currentId)) {
    visited.add(currentId);
    const message = byId.get(currentId);
    if (!message || message.threadId !== thread.id) break;
    const sessionId = message.metadata?.heteroSessionId;
    if (sessionId && sessionId !== origin.threadId) return { resumeSessionId: sessionId };
    hasVisibleAnswer ||=
      message.role === 'assistant' &&
      !message.error &&
      (Boolean(message.content?.trim()) || Boolean(message.tools?.length));
    currentId = message.parentId;
  }

  if (hasVisibleAnswer) {
    return {
      codexBranchError:
        'This Codex branch lost its native session. Fork again from the original message.',
    };
  }
  return { codexForkTarget: origin, resumeSessionId: origin.threadId };
};
