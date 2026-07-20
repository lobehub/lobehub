// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createWorkflow: vi.fn((routeFunction: unknown, options: unknown) => ({ options, routeFunction })),
  metricUrls: [] as string[],
  qstashClient: {},
  serveMany: vi.fn(),
}));

vi.mock('@lobechat/observability-otel/modules/upstash-workflow', () => ({
  withOtelMetricsForUpstashWorkflows: (handler: unknown, options: { url: string }) => {
    mocks.metricUrls.push(options.url);
    return handler;
  },
}));
vi.mock('@upstash/workflow/hono', () => ({
  createWorkflow: mocks.createWorkflow,
  serveMany: mocks.serveMany,
}));
vi.mock('@/server/workflows/onboardingUnderstanding/processCollected', () => ({
  processCollectedUnderstanding: vi.fn(),
  processCollectedWorkflowOptions: { retries: 2 },
}));
vi.mock('@/server/workflows/onboardingUnderstanding/processProviders', () => ({
  processUnderstandingProviders: vi.fn(),
  processProvidersWorkflowOptions: { retries: 3 },
}));
vi.mock('../qstashClient', () => ({
  createWorkflowQstashClient: vi.fn(() => mocks.qstashClient),
}));

describe('onboarding understanding workflows', () => {
  beforeEach(() => {
    mocks.createWorkflow.mockClear();
    mocks.metricUrls.length = 0;
    mocks.serveMany.mockReset();
    mocks.serveMany.mockImplementation(
      (workflows, options) => async (context: any) =>
        context.json({ keys: Object.keys(workflows), options }),
    );
  });

  it('serves exactly two sibling invokable workflows from one static route', async () => {
    vi.resetModules();
    const { default: app } = await import('.');

    const response = await app.request('/process-providers', { method: 'POST' });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      keys: ['process-providers', 'process-collected'],
      options: { qstashClient: {} },
    });
    expect(mocks.serveMany).toHaveBeenCalledOnce();
    expect(mocks.createWorkflow).toHaveBeenCalledTimes(2);
    expect(mocks.metricUrls).toEqual([
      '/api/workflows/onboarding-understanding/process-collected',
      '/api/workflows/onboarding-understanding/process-providers',
    ]);
  });

  it('does not expose the removed dynamic session route', async () => {
    vi.resetModules();
    const { default: app } = await import('.');

    const response = await app.request('/session-1/extra', { method: 'POST' });

    expect(response.status).toBe(404);
  });
});
