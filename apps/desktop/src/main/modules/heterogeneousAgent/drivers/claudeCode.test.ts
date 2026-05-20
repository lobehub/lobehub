import { describe, expect, it } from 'vitest';

import type {
  HeterogeneousAgentBuildPlanHelpers,
  HeterogeneousAgentBuildPlanParams,
} from '../types';
import { claudeCodeDriver } from './claudeCode';

const stubHelpers: HeterogeneousAgentBuildPlanHelpers = {
  buildClaudeStreamJsonInput: async () => '{"type":"user","message":{}}\n',
  resolveCliImagePaths: async () => [],
};

const buildParams = (
  overrides: Partial<HeterogeneousAgentBuildPlanParams> = {},
): HeterogeneousAgentBuildPlanParams => ({
  args: [],
  helpers: stubHelpers,
  imageList: [],
  prompt: 'hi',
  ...overrides,
});

describe('claudeCodeDriver', () => {
  it('omits --mcp-config when mcpConfigPath is undefined', async () => {
    const { args } = await claudeCodeDriver.buildSpawnPlan(buildParams());
    expect(args).not.toContain('--mcp-config');
  });

  it('appends --mcp-config <path> when mcpConfigPath is provided', async () => {
    const { args } = await claudeCodeDriver.buildSpawnPlan(
      buildParams({ mcpConfigPath: '/tmp/lobe-cc-mcp-op-1.json' }),
    );
    const idx = args.indexOf('--mcp-config');
    expect(idx).toBeGreaterThan(-1);
    expect(args[idx + 1]).toBe('/tmp/lobe-cc-mcp-op-1.json');
  });

  it('still pins --disallowedTools AskUserQuestion alongside --mcp-config', async () => {
    // Even with our local MCP replacement available, CC's built-in stays
    // disabled — leaving both visible would let the model double-register
    // the same name and pick the broken one.
    const { args } = await claudeCodeDriver.buildSpawnPlan(
      buildParams({ mcpConfigPath: '/tmp/x.json' }),
    );
    const disallowedIdx = args.indexOf('--disallowedTools');
    expect(disallowedIdx).toBeGreaterThan(-1);
    expect(args[disallowedIdx + 1]).toBe('AskUserQuestion');
  });

  it('--mcp-config goes before --resume so user --args can still override the resume id', async () => {
    const { args } = await claudeCodeDriver.buildSpawnPlan(
      buildParams({ mcpConfigPath: '/tmp/x.json', resumeSessionId: 'cc-prev-1' }),
    );
    const mcpIdx = args.indexOf('--mcp-config');
    const resumeIdx = args.indexOf('--resume');
    expect(mcpIdx).toBeGreaterThan(-1);
    expect(resumeIdx).toBeGreaterThan(-1);
    expect(mcpIdx).toBeLessThan(resumeIdx);
    expect(args[resumeIdx + 1]).toBe('cc-prev-1');
  });
});
