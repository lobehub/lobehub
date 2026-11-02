import { describe, expect, it, vi } from 'vitest';

import { ActivatorExecutionRuntime, type ActivatorRuntimeService } from '.';

const toolInfo = (overrides: Record<string, unknown> = {}) => ({
  apiDescriptions: [{ description: 'Run release', name: 'run' }],
  capability: {
    hash: 'md5:bundle',
    identifier: 'release-tool',
    version: 'atomic-1',
  },
  capabilitySummary: 'Run release operations',
  executionEnvironment: 'server' as const,
  identifier: 'release-tool',
  manual: '<tool_manual>Full untruncated native contract</tool_manual>',
  name: 'Release Tool',
  source: 'builtin' as const,
  ...overrides,
});

const createService = (
  data: Awaited<ReturnType<ActivatorRuntimeService['getToolManifests']>>,
  onDemand = true,
): ActivatorRuntimeService => ({
  getActivatedToolIds: () => [],
  getToolManifests: vi.fn().mockResolvedValue(data),
  isOnDemand: () => onDemand,
  markActivated: vi.fn(),
});

describe('ActivatorExecutionRuntime on-demand activation', () => {
  it('returns card metadata and appends the complete atomic manual', async () => {
    const service = createService([toolInfo()]);
    const runtime = new ActivatorExecutionRuntime({ service });

    const result = await runtime.activateTools({
      identifiers: ['release-tool'],
      reason: 'test',
    });

    expect(result.success).toBe(true);
    expect(result.content).toContain('<tool_manual>Full untruncated native contract</tool_manual>');
    expect(result.state).toMatchObject({
      activatedTools: [
        {
          capability: {
            hash: 'md5:bundle',
            identifier: 'release-tool',
            version: 'atomic-1',
          },
          capabilitySummary: 'Run release operations',
          executionEnvironment: 'server',
          identifier: 'release-tool',
          name: 'Release Tool',
          source: 'builtin',
        },
      ],
      notFound: [],
    });
    expect(service.markActivated).toHaveBeenCalledWith(['release-tool']);
  });

  it('fails closed and exposes the failure state when on-demand cannot load a bundle', async () => {
    const service = createService([]);
    const runtime = new ActivatorExecutionRuntime({ service });

    const result = await runtime.activateTools({ identifiers: ['missing-tool'], reason: 'test' });

    expect(result.success).toBe(false);
    expect(result.content).toContain('Not found: missing-tool');
    expect(result.state).toMatchObject({
      activatedTools: [],
      notFound: ['missing-tool'],
    });
    expect(service.markActivated).not.toHaveBeenCalled();
  });

  it('keeps the legacy activation result terse when the runtime is not on-demand', async () => {
    const service = createService(
      [
        toolInfo({
          capability: undefined,
          capabilitySummary: undefined,
          executionEnvironment: undefined,
          source: undefined,
        }),
      ],
      false,
    );
    const runtime = new ActivatorExecutionRuntime({ service });

    const result = await runtime.activateTools({
      identifiers: ['release-tool'],
      reason: 'test',
    });

    expect(result.success).toBe(true);
    expect(result.content).toContain(
      'Usage instructions for the activated items are in the system prompt.',
    );
    expect(result.content).not.toContain('<tool_manual>');
  });
});
