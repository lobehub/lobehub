import { describe, expect, it } from 'vitest';

import type {
  HeterogeneousAgentBuildPlanHelpers,
  HeterogeneousAgentBuildPlanParams,
} from '../types';
import { claudeCodeDriver } from './claudeCode';

const stubHelpers: HeterogeneousAgentBuildPlanHelpers = {
  buildAgentInput: async () => ({ args: [], stdin: '{"type":"user","message":{}}\n' }),
};

const buildParams = (
  overrides: Partial<HeterogeneousAgentBuildPlanParams> = {},
): HeterogeneousAgentBuildPlanParams => ({
  args: [],
  helpers: stubHelpers,
  promptInput: 'hi',
  ...overrides,
});

describe('claudeCodeDriver', () => {
  it('prepares the namespaced server-default model without persisting the operation token', async () => {
    const plan = await claudeCodeDriver.prepareServerDefaultBinding!({
      args: [],
      endpoint: 'https://app.example.com',
      env: { ANTHROPIC_AUTH_TOKEN: 'stale' },
      model: 'claude-sonnet-4-6',
      profileDir: '/tmp/profile',
    });

    expect(plan.args).toEqual(expect.arrayContaining(['--model', 'lobehub/claude-sonnet-4-6']));
    expect(plan.env).toMatchObject({
      ANTHROPIC_BASE_URL: 'https://app.example.com/api/v1/anthropic',
      ANTHROPIC_MODEL: 'lobehub/claude-sonnet-4-6',
      ANTHROPIC_SMALL_FAST_MODEL: 'lobehub/claude-sonnet-4-6',
      CLAUDE_CODE_SUBAGENT_MODEL: 'lobehub/claude-sonnet-4-6',
    });
    expect(plan.operationTokenEnvKey).toBe('ANTHROPIC_AUTH_TOKEN');
    expect(plan.env.ANTHROPIC_AUTH_TOKEN).toBeUndefined();
  });
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

  it('still pins shared --disallowedTools alongside --mcp-config', async () => {
    // Even with our local MCP replacement available, CC's built-in stays
    // disabled. Monitor/ScheduleWakeup stay disabled through the same shared
    // base args because they can hit the stuck wakeup path in desktop mode.
    const { args } = await claudeCodeDriver.buildSpawnPlan(
      buildParams({ mcpConfigPath: '/tmp/x.json' }),
    );
    const disallowedIdx = args.indexOf('--disallowedTools');
    expect(disallowedIdx).toBeGreaterThan(-1);
    expect(args[disallowedIdx + 1]).toBe('AskUserQuestion,Monitor,ScheduleWakeup');
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

  it('materializes a host-owned Anthropic binding and scrubs conflicting user config', async () => {
    const plan = await claudeCodeDriver.prepareProviderBinding!({
      args: ['--model', 'stale-model', '--effort', 'high'],
      env: { ANTHROPIC_API_KEY: 'stale-key', KEEP_ME: 'yes' },
      profileDir: '/managed/claude',
      reference: {
        apiConfig: { model: 'claude-primary', providerId: 'anthropic-custom' },
        kind: 'provider',
      },
      resolution: {
        agentType: 'claude-code',
        apiConfig: { model: 'claude-primary', providerId: 'anthropic-custom' },
        endpoint: 'https://gateway.example.com',
        protocol: 'anthropic-messages',
        providerId: 'anthropic-custom',
        runtimeConfig: {
          config: {},
          keyVaults: { apiKey: 'bound-key', baseURL: 'https://gateway.example.com/v1' },
          settings: { sdkType: 'anthropic' },
        },
      },
      runDir: '/managed/run',
    });

    expect(plan).toMatchObject({
      args: ['--effort', 'high', '--model', 'claude-primary'],
      env: {
        ANTHROPIC_AUTH_TOKEN: 'bound-key',
        ANTHROPIC_BASE_URL: 'https://gateway.example.com',
        CLAUDE_CONFIG_DIR: '/managed/claude',
        KEEP_ME: 'yes',
      },
    });
    expect(plan.env.ANTHROPIC_API_KEY).toBeUndefined();
  });
});
