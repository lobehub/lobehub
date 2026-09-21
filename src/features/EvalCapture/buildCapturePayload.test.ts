import { describe, expect, it } from 'vitest';

import { type CaptureDraft } from './buildCaptureDraft';
import { buildCapturePayload } from './buildCapturePayload';

const draft: CaptureDraft = {
  actualOutput: 'the answer',
  context: [{ content: 'hi', role: 'user' }],
  input: 'the question',
};
const values = { criteria: 'must be right', datasetId: 'ds-1' };

describe('buildCapturePayload', () => {
  // Writing a wrong answer into `expected` would make it the target.
  it('keeps a counter-example out of expected', () => {
    const payload = buildCapturePayload(draft, values, 'negative');
    expect(payload.content.expected).toBeUndefined();
    expect(payload.metadata).toMatchObject({
      capturedOutput: 'the answer',
      capturedOutputKind: 'negative',
    });
  });

  it('promotes a positive example to expected', () => {
    const payload = buildCapturePayload(draft, values, 'positive');
    expect(payload.content.expected).toBe('the answer');
    expect(payload.metadata.capturedOutputKind).toBe('positive');
  });

  it('records the captured answer either way', () => {
    for (const kind of ['negative', 'positive'] as const) {
      expect(buildCapturePayload(draft, values, kind).metadata.capturedOutput).toBe('the answer');
    }
  });

  it('lets a written expected answer win over the captured one', () => {
    const payload = buildCapturePayload(
      draft,
      { ...values, expected: 'a better answer' },
      'positive',
    );
    expect(payload.content.expected).toBe('a better answer');
  });

  it('accepts a written expected answer on a counter-example too', () => {
    const payload = buildCapturePayload(
      draft,
      { ...values, expected: 'what it should say' },
      'negative',
    );
    expect(payload.content.expected).toBe('what it should say');
  });

  it('treats a whitespace-only expected answer as absent', () => {
    const payload = buildCapturePayload(draft, { ...values, expected: '   ' }, 'negative');
    expect(payload.content.expected).toBeUndefined();
  });

  // An empty answer is not an expectation, even when marked positive.
  it('does not promote an empty captured answer', () => {
    const payload = buildCapturePayload({ ...draft, actualOutput: '  ' }, values, 'positive');
    expect(payload.content.expected).toBeUndefined();
  });

  it('carries the context through as indexed messages', () => {
    const payload = buildCapturePayload(draft, values, 'negative');
    expect(payload.content.messages).toEqual([{ content: 'hi', id: 'capture-0', role: 'user' }]);
    expect(payload.content.input).toBe('the question');
  });
});
