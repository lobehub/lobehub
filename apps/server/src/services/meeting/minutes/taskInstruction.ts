/** `mm:ss`, or `h:mm:ss` past the first hour. */
export const formatOffset = (ms: number) => {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (value: number) => String(value).padStart(2, '0');
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`;
};

/** Transcript excerpt quoted into a task; enough to recall the context, not the whole meeting. */
const MAX_QUOTE_CHARS = 1200;

interface TaskInstructionInput {
  dueDate?: string;
  meetingId: string;
  meetingTitle: string;
  /** Transcript passages the action item was taken from. */
  quote: string[];
  startMs?: number;
  text: string;
}

/**
 * Instruction of a task created from a meeting action item: the item itself,
 * its deadline, and where it was said — a link back to the meeting at that
 * moment plus the quoted passage — so the assignee (person or agent) has the
 * context without replaying the recording.
 */
export const buildTaskInstruction = ({
  dueDate,
  meetingId,
  meetingTitle,
  quote,
  startMs,
  text,
}: TaskInstructionInput) => {
  const at = startMs === undefined ? '' : ` at ${formatOffset(startMs)}`;
  const excerpt = quote.join(' ').slice(0, MAX_QUOTE_CHARS);

  return [
    text,
    dueDate ? `\nDue: ${dueDate}` : '',
    `\nFrom meeting [${meetingTitle}](/meeting/${meetingId})${at}.`,
    excerpt ? `\n> ${excerpt}` : '',
  ]
    .filter(Boolean)
    .join('\n');
};
