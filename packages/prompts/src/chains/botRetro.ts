import type { OpenAIChatMessage } from '@lobechat/types';

interface BotRetroGenerateObjectSchema {
  name: string;
  schema: {
    additionalProperties: false;
    properties: Record<string, unknown>;
    required: string[];
    type: 'object';
  };
}

export const BOT_RETRO_PROMPT_VERSION = 'v1';

/**
 * A bot agent's nightly retro over one day of platform conversations: what got in the way, split
 * into the platform's problems (already vented, or not) and the agent's own mistakes, plus the
 * merged list of lessons it keeps in front of itself from now on.
 */
export const BOT_RETRO_JSON_SCHEMA = {
  name: 'bot_retro',
  schema: {
    additionalProperties: false,
    properties: {
      lessons: {
        items: { maxLength: 200, type: 'string' },
        maxItems: 15,
        type: 'array',
      },
      platformIssues: {
        items: {
          additionalProperties: false,
          properties: {
            detail: { maxLength: 400, type: 'string' },
            title: { maxLength: 120, type: 'string' },
            ventId: { type: ['string', 'null'] },
          },
          required: ['detail', 'title', 'ventId'],
          type: 'object',
        },
        maxItems: 10,
        type: 'array',
      },
      selfMistakes: {
        items: {
          additionalProperties: false,
          properties: {
            lesson: { maxLength: 200, type: 'string' },
            topicId: { type: ['string', 'null'] },
            what: { maxLength: 400, type: 'string' },
          },
          required: ['lesson', 'topicId', 'what'],
          type: 'object',
        },
        maxItems: 10,
        type: 'array',
      },
      summary: { maxLength: 400, type: 'string' },
    },
    required: ['lessons', 'platformIssues', 'selfMistakes', 'summary'],
    type: 'object',
  },
} as const satisfies BotRetroGenerateObjectSchema;

const BOT_RETRO_SYSTEM_PROMPT = `You are an AI agent that answers people on chat platforms (Discord, Slack, Telegram, …) as a bot. It is the end of your day. Look back over what happened in your bot conversations and reflect honestly, the way a careful professional writes a short private retro.

Sort every problem into exactly one of two kinds:
- platformIssues: the platform got in your way — a tool was missing or broken, a schema disagreed with its docs, an environment or network limit, a provider error you could not have avoided. If one of the vents you filed covers it, set ventId to that vent's id; otherwise ventId is null. List each vent you filed that still stands as an issue, even if the conversation evidence about it is thin.
- selfMistakes: you could have done better — you replied when you were not addressed, stayed silent when you were, misread the thread, called a tool with wrong arguments, gave a wrong or careless answer, retried the same failing call instead of changing approach, or ignored an instruction. "what" says what happened, concretely; "lesson" is the habit that would have prevented it, as one imperative sentence. topicId is the conversation it happened in, when there is one.

Owner marks are the strongest evidence: the person who runs you said a wake was wrong (false_wake: you should not have replied; missed_wake: you should have; bad_reply: your reply was poor). Each owner mark is your mistake unless the evidence clearly shows the platform caused it.

Do not blame the platform for your own mistakes, and do not take the blame for the platform's. Never invent problems: an ordinary day with nothing wrong gets empty lists and a one-line summary.

lessons is the complete list you will keep in front of you from tomorrow on: start from your existing lessons, add the new ones, merge duplicates, rewrite a lesson when today showed it was incomplete, and drop one only when it is clearly obsolete. Keep it at 15 or fewer, most important first. Each lesson must be general enough to apply to future conversations — no user names, server names or one-off details.

summary is one or two sentences on how the day went.

Never copy secrets, credentials or other people's private details into any field. Write every field in the language most of the conversations use; if unclear, use the language of your existing lessons.`;

export interface BotRetroTopicInput {
  assistantMessageCount: number;
  failedMessages: string[];
  failedToolCalls: {
    apiName: string | null;
    errorSummary: string | null;
    identifier: string | null;
  }[];
  messageCount: number;
  platform: string | null;
  summary: string;
  title: string | null;
  topicId: string;
}

export interface BotRetroVentInput {
  category?: string;
  details?: string;
  id: string;
  recorded: boolean;
  severity?: string;
  summary?: string;
  topicId: string | null;
}

export interface BotRetroWakeMarkInput {
  label: string;
  outcome: string;
  reason: string | null;
  topicId: string | null;
}

export interface BotRetroChainInput {
  agent: { description?: string | null; title?: string | null };
  date: string;
  lessons: string[];
  topics: BotRetroTopicInput[];
  vents: BotRetroVentInput[];
  wakeMarks: BotRetroWakeMarkInput[];
}

const formatList = <T>(items: T[], empty: string, format: (item: T) => string) =>
  items.length > 0 ? items.map(format).join('\n') : empty;

const formatTopic = (topic: BotRetroTopicInput) => {
  const lines = [
    `- topicId ${topic.topicId} · ${topic.platform ?? 'bot'} · ${topic.title || 'untitled'} · ${topic.messageCount} messages, ${topic.assistantMessageCount} of them yours`,
  ];
  if (topic.summary.trim()) lines.push(`  summary: ${topic.summary.trim()}`);
  for (const call of topic.failedToolCalls) {
    lines.push(
      `  failed tool ${call.identifier ?? '?'}/${call.apiName ?? '?'}: ${call.errorSummary ?? ''}`,
    );
  }
  for (const error of topic.failedMessages) lines.push(`  failed reply: ${error}`);
  return lines.join('\n');
};

export const chainBotRetro = (input: BotRetroChainInput): { messages: OpenAIChatMessage[] } => ({
  messages: [
    { content: BOT_RETRO_SYSTEM_PROMPT, role: 'system' },
    {
      content: [
        `You are ${input.agent.title || 'an assistant'}${input.agent.description ? ` — ${input.agent.description}` : ''}. Day under review: ${input.date}.`,
        `Your existing lessons:\n${formatList(input.lessons, '(none yet)', (lesson) => `- ${lesson}`)}`,
        `Bot conversations today:\n${formatList(input.topics, '(none)', formatTopic)}`,
        `Vents you filed today:\n${formatList(
          input.vents,
          '(none)',
          (vent) =>
            `- ventId ${vent.id} · ${vent.category ?? 'other'}/${vent.severity ?? '?'}${vent.recorded ? '' : ' · rejected by the runtime as a repeat'} · topicId ${vent.topicId ?? '-'}: ${vent.summary ?? ''}${vent.details ? ` — ${vent.details}` : ''}`,
        )}`,
        `Owner marks on your wake decisions today:\n${formatList(
          input.wakeMarks,
          '(none)',
          (mark) =>
            `- ${mark.label} (you ${mark.outcome === 'skip' ? 'stayed silent' : 'woke'}) · topicId ${mark.topicId ?? '-'}${mark.reason ? `: ${mark.reason}` : ''}`,
        )}`,
      ].join('\n\n'),
      role: 'user',
    },
  ],
});
