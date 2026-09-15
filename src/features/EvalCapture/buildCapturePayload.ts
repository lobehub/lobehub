import { type CaptureDraft } from './buildCaptureDraft';

/**
 * What the captured answer is being kept as.
 *
 * A capture is not always a complaint: the same gesture is used to keep an
 * answer that was right, and the two mean opposite things to a judge. A
 * counter-example must stay out of `expected` — writing a wrong answer there
 * makes it the target — while a positive example *is* the expected answer.
 */
export type CapturedOutputKind = 'negative' | 'positive';

export interface CaptureFormValues {
  criteria: string;
  datasetId: string;
  expected?: string;
}

export interface CapturePayload {
  content: {
    expected?: string;
    input: string;
    messages: Array<{ content: string; id: string; role: 'assistant' | 'user' }>;
  };
  datasetId: string;
  evalConfig: { criteria: string };
  evalMode: 'llm-rubric';
  metadata: {
    capturedOutput: string;
    capturedOutputKind: CapturedOutputKind;
    source: string;
  };
}

/**
 * The captured answer is recorded either way — it is where the case came from —
 * but only a positive one is allowed to stand in as the expected output, and
 * only when the author did not write a different one.
 */
export const buildCapturePayload = (
  draft: CaptureDraft,
  values: CaptureFormValues,
  kind: CapturedOutputKind,
): CapturePayload => {
  const typedExpected = values.expected?.trim();
  const expected =
    typedExpected || (kind === 'positive' ? draft.actualOutput.trim() || undefined : undefined);

  return {
    content: {
      expected,
      input: draft.input,
      messages: draft.context.map((message, index) => ({
        content: message.content,
        id: `capture-${index}`,
        role: message.role as 'assistant' | 'user',
      })),
    },
    datasetId: values.datasetId,
    evalConfig: { criteria: values.criteria },
    evalMode: 'llm-rubric',
    metadata: {
      capturedOutput: draft.actualOutput,
      capturedOutputKind: kind,
      source: 'conversation-capture',
    },
  };
};
