import { describe, expect, it, vi } from 'vitest';

import { getHeterogeneousAgentDriver } from '../index';
import type {
  HeterogeneousAgentBuildPlanHelpers,
  HeterogeneousAgentBuildPlanParams,
} from '../types';
import { qoderDriver } from './qoder';

const buildAgentInput = vi.fn(async () => ({
  args: ['--attachment', '/tmp/image.png'],
  stdin: '{"type":"user"}\n',
}));
const helpers: HeterogeneousAgentBuildPlanHelpers = { buildAgentInput };

const buildParams = (
  overrides: Partial<HeterogeneousAgentBuildPlanParams> = {},
): HeterogeneousAgentBuildPlanParams => ({
  args: [],
  helpers,
  promptInput: 'raw prompt',
  ...overrides,
});

describe('qoderDriver', () => {
  it('is registered and composes protocol, MCP, resume, custom, and attachment args', async () => {
    expect(getHeterogeneousAgentDriver('qoder')).toBe(qoderDriver);

    const plan = await qoderDriver.buildSpawnPlan(
      buildParams({
        args: ['--verbose'],
        mcpConfigPath: '/tmp/lobe-qoder-mcp.json',
        resumeSessionId: 'qoder-session-1',
      }),
    );

    expect(buildAgentInput).toHaveBeenCalledWith('qoder', 'raw prompt');
    expect(plan).toEqual({
      args: [
        '-p',
        '--input-format',
        'stream-json',
        '--output-format',
        'stream-json',
        '--include-partial-messages',
        '--permission-mode',
        'bypass_permissions',
        '--resume',
        'qoder-session-1',
        '--mcp-config',
        '/tmp/lobe-qoder-mcp.json',
        '--verbose',
        '--attachment',
        '/tmp/image.png',
      ],
      stdinPayload: '{"type":"user"}\n',
    });
  });
});
