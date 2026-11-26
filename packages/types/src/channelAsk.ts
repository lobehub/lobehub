/**
 * Message kinds of a Channel timeline (`channel_messages.kind`), and the `ask` kind: a question
 * an Agent puts to its requester, answered from a card instead of by typing.
 *
 * A kind's payload lives in `metadata` under the kind's own key (`metadata.ask` for `ask`); the
 * contact card keeps its earlier `metadata.card`, and the error card `metadata.replyError`. `content` always holds a plain-text fallback, so
 * a client that does not know a kind, the model's history and search all still read it as text.
 */
export const CHANNEL_MESSAGE_KINDS = [
  'text',
  'contact',
  'ask',
  'error',
  'deviceGrant',
  'agentAccess',
] as const;

/**
 * - `text`: an ordinary message.
 * - `contact`: a person or an Agent shared as a contact card (`metadata.card`).
 * - `ask`: an Agent's question with options (`metadata.ask`).
 * - `error`: a reply that failed, shown as a card in its slot (`metadata.replyError`); the reply
 *   that later succeeds replaces it and its kind.
 * - `deviceGrant`: an Agent's request to use a device (`metadata.deviceGrant`).
 * - `agentAccess`: an Agent asking its owner to let someone use it (`metadata.agentAccess`).
 */
export type ChannelMessageKind = (typeof CHANNEL_MESSAGE_KINDS)[number];

export const CHANNEL_ASK_LIMITS = {
  descriptionLength: 200,
  headerLength: 40,
  labelLength: 80,
  maxOptions: 6,
  maxQuestions: 4,
  minOptions: 2,
  otherLength: 500,
  questionLength: 300,
} as const;

export interface ChannelAskOption {
  description?: string;
  label: string;
}

export interface ChannelAskQuestion {
  /** Short label shown above the question, e.g. "Focus". */
  header?: string;
  /** Several options may be picked. */
  multiSelect?: boolean;
  options: ChannelAskOption[];
  question: string;
}

/** What an Agent asks with `lobe-channel.askUser`, held on its job until the reply publishes. */
export interface ChannelAskInput {
  questions: ChannelAskQuestion[];
}

/** One question's answer: the labels picked, and/or the person's own words for "Other". */
export interface ChannelAskAnswerItem {
  other?: string;
  selected: string[];
}

/** `lobe-channel.askUser`: questions posted with the reply, answered from a card. */
export type ChannelAskUserParams = ChannelAskInput;

export interface ChannelAskedUser {
  questions: number;
  status: 'posts_with_reply';
}

/**
 * - `pending`: waiting for the requester.
 * - `answered`: the requester answered from the card.
 * - `closed`: the run it held moved on without the card's answer (answered in the topic, timed
 *   out, or ended); it can no longer be answered.
 */
export type ChannelAskStatus = 'answered' | 'closed' | 'pending';

/**
 * A question a heterogeneous Agent (Claude Code on a device) asked while its run is blocked on it.
 * The answer goes back to that run instead of waking the Agent with a new request.
 */
export interface ChannelAskIntervention {
  operationId: string;
  toolCallId: string;
}

/** `metadata.ask` of an `ask` message. */
export interface ChannelAsk extends ChannelAskInput {
  answer?: {
    /** One entry per question, in order. */
    answers: ChannelAskAnswerItem[];
    answeredAt: string;
    memberId: string;
    /** The person's message carrying the answer, a reply to the question. */
    messageId?: string;
  };
  /**
   * Characters of `content` the Agent wrote; the rest is the plain-text fallback of the
   * questions, which a client rendering the card does not show again.
   */
  bodyLength: number;
  /** Set when a blocked run asked it: the answer resumes that run. */
  intervention?: ChannelAskIntervention;
  /** The member whose request the Agent was answering: the only one who may answer. */
  requesterMemberId: string;
  status: ChannelAskStatus;
}

const isString = (value: unknown): value is string => typeof value === 'string';

const parseQuestion = (value: unknown): ChannelAskQuestion | undefined => {
  const raw = value as Partial<ChannelAskQuestion> | null;
  if (!raw || !isString(raw.question) || !Array.isArray(raw.options)) return;
  const options = raw.options
    .filter((option): option is ChannelAskOption => isString(option?.label))
    .map(({ description, label }) => ({ label, ...(isString(description) && { description }) }));
  if (!options.length) return;
  return {
    options,
    question: raw.question,
    ...(isString(raw.header) && { header: raw.header }),
    ...(raw.multiSelect === true && { multiSelect: true }),
  };
};

const parseAnswers = (value: unknown): ChannelAskAnswerItem[] | undefined => {
  if (!Array.isArray(value)) return;
  return value.map((item) => ({
    selected: Array.isArray(item?.selected) ? item.selected.filter(isString) : [],
    ...(isString(item?.other) && { other: item.other }),
  }));
};

export const channelMessageAsk = (
  metadata: Record<string, unknown> | null | undefined,
): ChannelAsk | undefined => {
  const raw = metadata?.ask as Partial<ChannelAsk> | undefined;
  if (!raw || !Array.isArray(raw.questions) || !isString(raw.requesterMemberId)) return;
  const questions = raw.questions.map(parseQuestion);
  if (!questions.length || questions.some((question) => !question)) return;
  const answer = raw.answer;
  const answers = parseAnswers(answer?.answers);
  return {
    bodyLength: typeof raw.bodyLength === 'number' && raw.bodyLength >= 0 ? raw.bodyLength : 0,
    questions: questions as ChannelAskQuestion[],
    requesterMemberId: raw.requesterMemberId,
    status: raw.status === 'answered' || raw.status === 'closed' ? raw.status : 'pending',
    ...(isString(raw.intervention?.operationId) &&
      isString(raw.intervention?.toolCallId) && {
        intervention: {
          operationId: raw.intervention.operationId,
          toolCallId: raw.intervention.toolCallId,
        },
      }),
    ...(answer &&
      answers &&
      isString(answer.memberId) &&
      isString(answer.answeredAt) && {
        answer: {
          answeredAt: answer.answeredAt,
          answers,
          memberId: answer.memberId,
          ...(isString(answer.messageId) && { messageId: answer.messageId }),
        },
      }),
  };
};

