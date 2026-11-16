import type { OpenAIChatMessage } from '@lobechat/types';

/** Bump when the meeting minutes prompt or its output contract meaningfully changes. */
export const MEETING_MINUTES_PROMPT_VERSION = 'v1';

const segmentIndexes = {
  description: 'Indexes (the number in `[#n …]`) of the transcript lines this item is taken from.',
  items: { minimum: 0, type: 'integer' },
  maxItems: 20,
  type: 'array',
} as const;

export const MEETING_MINUTES_JSON_SCHEMA = {
  name: 'meeting_minutes',
  schema: {
    additionalProperties: false,
    properties: {
      actionItems: {
        items: {
          additionalProperties: false,
          properties: {
            /** Owner exactly as named in the meeting or the assignee list; '' when nobody took it. */
            assignee: { maxLength: 120, type: 'string' },
            /** `YYYY-MM-DD`, resolved against the meeting date; '' when no deadline was given. */
            dueDate: { maxLength: 10, type: 'string' },
            segmentIndexes,
            text: { maxLength: 300, minLength: 1, type: 'string' },
          },
          required: ['text', 'assignee', 'dueDate', 'segmentIndexes'],
          type: 'object',
        },
        maxItems: 30,
        type: 'array',
      },
      chapters: {
        items: {
          additionalProperties: false,
          properties: {
            endIndex: { minimum: 0, type: 'integer' },
            startIndex: { minimum: 0, type: 'integer' },
            title: { maxLength: 80, minLength: 1, type: 'string' },
          },
          required: ['title', 'startIndex', 'endIndex'],
          type: 'object',
        },
        maxItems: 20,
        type: 'array',
      },
      decisions: {
        items: {
          additionalProperties: false,
          properties: {
            segmentIndexes,
            text: { maxLength: 300, minLength: 1, type: 'string' },
          },
          required: ['text', 'segmentIndexes'],
          type: 'object',
        },
        maxItems: 20,
        type: 'array',
      },
      keywords: { items: { maxLength: 40, type: 'string' }, maxItems: 8, type: 'array' },
      summary: { maxLength: 2000, minLength: 1, type: 'string' },
    },
    required: ['summary', 'chapters', 'decisions', 'actionItems', 'keywords'],
    type: 'object' as const,
  },
  strict: true,
};

export interface MeetingMinutesTranscriptLine {
  /** Position in the transcript, cited back by the model as `segmentIndexes`. */
  index: number;
  /** Speaker display name or diarization label; empty when unknown. */
  speaker?: string;
  startMs: number;
  text: string;
}

export interface MeetingMinutesInput {
  /** Members and agents a to-do can be assigned to, by display name. */
  assigneeNames: string[];
  /** Transcript language when known (`en` / `zh`); `auto` lets the transcript decide. */
  language?: string;
  /** Meeting date as `YYYY-MM-DD (Weekday)`, the anchor for relative deadlines. */
  meetingDate: string;
  /** The person who recorded the meeting, the owner of first-person to-dos ("I'll…", "我来…"). */
  recorderName?: string;
  title: string;
  transcript: MeetingMinutesTranscriptLine[];
}

const formatOffset = (ms: number) => {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (value: number) => String(value).padStart(2, '0');
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`;
};

/** One transcript line as the model reads it: `[#3 01:24 Alice] text`. */
export const formatMeetingTranscriptLine = (line: MeetingMinutesTranscriptLine) =>
  `[#${line.index} ${formatOffset(line.startMs)}${line.speaker ? ` ${line.speaker}` : ''}] ${line.text}`;

/**
 * Turn a meeting transcript into minutes: summary, chapters, decisions and
 * action items, each citing the transcript lines it comes from.
 *
 * The caller maps the cited line indexes back to segment ids and timestamps,
 * resolves `assignee` names to members or agents, and validates every field;
 * the prompt's job is to stay faithful to what was actually said.
 */
export const chainMeetingMinutes = ({
  assigneeNames,
  language,
  meetingDate,
  recorderName,
  title,
  transcript,
}: MeetingMinutesInput): { messages: OpenAIChatMessage[] } => ({
  messages: [
    {
      content: [
        'You write the minutes of a recorded meeting from its transcript. Each transcript line looks like `[#index mm:ss Speaker] text`; the speaker may be missing, and speech recognition may have misheard words.',
        '',
        'Return:',
        '- summary: 3–6 sentences a person who missed the meeting reads first: the purpose, what was discussed, and where things landed. Markdown bullets are allowed.',
        '- chapters: the meeting split into consecutive topics, in order. Each has a short title, and startIndex / endIndex: the first and last transcript line it covers. Chapters must not overlap. A short meeting with one topic has one chapter.',
        '- decisions: what the participants explicitly agreed on or concluded. Not proposals still under discussion, not open questions.',
        '- actionItems: concrete follow-ups someone committed to or was asked to do. text starts with a verb and names the deliverable.',
        '- keywords: up to 8 short topic keywords.',
        '',
        'Rules:',
        '- Use only what the transcript says. Never invent a decision, an owner, a deadline or a number. When the transcript is too short or empty of substance, return a one-sentence summary saying so and empty lists.',
        '- Every decision and action item cites in segmentIndexes the line numbers it was taken from (at least one). Cite the lines where it was actually said, not the whole chapter.',
        '- assignee: the person or agent who took the item, as named in the meeting. When the name matches someone in the assignee list, write that list entry exactly. When the speaker of a first-person commitment ("I will…", "我来…") is the recorder or is unlabelled, write the recorder name. Use "" when nobody took the item; never guess.',
        `- dueDate: the deadline as YYYY-MM-DD, resolving relative dates ("next Friday", "下周三", "by end of month") against the meeting date ${meetingDate}. Use "" when no deadline was given.`,
        '- Write every human-facing field in the language the meeting was held in' +
          (language && language !== 'auto' ? ` (${language}).` : '.') +
          ' Keep names, product terms and identifiers as spoken.',
      ].join('\n'),
      role: 'system',
    },
    {
      content: [
        `## Meeting\n${title}\nDate: ${meetingDate}`,
        recorderName ? `Recorder: ${recorderName}` : '',
        assigneeNames.length > 0
          ? `\n## Assignee list\n${assigneeNames.map((name) => `- ${name}`).join('\n')}`
          : '',
        `\n## Transcript\n${transcript.map(formatMeetingTranscriptLine).join('\n')}`,
      ]
        .filter(Boolean)
        .join('\n'),
      role: 'user',
    },
  ],
});
