import type { WorkflowContext } from '@upstash/workflow';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ExecuteTopicAutoSummaryPayload } from '@/server/workflows/topicAutoSummary';

import { executeTopicAutoSummary } from './execute';

const mocks = vi.hoisted(() => ({ analyze: vi.fn(), summarize: vi.fn() }));

vi.mock('@/database/server', () => ({ getServerDB: vi.fn(async () => ({})) }));
vi.mock('@/server/services/topicAutoSummary', () => ({
  TopicAutoSummaryService: class {
    analyze = mocks.analyze;
    summarize = mocks.summarize;
  },
}));

const createContext = () => {
  const steps: string[] = [];
  const context = {
    requestPayload: { topicId: 'topic-1', userId: 'user-1' },
    run: vi.fn(async (name: string, fn: () => Promise<unknown>) => {
      steps.push(name);
      return fn();
    }),
  } as unknown as WorkflowContext<ExecuteTopicAutoSummaryPayload>;
  return { context, steps };
};

describe('executeTopicAutoSummary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.summarize.mockResolvedValue({ summarized: true });
    mocks.analyze.mockResolvedValue({ analyzed: true });
  });

  it('analyzes in its own step after a successful summary', async () => {
    const { context, steps } = createContext();

    const result = await executeTopicAutoSummary(context);

    expect(steps).toEqual(['topic-auto-summary:generate-and-save', 'topic-auto-summary:analyze']);
    expect(result).toEqual({ analysis: { analyzed: true }, summarized: true });
  });

  it('does not analyze when no summary was written', async () => {
    mocks.summarize.mockResolvedValue({ reason: 'stale', summarized: false });
    const { context, steps } = createContext();

    const result = await executeTopicAutoSummary(context);

    expect(steps).toEqual(['topic-auto-summary:generate-and-save']);
    expect(result).toEqual({ reason: 'stale', summarized: false });
    expect(mocks.analyze).not.toHaveBeenCalled();
  });
});
