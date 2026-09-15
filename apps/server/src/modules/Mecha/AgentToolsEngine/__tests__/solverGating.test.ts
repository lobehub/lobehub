// @vitest-environment node
import { SolverManifest } from '@lobechat/builtin-tool-solver';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createServerAgentToolsEngine } from '../index';
import { type ServerAgentToolsContext } from '../types';

/**
 * Mutable mock of the tools env — the engine reads `toolsEnv` at call time,
 * so flipping these fields per test exercises the real gate.
 */
const mockToolsEnv = vi.hoisted(() => ({
  SOLVER_SERVICE_API_KEY: undefined as string | undefined,
  SOLVER_SERVICE_URL: undefined as string | undefined,
}));

vi.mock('@/envs/tools', () => ({ toolsEnv: mockToolsEnv }));

const createMockContext = (): ServerAgentToolsContext => ({
  installedPlugins: [],
  isModelSupportToolUse: () => true,
});

const buildEngineResult = (plugins: string[]) => {
  const engine = createServerAgentToolsEngine(createMockContext(), {
    agentConfig: { plugins },
    model: 'gpt-4',
    provider: 'openai',
  });

  return {
    available: engine.getAvailablePlugins(),
    enabledToolIds: engine.generateToolsDetailed({
      toolIds: [SolverManifest.identifier],
      model: 'gpt-4',
      provider: 'openai',
    }).enabledToolIds,
  };
};

describe('builtin-solver env gating', () => {
  beforeEach(() => {
    mockToolsEnv.SOLVER_SERVICE_API_KEY = undefined;
    mockToolsEnv.SOLVER_SERVICE_URL = undefined;
  });

  it('is not offered to agents when SOLVER_SERVICE_URL / SOLVER_SERVICE_API_KEY are unset, even when pinned', () => {
    const { available, enabledToolIds } = buildEngineResult([SolverManifest.identifier]);

    expect(enabledToolIds).not.toContain(SolverManifest.identifier);
    // Physical drop, not just a rule gate: the manifest is unresolvable, so the
    // activator's allowExplicitActivation bypass cannot resurrect it.
    expect(available).not.toContain(SolverManifest.identifier);
  });

  it('is not offered when only one of the env vars is set', () => {
    mockToolsEnv.SOLVER_SERVICE_URL = 'https://solver.example.com';

    const { available, enabledToolIds } = buildEngineResult([SolverManifest.identifier]);

    expect(enabledToolIds).not.toContain(SolverManifest.identifier);
    expect(available).not.toContain(SolverManifest.identifier);
  });

  it('is enabled when the service is configured and the agent pinned it', () => {
    mockToolsEnv.SOLVER_SERVICE_URL = 'https://solver.example.com';
    mockToolsEnv.SOLVER_SERVICE_API_KEY = 'test-key';

    const { available, enabledToolIds } = buildEngineResult([SolverManifest.identifier]);

    expect(available).toContain(SolverManifest.identifier);
    expect(enabledToolIds).toContain(SolverManifest.identifier);
  });

  it('stays disabled when the service is configured but the agent did not pin it', () => {
    mockToolsEnv.SOLVER_SERVICE_URL = 'https://solver.example.com';
    mockToolsEnv.SOLVER_SERVICE_API_KEY = 'test-key';

    const { available, enabledToolIds } = buildEngineResult([]);

    // The manifest stays resolvable (the deployment HAS the service), the tool
    // is just not enabled for this agent.
    expect(available).toContain(SolverManifest.identifier);
    expect(enabledToolIds).not.toContain(SolverManifest.identifier);
  });
});
