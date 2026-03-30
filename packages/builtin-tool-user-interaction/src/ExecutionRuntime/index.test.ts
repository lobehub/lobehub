import { describe, expect, it } from 'vitest';

import { UserInteractionExecutionRuntime } from './index';

describe('UserInteractionExecutionRuntime', () => {
  it('creates a pending interaction request', async () => {
    const runtime = new UserInteractionExecutionRuntime();
    const result = await runtime.askUserQuestion({
      question: { id: 'q1', mode: 'freeform', prompt: 'What is your name?' },
    });

    expect(result.success).toBe(true);
    expect(result.state).toMatchObject({
      requestId: 'q1',
      status: 'pending',
      question: { id: 'q1', mode: 'freeform', prompt: 'What is your name?' },
    });
  });

  it('marks interaction as submitted with response', async () => {
    const runtime = new UserInteractionExecutionRuntime();
    await runtime.askUserQuestion({
      question: {
        fields: [{ key: 'name', kind: 'text' as const, label: 'Name', required: true }],
        id: 'q2',
        mode: 'form' as const,
        prompt: 'Fill this form',
      },
    });

    const result = await runtime.submitUserResponse({
      requestId: 'q2',
      response: { name: 'Alice' },
    });

    expect(result.success).toBe(true);
    expect(result.state).toMatchObject({
      requestId: 'q2',
      status: 'submitted',
      response: { name: 'Alice' },
    });
  });

  it('marks interaction as skipped with reason', async () => {
    const runtime = new UserInteractionExecutionRuntime();
    await runtime.askUserQuestion({
      question: { id: 'q3', mode: 'freeform', prompt: 'Optional question' },
    });

    const result = await runtime.skipUserResponse({
      requestId: 'q3',
      reason: 'Not relevant',
    });

    expect(result.success).toBe(true);
    expect(result.state).toMatchObject({
      requestId: 'q3',
      status: 'skipped',
      skipReason: 'Not relevant',
    });
  });

  it('marks interaction as cancelled', async () => {
    const runtime = new UserInteractionExecutionRuntime();
    await runtime.askUserQuestion({
      question: { id: 'q4', mode: 'freeform', prompt: 'Will be cancelled' },
    });

    const result = await runtime.cancelUserResponse({ requestId: 'q4' });

    expect(result.success).toBe(true);
    expect(result.state).toMatchObject({
      requestId: 'q4',
      status: 'cancelled',
    });
  });

  it('gets current interaction state', async () => {
    const runtime = new UserInteractionExecutionRuntime();
    await runtime.askUserQuestion({
      question: { id: 'q5', mode: 'freeform', prompt: 'Check state' },
    });

    const result = await runtime.getInteractionState({ requestId: 'q5' });

    expect(result.success).toBe(true);
    expect(result.state).toMatchObject({
      requestId: 'q5',
      status: 'pending',
    });
  });

  it('returns error for non-existent interaction', async () => {
    const runtime = new UserInteractionExecutionRuntime();
    const result = await runtime.getInteractionState({ requestId: 'nonexistent' });

    expect(result.success).toBe(false);
  });

  it('prevents submitting a non-pending interaction', async () => {
    const runtime = new UserInteractionExecutionRuntime();
    await runtime.askUserQuestion({
      question: { id: 'q6', mode: 'freeform', prompt: 'Already done' },
    });
    await runtime.cancelUserResponse({ requestId: 'q6' });

    const result = await runtime.submitUserResponse({
      requestId: 'q6',
      response: { late: true },
    });

    expect(result.success).toBe(false);
  });
});
