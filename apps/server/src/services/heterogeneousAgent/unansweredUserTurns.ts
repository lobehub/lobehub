import { LOADING_FLAT } from '@lobechat/const';
import type { HeteroAttachedFileRef } from '@lobechat/heterogeneous-agents';
import { appendAttachedFilesToPrompt } from '@lobechat/heterogeneous-agents';

interface TopicMessageLike {
  content?: string | null;
  fileList?: { fileType?: string; name: string; size?: number; url: string }[] | null;
  imageList?: { alt?: string; url: string }[] | null;
  reasoning?: { content?: string | null } | null;
  role: string;
  tools?: unknown[] | null;
}

/** A user message no reply followed; `files` URLs are as stored until resolved. */
export interface UnansweredUserTurn {
  content: string;
  files: HeteroAttachedFileRef[];
}

const USER_MAX = 1024;

const hasText = (content?: string | null): content is string =>
  !!content?.trim() && content !== LOADING_FLAT;

const attachedFiles = (m: TopicMessageLike): HeteroAttachedFileRef[] => [
  ...(m.imageList ?? []).map(({ alt, url }) => ({ name: alt || 'image', url })),
  ...(m.fileList ?? []).map(({ fileType, name, size, url }) => ({ fileType, name, size, url })),
];

/**
 * User messages at the end of a topic that no reply followed.
 *
 * A resumed CLI session knows only the turns the CLI wrote to its own
 * transcript. When the user stops a run before the CLI records the prompt
 * (Claude Code writes it about half a second after reading it), the prompt
 * exists only in LobeHub, and the next turn resumes a session that never saw
 * it. Any output from the stopped run (text, reasoning, a tool call) proves the
 * CLI read the prompt, so only messages with nothing after them are returned.
 * Their attachments come along: the current turn carries only its own.
 *
 * A stop that lands before the server accepts the message restores the draft,
 * so the user often re-sends the same text: copies of `currentPrompt` and
 * repeats are dropped.
 *
 * `messages` must be in chronological order and exclude the current turn.
 */
export const collectUnansweredUserTurns = (
  messages: TopicMessageLike[],
  currentPrompt?: string,
): UnansweredUserTurn[] => {
  let pending: UnansweredUserTurn[] = [];

  for (const m of messages) {
    if (m.role === 'user') {
      const content = hasText(m.content) ? m.content : '';
      const files = attachedFiles(m);
      if (content || files.length > 0) pending.push({ content, files });
      continue;
    }

    const answered =
      m.role === 'tool' ||
      (m.role === 'assistant' &&
        (hasText(m.content) || hasText(m.reasoning?.content) || (m.tools?.length ?? 0) > 0));
    if (answered) pending = [];
  }

  const current = currentPrompt?.trim();
  const seen = new Set<string>();
  return pending.filter(({ content, files }) => {
    const text = content.trim();
    if (text && text === current) return false;
    const key = JSON.stringify([text, files.map((file) => file.url)]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

/**
 * System-context section that re-delivers unanswered user messages to a
 * resumed session. Returns `undefined` when there is nothing to deliver.
 */
export const formatUnansweredUserTurns = (turns?: UnansweredUserTurn[]): string | undefined => {
  if (!turns || turns.length === 0) return;

  const entries = turns.map(({ content, files }) => {
    const text = content.length > USER_MAX ? `${content.slice(0, USER_MAX)}… [truncated]` : content;
    return `<user>\n${appendAttachedFilesToPrompt(text, files)}\n</user>`;
  });

  return [
    '<unanswered_user_messages>',
    'The user sent these messages earlier in this conversation, but the run that should have answered them ended before you replied, so your session history may not contain them. Read them as context for the current message.',
    ...entries,
    '</unanswered_user_messages>',
  ].join('\n');
};