const optionLetter = (index: number) => String.fromCodePoint(65 + index);

/** The questions as plain text, appended to the Agent's own words in `content`. */
export const channelAskFallbackText = ({ questions }: ChannelAskInput): string =>
  questions
    .map(({ multiSelect, options, question }) =>
      [
        multiSelect ? `${question} (multiple choice)` : question,
        ...options.map(
          (option, index) =>
            `${optionLetter(index)}. ${option.label}${option.description ? ` — ${option.description}` : ''}`,
        ),
      ].join('\n'),
    )
    .join('\n\n');

/**
 * The answer as the person's message: readable to everyone, and to the Agent it wakes. One line
 * per question; several questions are each prefixed with their question.
 */
export const channelAskAnswerText = (
  { questions }: ChannelAskInput,
  answers: ChannelAskAnswerItem[],
): string =>
  questions
    .map((question, index) => {
      const { other, selected } = answers[index] ?? { selected: [] };
      const picked = selected.map((label) => {
        const at = question.options.findIndex((option) => option.label === label);
        return at < 0 ? label : `${optionLetter(at)}. ${label}`;
      });
      const parts = [...picked, ...(other?.trim() ? [other.trim()] : [])];
      const value = parts.join('; ');
      return questions.length > 1 ? `${question.question}\n${value}` : value;
    })
    .join('\n\n');

/**
 * The answer in the shape a blocked heterogeneous run reads from its question card: each
 * question's text maps to its pick (an array for multiple choice), the person's own words taking
 * the place of a pick or joining the picked ones.
 */
export const channelAskInterventionResult = (
  { questions }: ChannelAskInput,
  answers: ChannelAskAnswerItem[],
): Record<string, string | string[]> =>
  Object.fromEntries(
    questions.map((question, index) => {
      const { other, selected } = answers[index] ?? { selected: [] };
      const picked = [...selected, ...(other?.trim() ? [other.trim()] : [])];
      return [question.question, question.multiSelect ? picked : (picked[0] ?? '')];
    }),
  );

/**
 * Checks an answer against its questions: picked labels must be options, a single-choice
 * question takes one pick or the person's own words, and every question needs something.
 */
export const validateChannelAskAnswers = (
  { questions }: ChannelAskInput,
  answers: ChannelAskAnswerItem[],
): string | undefined => {
  if (answers.length !== questions.length) return 'Answer every question';
  for (const [index, question] of questions.entries()) {
    const { other, selected } = answers[index];
    const labels = new Set(question.options.map((option) => option.label));
    if (new Set(selected).size !== selected.length || selected.some((label) => !labels.has(label)))
      return `Question ${index + 1}: pick from its options`;
    const words = other?.trim() ?? '';
    if (words.length > CHANNEL_ASK_LIMITS.otherLength)
      return `Question ${index + 1}: at most ${CHANNEL_ASK_LIMITS.otherLength} characters`;
    const count = selected.length + (words ? 1 : 0);
    if (!count) return `Question ${index + 1} has no answer`;
    if (!question.multiSelect && count > 1) return `Question ${index + 1} takes one answer`;
  }
};

const bounded = (value: unknown, what: string, max: number, optional = false) => {
  const text = isString(value) ? value.trim() : '';
  if (!text) {
    if (optional) return;
    throw new Error(`${what} is required`);
  }
  if (text.length > max) throw new Error(`${what} must be at most ${max} characters`);
  return text;
};

/** Trims and checks what an Agent asks; throws with a message the Agent can correct. */
export const normalizeChannelAskInput = (input: unknown): ChannelAskInput => {
  const raw = (input as Partial<ChannelAskInput> | null)?.questions;
  const { maxOptions, maxQuestions, minOptions } = CHANNEL_ASK_LIMITS;
  if (!Array.isArray(raw) || !raw.length || raw.length > maxQuestions)
    throw new Error(`Ask between 1 and ${maxQuestions} questions`);
  return {
    questions: raw.map((question, index) => {
      const what = `Question ${index + 1}`;
      const options = Array.isArray(question?.options) ? question.options : [];
      if (options.length < minOptions || options.length > maxOptions)
        throw new Error(`${what} needs between ${minOptions} and ${maxOptions} options`);
      const normalized = options.map((option: Partial<ChannelAskOption>, at: number) => {
        const description = bounded(
          option?.description,
          `${what} option ${at + 1} description`,
          CHANNEL_ASK_LIMITS.descriptionLength,
          true,
        );
        return {
          label: bounded(
            option?.label,
            `${what} option ${at + 1}`,
            CHANNEL_ASK_LIMITS.labelLength,
          )!,
          ...(description && { description }),
        };
      });
      if (
        new Set(normalized.map((option: ChannelAskOption) => option.label)).size !== options.length
      )
        throw new Error(`${what} has duplicate options`);
      const header = bounded(
        question?.header,
        `${what} header`,
        CHANNEL_ASK_LIMITS.headerLength,
        true,
      );
      return {
        options: normalized,
        question: bounded(question?.question, what, CHANNEL_ASK_LIMITS.questionLength)!,
        ...(header && { header }),
        ...(question?.multiSelect === true && { multiSelect: true }),
      };
    }),
  };
};
