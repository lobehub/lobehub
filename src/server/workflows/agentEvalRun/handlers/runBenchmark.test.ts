import type { WorkflowContext } from '@upstash/workflow';
import { describe, expect, it, vi } from 'vitest';

import type { RunBenchmarkPayload } from '@/server/workflows/agentEvalRun';

import { runBenchmarkWorkflowHandler } from './runBenchmark';

describe('runBenchmarkWorkflowHandler', () => {
  it('returns a validation error before side effects when payload is missing', async () => {
    const run = vi.fn();
    const context = {
      requestPayload: undefined,
      run,
    } as unknown as WorkflowContext<RunBenchmarkPayload>;

    await expect(runBenchmarkWorkflowHandler(context)).resolves.toEqual({
      error: 'Missing runId or userId in payload',
      success: false,
    });
    expect(run).not.toHaveBeenCalled();
  });
});
