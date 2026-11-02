import { RequestTrigger } from '@lobechat/types';
import { describe, expect, it, vi } from 'vitest';

import { forceQuickNoteSubmission, QuickNoteSubmissionError } from './submission';

const valid = { contextQueries: [], relatedResources: [], summary: 'Useful', tags: ['speech'] };

const run = (generateObject: (...args: any[]) => Promise<any>) =>
  forceQuickNoteSubmission({
    generator: { generateObject },
    instructions: 'INSTRUCTIONS',
    model: 'deepseek-chat',
    provider: 'deepseek',
    tracing: { scenario: 'quick_note_submit' },
    transcript: '[user]\nnote',
    trigger: RequestTrigger.QuickNote,
  });

describe('forceQuickNoteSubmission', () => {
  it('forces the submitResult tool and returns its arguments', async () => {
    const generateObject = vi
      .fn()
      .mockResolvedValue([{ arguments: JSON.stringify(valid), name: 'submitResult' }]);

    await expect(run(generateObject)).resolves.toEqual(valid);

    const [input, options] = generateObject.mock.calls[0];
    expect(input.tools).toEqual([
      expect.objectContaining({ function: expect.objectContaining({ name: 'submitResult' }) }),
    ]);
    expect(input.schema).toBeUndefined();
    expect(input.messages[0]).toEqual({ content: 'INSTRUCTIONS', role: 'system' });
    expect(input.messages[1].content).toContain('<run_transcript>\n[user]\nnote');
    expect(options.metadata).toEqual({ trigger: RequestTrigger.QuickNote });
  });

  it('falls back to JSON schema when the route cannot force a tool call', async () => {
    const generateObject = vi
      .fn()
      .mockRejectedValueOnce({ errorType: 'CapabilityNotSupported' })
      .mockResolvedValueOnce(valid);

    await expect(run(generateObject)).resolves.toEqual(valid);
    expect(generateObject.mock.calls[1][0].schema).toMatchObject({ name: 'submitResult' });
  });

  it('falls back to JSON schema when the model skips the forced call', async () => {
    const generateObject = vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce(valid);

    await expect(run(generateObject)).resolves.toEqual(valid);
    expect(generateObject).toHaveBeenCalledTimes(2);
  });

  it('retries invalid arguments once', async () => {
    const generateObject = vi
      .fn()
      .mockResolvedValueOnce([{ arguments: '{"summary":""}', name: 'submitResult' }])
      .mockResolvedValueOnce([{ arguments: valid, name: 'submitResult' }]);

    await expect(run(generateObject)).resolves.toEqual(valid);
    expect(generateObject).toHaveBeenCalledTimes(2);
  });

  it('throws a submission error when the retry is still invalid', async () => {
    const generateObject = vi
      .fn()
      .mockResolvedValue([{ arguments: '{"tags":[]}', name: 'submitResult' }]);

    await expect(run(generateObject)).rejects.toBeInstanceOf(QuickNoteSubmissionError);
    expect(generateObject).toHaveBeenCalledTimes(2);
  });

  it('propagates provider failures without another call', async () => {
    const generateObject = vi.fn().mockRejectedValue({ errorType: 'InsufficientQuota' });

    await expect(run(generateObject)).rejects.toEqual({ errorType: 'InsufficientQuota' });
    expect(generateObject).toHaveBeenCalledTimes(1);
  });
});
