import { describe, expect, it } from 'vitest';

import { UserInteractionExecutionRuntime } from './index';

const sampleArgs = {
  questions: [
    {
      header: 'Scope',
      options: [
        { description: 'Only the current file', label: 'This file' },
        { description: 'The entire project', label: 'Whole project' },
      ],
      question: 'Which scope should I apply the change to?',
    },
  ],
};

describe('UserInteractionExecutionRuntime', () => {
  it('creates a pending interaction request storing the questions', async () => {
    const runtime = new UserInteractionExecutionRuntime();
    const result = await runtime.askUserQuestion(sampleArgs);

    expect(result.success).toBe(true);
    expect(result.state.status).toBe('pending');
    expect(typeof result.state.requestId).toBe('string');
    expect(result.state.question).toEqual(sampleArgs);
  });

  it('rejects invalid args (fewer than 2 options)', async () => {
    const runtime = new UserInteractionExecutionRuntime();
    const result = await runtime.askUserQuestion({
      questions: [
        {
          header: 'Scope',
          options: [{ description: 'Only the current file', label: 'This file' }],
          question: 'Which scope?',
        },
      ],
    });

    expect(result.success).toBe(false);
  });

  it('marks interaction as submitted with response', async () => {
    const runtime = new UserInteractionExecutionRuntime();
    const created = await runtime.askUserQuestion(sampleArgs);
    const { requestId } = created.state;

    const result = await runtime.submitUserResponse({
      requestId,
      response: { [sampleArgs.questions[0].question]: 'This file' },
    });

    expect(result.success).toBe(true);
    expect(result.state).toMatchObject({
      requestId,
      response: { [sampleArgs.questions[0].question]: 'This file' },
      status: 'submitted',
    });
  });

  it('marks interaction as skipped with reason', async () => {
    const runtime = new UserInteractionExecutionRuntime();
    const created = await runtime.askUserQuestion(sampleArgs);
    const { requestId } = created.state;

    const result = await runtime.skipUserResponse({ reason: 'Not relevant', requestId });

    expect(result.success).toBe(true);
    expect(result.state).toMatchObject({
      requestId,
      skipReason: 'Not relevant',
      status: 'skipped',
    });
  });

  it('marks interaction as cancelled', async () => {
    const runtime = new UserInteractionExecutionRuntime();
    const created = await runtime.askUserQuestion(sampleArgs);
    const { requestId } = created.state;

    const result = await runtime.cancelUserResponse({ requestId });

    expect(result.success).toBe(true);
    expect(result.state).toMatchObject({ requestId, status: 'cancelled' });
  });

  it('gets current interaction state', async () => {
    const runtime = new UserInteractionExecutionRuntime();
    const created = await runtime.askUserQuestion(sampleArgs);
    const { requestId } = created.state;

    const result = await runtime.getInteractionState({ requestId });

    expect(result.success).toBe(true);
    expect(result.state).toMatchObject({ requestId, status: 'pending' });
  });

  it('returns error for non-existent interaction', async () => {
    const runtime = new UserInteractionExecutionRuntime();
    const result = await runtime.getInteractionState({ requestId: 'nonexistent' });

    expect(result.success).toBe(false);
  });

  it('prevents submitting a non-pending interaction', async () => {
    const runtime = new UserInteractionExecutionRuntime();
    const created = await runtime.askUserQuestion(sampleArgs);
    const { requestId } = created.state;
    await runtime.cancelUserResponse({ requestId });

    const result = await runtime.submitUserResponse({ requestId, response: { late: true } });

    expect(result.success).toBe(false);
  });
});
