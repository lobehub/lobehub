import { describe, expect, it, vi } from 'vitest';

import type {
  HeterogeneousAgentBuildPlanHelpers,
  HeterogeneousAgentBuildPlanParams,
} from '../types';
import { codeBuddyDriver } from './codeBuddy';

const buildAgentInput = vi.fn(async () => ({
  args: [],
  stdin: '{"type":"user","message":{}}\n',
}));
const helpers: HeterogeneousAgentBuildPlanHelpers = { buildAgentInput };
const buildParams = (
  overrides: Partial<HeterogeneousAgentBuildPlanParams> = {},
): HeterogeneousAgentBuildPlanParams => ({
  args: [],
  helpers,
  promptInput: 'hi',
  ...overrides,
});

describe('codeBuddyDriver', () => {
  it('builds a CodeBuddy stream-json plan with resume and optional MCP config', async () => {
    const plan = await codeBuddyDriver.buildSpawnPlan(
      buildParams({
        mcpConfigPath: '/tmp/codebuddy-mcp.json',
        resumeSessionId: 'cb-session-1',
      }),
    );

    expect(buildAgentInput).toHaveBeenCalledWith('codebuddy', 'hi');
    expect(plan.stdinPayload?.endsWith('\n')).toBe(true);
    expect(plan.args).toContain('--include-partial-messages');
    expect(plan.args[plan.args.indexOf('--permission-mode') + 1]).toBe('bypassPermissions');
    expect(plan.args[plan.args.indexOf('--mcp-config') + 1]).toBe('/tmp/codebuddy-mcp.json');
    expect(plan.args[plan.args.indexOf('--resume') + 1]).toBe('cb-session-1');
  });
});
