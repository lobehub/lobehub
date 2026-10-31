const THREAD_TITLE_LENGTH = 60;

/** A thread is named after the first line of the message it branched from, when loaded. */
export const threadTitle = (root?: { content: string } | null) => {
  const line = root?.content.trim().split('\n')[0];
  return line ? line.slice(0, THREAD_TITLE_LENGTH) : undefined;
};
