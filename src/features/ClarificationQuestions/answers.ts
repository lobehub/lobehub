import {
  type AskUserDraft,
  type AskUserQuestionArgs,
  buildSubmitPayload,
  FREEFORM_PAYLOAD_KEY,
  SUPPLEMENT_PAYLOAD_KEY,
} from '@lobechat/shared-tool-ui/ask-user';

/**
 * A question the product asks on its own behalf — not a tool call — rendered
 * with the same AskUserQuestion form the conversation uses.
 */
export interface ClarificationQuestion {
  /** Why the answer matters; shown under the question. */
  description?: string;
  /** Short tab label. */
  header: string;
  /** Host-owned identity, echoed back on the answer. */
  id: string;
  /** Option ids are submitted as-is, so a host never maps labels back. */
  options: { description?: string; id: string; label: string }[];
  question: string;
}

export type ClarificationAnswer =
  | {
      /** The optional notes box, attached to every picked option. */
      note?: string;
      optionId: string;
      questionId: string;
      type: 'option';
    }
  | { questionId: string; text: string; type: 'text' };

/**
 * The text each question is keyed by inside the form. The form keys answers by
 * question text, so two questions worded the same would share one answer; a
 * repeat gets a counter to keep every key — and every answer — its own.
 */
const formQuestionTexts = (questions: ClarificationQuestion[]): string[] => {
  const seen = new Map<string, number>();
  return questions.map(({ question }) => {
    const count = (seen.get(question) ?? 0) + 1;
    seen.set(question, count);
    return count === 1 ? question : `${question} (${count})`;
  });
};

export const toAskUserArgs = (questions: ClarificationQuestion[]): AskUserQuestionArgs => {
  const texts = formQuestionTexts(questions);
  return {
    questions: questions.map(({ description, header, options }, index) => ({
      ...(description ? { description } : {}),
      header,
      options,
      question: texts[index],
    })),
  };
};

/**
 * Read the form's submit payload back as one answer per question.
 *
 * The payload is keyed by question text and holds either a picked option id or
 * the user's own words; the whole-form "type directly" box answers every
 * question with the same text.
 */
export const toClarificationAnswers = (
  questions: ClarificationQuestion[],
  payload: Record<string, unknown>,
): ClarificationAnswer[] => {
  const freeform = payload[FREEFORM_PAYLOAD_KEY];
  if (typeof freeform === 'string' && freeform.trim()) {
    return questions.map((q) => ({ questionId: q.id, text: freeform.trim(), type: 'text' }));
  }

  const note =
    typeof payload[SUPPLEMENT_PAYLOAD_KEY] === 'string'
      ? (payload[SUPPLEMENT_PAYLOAD_KEY] as string).trim() || undefined
      : undefined;

  const texts = formQuestionTexts(questions);
  return questions.flatMap((q, index): ClarificationAnswer[] => {
    const value = payload[texts[index]];
    if (typeof value !== 'string' || !value.trim()) return [];
    if (q.options.some((option) => option.id === value)) {
      return [{ note, optionId: value, questionId: q.id, type: 'option' }];
    }
    return [
      { questionId: q.id, text: note ? `${value.trim()}\n${note}` : value.trim(), type: 'text' },
    ];
  });
};

/** The answers a draft would submit right now — for hosts that mirror progress. */
export const draftToClarificationAnswers = (
  questions: ClarificationQuestion[],
  draft: AskUserDraft,
): ClarificationAnswer[] => {
  const args = toAskUserArgs(questions).questions;
  const payload: Record<string, unknown> = buildSubmitPayload(args, draft.picks, draft.custom);
  if (draft.supplementText.trim()) payload[SUPPLEMENT_PAYLOAD_KEY] = draft.supplementText.trim();
  return toClarificationAnswers(questions, payload);
};
