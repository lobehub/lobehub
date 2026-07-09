import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const sandboxService = {
    callTool: vi.fn(),
    capabilities: {
      backgroundCommands: true,
      exportFile: true,
      files: true,
      languages: ['python'],
      persistentSession: true,
      shell: true,
      skillScripts: true,
    },
    exportAndUploadFile: vi.fn(),
    kind: 'onlyboxes',
  };

  return {
    checkHash: vi.fn(),
    createSandboxService: vi.fn(() => sandboxService),
    executeToolCall: vi.fn(),
    fileService: {
      getFullFileUrl: vi.fn(),
    },
    findAll: vi.fn(),
    findById: vi.fn(),
    findByName: vi.fn(),
    getAgentConfigById: vi.fn(),
    getAgentSkills: vi.fn(),
    getUserSettings: vi.fn(),
    marketService: {},
    prepareSkillDirectory: vi.fn(),
    readResource: vi.fn(),
    sandboxService,
  };
});

vi.mock('@lobechat/builtin-skills', () => ({
  builtinSkills: [],
}));

vi.mock('@/database/models/agent', () => ({
  AgentModel: vi.fn(() => ({
    getAgentConfigById: mocks.getAgentConfigById,
  })),
}));

vi.mock('@/database/models/agentSkill', () => ({
  AgentSkillModel: vi.fn(() => ({
    findAll: mocks.findAll,
    findById: mocks.findById,
    findByName: mocks.findByName,
  })),
}));

vi.mock('@/database/models/file', () => ({
  FileModel: vi.fn(() => ({
    checkHash: mocks.checkHash,
  })),
}));

vi.mock('@/database/models/user', () => ({
  UserModel: vi.fn(() => ({
    getUserSettings: mocks.getUserSettings,
  })),
}));

vi.mock('@/helpers/skillFilters', () => ({
  filterBuiltinSkills: vi.fn((skills: unknown) => skills),
}));

vi.mock('@/server/services/agentDocuments', () => ({
  AgentDocumentsService: vi.fn(() => ({
    getAgentSkills: mocks.getAgentSkills,
  })),
}));

vi.mock('@/server/services/file', () => ({
  FileService: vi.fn(() => mocks.fileService),
}));

vi.mock('@/server/services/market', () => ({
  MarketService: vi.fn(() => mocks.marketService),
}));

vi.mock('@/server/services/sandbox', async () => {
  const actual = await vi.importActual('@/server/services/sandbox');

  return {
    ...(actual as Record<string, unknown>),
    createSandboxService: mocks.createSandboxService,
  };
});

vi.mock('@/server/services/skill/resource', () => ({
  SkillResourceService: vi.fn(() => ({
    readResource: mocks.readResource,
  })),
}));

vi.mock('@/server/services/deviceGateway', () => ({
  deviceGateway: {
    executeToolCall: mocks.executeToolCall,
    prepareSkillDirectory: mocks.prepareSkillDirectory,
  },
}));

vi.mock('../resolveWorkspaceScope', () => ({
  resolveRunWorkspaceId: vi.fn(async () => undefined),
}));

describe('skillsRuntime', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mocks.checkHash.mockResolvedValue({ isExist: true, url: 'skills/user-skill.zip' });
    mocks.fileService.getFullFileUrl.mockResolvedValue('https://files.example.com/user-skill.zip');
    mocks.findAll.mockResolvedValue({ data: [], total: 0 });
    mocks.findById.mockResolvedValue(undefined);
    mocks.getAgentConfigById.mockResolvedValue(undefined);
    mocks.findByName.mockImplementation(async (name: string) => {
      if (name === 'user-skill') {
        return {
          id: 'user-skill-id',
          name: 'user-skill',
          zipFileHash: 'zip-hash-1',
        };
      }

      return undefined;
    });
    mocks.getAgentSkills.mockResolvedValue([]);
    mocks.getUserSettings.mockResolvedValue({ market: { accessToken: 'market-token' } });
    mocks.sandboxService.callTool.mockResolvedValue({
      result: {
        exitCode: 0,
        output: 'ok',
        stdout: 'ok',
        success: true,
      },
      success: true,
    });
  });

  // First dynamic `import('../skills')` in the file pays the real transform
  // cost for this (now larger) module — default 5s timeout is marginal for
  // that cold cost alone, independent of test logic.
  it('executes scripts through the sandbox service and only attaches persisted skill zips', async () => {
    const { skillsRuntime } = await import('../skills');
    const runtime = await skillsRuntime.factory({
      serverDB: {} as never,
      toolManifestMap: {},
      topicId: 'topic-1',
      userId: 'user-1',
    });

    const result = await runtime.execScript({
      activatedSkills: [
        { id: 'user-skill-id', name: 'user-skill' },
        { id: 'builtin-skill-id', name: 'builtin-skill' },
      ],
      command: 'python scripts/run.py',
      description: 'Run skill script',
    });

    expect(result.success).toBe(true);
    expect(mocks.findByName).toHaveBeenCalledWith('user-skill');
    expect(mocks.findByName).toHaveBeenCalledWith('builtin-skill');
    expect(mocks.checkHash).toHaveBeenCalledWith('zip-hash-1');
    expect(mocks.sandboxService.callTool).toHaveBeenCalledWith(
      'execScript',
      expect.objectContaining({
        command: 'python scripts/run.py',
        description: 'Run skill script',
        skillZipUrls: {
          'user-skill': 'https://files.example.com/user-skill.zip',
        },
      }),
    );
  }, 20_000);

  it('tags sandbox exec results with executionEnv for plugin-state observability', async () => {
    const { skillsRuntime } = await import('../skills');
    const runtime = await skillsRuntime.factory({
      serverDB: {} as never,
      toolManifestMap: {},
      topicId: 'topic-1',
      userId: 'user-1',
    });

    const result = await runtime.execScript({
      activatedSkills: [],
      command: 'echo hi',
      description: 'plain command',
    });

    expect(result.state).toMatchObject({ executionEnv: 'sandbox' });
  });

  describe('disabled skill enforcement', () => {
    it('refuses to activate a DB skill the agent has disabled, even though it exists', async () => {
      mocks.getAgentConfigById.mockResolvedValue({
        plugins: [{ identifier: 'user-skill-identifier', mode: 'disabled' }],
      });
      mocks.findByName.mockImplementation(async (name: string) =>
        name === 'user-skill'
          ? { id: 'user-skill-id', identifier: 'user-skill-identifier', name: 'user-skill' }
          : undefined,
      );

      const { skillsRuntime } = await import('../skills');
      const runtime = await skillsRuntime.factory({
        agentId: 'agent-1',
        serverDB: {} as never,
        toolManifestMap: {},
        topicId: 'topic-1',
        userId: 'user-1',
      });

      const result = await runtime.activateSkill({ name: 'user-skill' });

      expect(result.success).toBe(false);
    });

    it('still activates the skill when it is not disabled', async () => {
      mocks.getAgentConfigById.mockResolvedValue({ plugins: [] });
      mocks.findByName.mockImplementation(async (name: string) =>
        name === 'user-skill'
          ? {
              content: '# User skill',
              id: 'user-skill-id',
              identifier: 'user-skill-identifier',
              name: 'user-skill',
            }
          : undefined,
      );

      const { skillsRuntime } = await import('../skills');
      const runtime = await skillsRuntime.factory({
        agentId: 'agent-1',
        serverDB: {} as never,
        toolManifestMap: {},
        topicId: 'topic-1',
        userId: 'user-1',
      });

      const result = await runtime.activateSkill({ name: 'user-skill' });

      expect(result.success).toBe(true);
    });
  });

  // Regression guard for the server/gateway migration: when the execution plan
  // routed a device (activeDeviceId present), execScript must run ON the device
  // — prepare the skill archives via the prepareSkillDirectory RPC and execute
  // through local-system over the gateway — never in the cloud sandbox.
  describe('device execution branch', () => {
    it('prepares archives on the device and runs the command with cwd = extracted dir', async () => {
      mocks.prepareSkillDirectory.mockResolvedValue({
        extractedDir: '/home/user/.lobehub/skills/extracted/zip-hash-1',
        success: true,
      });
      mocks.executeToolCall.mockResolvedValue({
        content: 'ok',
        state: { exitCode: 0, stdout: 'ok', success: true },
        success: true,
      });

      const { skillsRuntime } = await import('../skills');
      const runtime = await skillsRuntime.factory({
        activeDeviceId: 'device-1',
        serverDB: {} as never,
        toolManifestMap: {},
        topicId: 'topic-1',
        userId: 'user-1',
      });

      const result = await runtime.execScript({
        activatedSkills: [{ id: 'user-skill-id', name: 'user-skill' }],
        command: 'python scripts/run.py',
        description: 'Run skill script',
      });

      expect(result.success).toBe(true);
      expect(result.state).toMatchObject({ executionEnv: 'device' });
      expect(mocks.prepareSkillDirectory).toHaveBeenCalledWith(
        expect.objectContaining({
          deviceId: 'device-1',
          url: 'https://files.example.com/user-skill.zip',
          userId: 'user-1',
          zipHash: 'zip-hash-1',
        }),
      );
      expect(mocks.executeToolCall).toHaveBeenCalledWith(
        expect.objectContaining({ deviceId: 'device-1', userId: 'user-1' }),
        expect.objectContaining({
          apiName: 'runCommand',
          arguments: JSON.stringify({
            command: 'python scripts/run.py',
            cwd: '/home/user/.lobehub/skills/extracted/zip-hash-1',
          }),
          identifier: 'lobe-local-system',
        }),
        undefined,
      );
      expect(mocks.sandboxService.callTool).not.toHaveBeenCalled();
    });

    it('fails explicitly (no sandbox fallback) when the device cannot prepare a skill', async () => {
      mocks.prepareSkillDirectory.mockResolvedValue({
        error: 'Failed to download skill archive: 404 Not Found',
        success: false,
      });

      const { skillsRuntime } = await import('../skills');
      const runtime = await skillsRuntime.factory({
        activeDeviceId: 'device-1',
        serverDB: {} as never,
        toolManifestMap: {},
        topicId: 'topic-1',
        userId: 'user-1',
      });

      const result = await runtime.execScript({
        activatedSkills: [{ id: 'user-skill-id', name: 'user-skill' }],
        command: 'python scripts/run.py',
        description: 'Run skill script',
      });

      expect(result.success).toBe(false);
      expect(result.content).toContain('404 Not Found');
      expect(mocks.executeToolCall).not.toHaveBeenCalled();
      expect(mocks.sandboxService.callTool).not.toHaveBeenCalled();
    });

    // Version-skew window: an old client build replies with the dispatcher's
    // deterministic unknown-method error — the ONE prepare failure that falls
    // back to the sandbox, with an explicit disclosure note for the model.
    it('falls back to the sandbox (with a disclosure note) when the client predates the RPC', async () => {
      mocks.prepareSkillDirectory.mockResolvedValue({
        error: 'Unknown device RPC method: prepareSkillDirectory',
        success: false,
      });

      const { skillsRuntime } = await import('../skills');
      const runtime = await skillsRuntime.factory({
        activeDeviceId: 'device-1',
        serverDB: {} as never,
        toolManifestMap: {},
        topicId: 'topic-1',
        userId: 'user-1',
      });

      const result = await runtime.execScript({
        activatedSkills: [{ id: 'user-skill-id', name: 'user-skill' }],
        command: 'python scripts/run.py',
        description: 'Run skill script',
      });

      expect(result.success).toBe(true);
      expect(result.state).toMatchObject({ executionEnv: 'sandbox' });
      expect(result.content).toContain('update their LobeHub app');
      expect(mocks.executeToolCall).not.toHaveBeenCalled();
      expect(mocks.sandboxService.callTool).toHaveBeenCalledWith(
        'execScript',
        expect.objectContaining({ command: 'python scripts/run.py' }),
      );
    });

    it('runs without a skill dir (workingDirectory cwd) when no archive exists', async () => {
      mocks.executeToolCall.mockResolvedValue({
        content: 'ok',
        state: { exitCode: 0, stdout: 'ok', success: true },
        success: true,
      });

      const { skillsRuntime } = await import('../skills');
      const runtime = await skillsRuntime.factory({
        activeDeviceId: 'device-1',
        serverDB: {} as never,
        toolManifestMap: {},
        topicId: 'topic-1',
        userId: 'user-1',
        workingDirectory: '/Users/me/project',
      });

      const result = await runtime.execScript({
        activatedSkills: [{ id: 'builtin-skill-id', name: 'builtin-skill' }],
        command: 'echo hi',
        description: 'no archive',
      });

      expect(result.success).toBe(true);
      expect(mocks.prepareSkillDirectory).not.toHaveBeenCalled();
      expect(mocks.executeToolCall).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          arguments: JSON.stringify({ command: 'echo hi', cwd: '/Users/me/project' }),
        }),
        undefined,
      );
    });

    // Filesystem (project/device) skills have no DB archive — their SKILL.md
    // directory on the device is the cwd, and the last activated skill wins
    // over earlier archive-backed ones.
    it('uses the project skill directory as cwd, winning over earlier archives', async () => {
      mocks.prepareSkillDirectory.mockResolvedValue({
        extractedDir: '/home/user/.lobehub/skills/extracted/zip-hash-1',
        success: true,
      });
      mocks.executeToolCall.mockResolvedValue({
        content: 'ok',
        state: { exitCode: 0, stdout: 'ok', success: true },
        success: true,
      });

      const { skillsRuntime } = await import('../skills');
      const runtime = await skillsRuntime.factory({
        activeDeviceId: 'device-1',
        projectSkills: [
          { location: '/ws/.agents/skills/foo/SKILL.md', name: 'foo', source: 'project' },
        ],
        serverDB: {} as never,
        toolManifestMap: {},
        topicId: 'topic-1',
        userId: 'user-1',
      });

      const result = await runtime.execScript({
        activatedSkills: [
          { id: 'user-skill-id', name: 'user-skill' },
          // Filesystem activations carry no DB id — matching is by name only.
          { name: 'foo' },
        ],
        command: 'python scripts/run.py',
        description: 'Run project skill script',
      });

      expect(result.success).toBe(true);
      // The archive-backed skill is still prepared (activated earlier)...
      expect(mocks.prepareSkillDirectory).toHaveBeenCalledTimes(1);
      // ...but the project skill activated last wins the cwd.
      expect(mocks.executeToolCall).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          arguments: JSON.stringify({
            command: 'python scripts/run.py',
            cwd: '/ws/.agents/skills/foo',
          }),
        }),
        undefined,
      );
    });

    // Archive prepares are full device-gateway round-trips and activatedSkills
    // accumulates over the conversation — they must fire concurrently, while
    // the activation-order semantics (last resolvable wins the cwd) stay
    // intact.
    it('fires archive prepares concurrently and the last resolvable skill wins the cwd', async () => {
      mocks.findByName.mockImplementation(async (name: string) => {
        if (name === 'skill-a') return { id: 'a-id', name: 'skill-a', zipFileHash: 'hash-a' };
        if (name === 'skill-b') return { id: 'b-id', name: 'skill-b', zipFileHash: 'hash-b' };
        return undefined;
      });
      mocks.checkHash.mockImplementation(async (hash: string) => ({
        isExist: true,
        url: `skills/${hash}.zip`,
      }));
      mocks.fileService.getFullFileUrl.mockImplementation(
        async (url: string) => `https://files.example.com/${url}`,
      );

      // Hold both prepares pending to prove the second RPC fires before the
      // first resolves (a sequential await chain would deadlock this test).
      const resolvers: ((value: { extractedDir: string; success: boolean }) => void)[] = [];
      mocks.prepareSkillDirectory.mockImplementation(
        () => new Promise((resolve) => resolvers.push(resolve)),
      );
      mocks.executeToolCall.mockResolvedValue({
        content: 'ok',
        state: { exitCode: 0, stdout: 'ok', success: true },
        success: true,
      });

      const { skillsRuntime } = await import('../skills');
      const runtime = await skillsRuntime.factory({
        activeDeviceId: 'device-1',
        serverDB: {} as never,
        toolManifestMap: {},
        topicId: 'topic-1',
        userId: 'user-1',
      });

      const pending = runtime.execScript({
        activatedSkills: [
          { id: 'a-id', name: 'skill-a' },
          { id: 'b-id', name: 'skill-b' },
        ],
        command: 'python scripts/run.py',
        description: 'multi skill',
      });

      await vi.waitFor(() => expect(mocks.prepareSkillDirectory).toHaveBeenCalledTimes(2));
      resolvers[0]({ extractedDir: '/dev/extracted/hash-a', success: true });
      resolvers[1]({ extractedDir: '/dev/extracted/hash-b', success: true });

      const result = await pending;
      expect(result.success).toBe(true);
      expect(mocks.executeToolCall).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          arguments: JSON.stringify({
            command: 'python scripts/run.py',
            cwd: '/dev/extracted/hash-b',
          }),
        }),
        undefined,
      );
    });

    // With concurrent prepares, error reporting must still follow activation
    // order: the FIRST failing skill is the one surfaced, regardless of which
    // RPC settles first.
    it('reports the first failing skill in activation order despite concurrent prepares', async () => {
      mocks.findByName.mockImplementation(async (name: string) => {
        if (name === 'skill-a') return { id: 'a-id', name: 'skill-a', zipFileHash: 'hash-a' };
        if (name === 'skill-b') return { id: 'b-id', name: 'skill-b', zipFileHash: 'hash-b' };
        return undefined;
      });
      mocks.checkHash.mockImplementation(async (hash: string) => ({
        isExist: true,
        url: `skills/${hash}.zip`,
      }));
      mocks.fileService.getFullFileUrl.mockImplementation(
        async (url: string) => `https://files.example.com/${url}`,
      );
      mocks.prepareSkillDirectory.mockImplementation(async ({ zipHash }: { zipHash: string }) =>
        zipHash === 'hash-a'
          ? { error: 'Failed to download skill archive: 404 Not Found', success: false }
          : { extractedDir: '/dev/extracted/hash-b', success: true },
      );

      const { skillsRuntime } = await import('../skills');
      const runtime = await skillsRuntime.factory({
        activeDeviceId: 'device-1',
        serverDB: {} as never,
        toolManifestMap: {},
        topicId: 'topic-1',
        userId: 'user-1',
      });

      const result = await runtime.execScript({
        activatedSkills: [
          { id: 'a-id', name: 'skill-a' },
          { id: 'b-id', name: 'skill-b' },
        ],
        command: 'python scripts/run.py',
        description: 'multi skill',
      });

      expect(result.success).toBe(false);
      expect(result.content).toContain('skill-a');
      expect(result.content).toContain('404 Not Found');
      expect(mocks.executeToolCall).not.toHaveBeenCalled();
      expect(mocks.sandboxService.callTool).not.toHaveBeenCalled();
    });

    // A command that outlives the shell observation window comes back with no
    // exitCode — it must surface as still running (with a pollable shell_id),
    // not as a successful completion.
    it('reports a still-running command instead of pretending completion', async () => {
      mocks.executeToolCall.mockResolvedValue({
        content: 'Command is still running after the wait window.',
        state: { commandId: 'shell-9', stdout: '', success: true },
        success: true,
      });

      const { skillsRuntime } = await import('../skills');
      const runtime = await skillsRuntime.factory({
        activeDeviceId: 'device-1',
        serverDB: {} as never,
        toolManifestMap: {},
        topicId: 'topic-1',
        userId: 'user-1',
      });

      const result = await runtime.execScript({
        activatedSkills: [],
        command: 'sleep 600',
        description: 'long script',
      });

      expect(result.success).toBe(true);
      expect(result.state).toMatchObject({ executionEnv: 'device', shellId: 'shell-9' });
      expect(result.state).not.toHaveProperty('exitCode', 0);
      expect(result.content).toContain('still running');
      expect(result.content).toContain('shell-9');
      expect(result.content).not.toContain('completed successfully');
    });

    // The device ComputerRuntime reports service failures (spawn error, shell
    // lost) with a delivered envelope: `success: true`, `state.success:
    // false`, and no exitCode — they must surface as failures, not as a
    // still-running command.
    it('reports failure when the device service fails without an exit code', async () => {
      mocks.executeToolCall.mockResolvedValue({
        content: 'spawn ENOENT',
        state: { error: 'spawn ENOENT', isBackground: false, success: false },
        success: true,
      });

      const { skillsRuntime } = await import('../skills');
      const runtime = await skillsRuntime.factory({
        activeDeviceId: 'device-1',
        serverDB: {} as never,
        toolManifestMap: {},
        topicId: 'topic-1',
        userId: 'user-1',
      });

      const result = await runtime.execScript({
        activatedSkills: [],
        command: 'python scripts/run.py',
        description: 'spawn failure',
      });

      expect(result.success).toBe(false);
      expect(result.content).toContain('spawn ENOENT');
      expect(result.content).not.toContain('still running');
    });

    // The device shell observation reports success: true for any delivered
    // observation — the actual exit status only lives in exitCode.
    it('reports failure when the script exits non-zero despite a successful observation', async () => {
      mocks.executeToolCall.mockResolvedValue({
        content: '',
        state: { exitCode: 2, stderr: 'boom', stdout: '', success: true },
        success: true,
      });

      const { skillsRuntime } = await import('../skills');
      const runtime = await skillsRuntime.factory({
        activeDeviceId: 'device-1',
        serverDB: {} as never,
        toolManifestMap: {},
        topicId: 'topic-1',
        userId: 'user-1',
      });

      const result = await runtime.execScript({
        activatedSkills: [],
        command: 'exit 2',
        description: 'failing script',
      });

      expect(result.success).toBe(false);
      expect(result.state).toMatchObject({ executionEnv: 'device', exitCode: 2 });
      expect(result.content).toContain('boom');
    });

    it('forwards executionTimeoutMs as the shell observation timeout in the runCommand args', async () => {
      mocks.executeToolCall.mockResolvedValue({
        content: 'ok',
        state: { exitCode: 0, stdout: 'ok', success: true },
        success: true,
      });

      const { skillsRuntime } = await import('../skills');
      const runtime = await skillsRuntime.factory({
        activeDeviceId: 'device-1',
        executionTimeoutMs: 300_000,
        serverDB: {} as never,
        toolManifestMap: {},
        topicId: 'topic-1',
        userId: 'user-1',
      });

      await runtime.execScript({
        activatedSkills: [],
        command: 'sleep 60',
        description: 'long script',
      });

      expect(mocks.executeToolCall).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          arguments: JSON.stringify({ command: 'sleep 60', timeout: 300_000 }),
        }),
        300_000,
      );
    });

    // Large streams are truncated to a preview device-side with the full
    // output saved to disk — dropping state.outputFiles would lose the only
    // retrieval path for the truncated output.
    it('carries saved-output file paths through for truncated device output', async () => {
      mocks.executeToolCall.mockResolvedValue({
        content: 'preview…',
        state: {
          exitCode: 0,
          outputFiles: {
            stdout: {
              path: '/tmp/lobe-shell/shell-1.stdout.log',
              size: 5_242_880,
              truncated: true,
            },
          },
          stdout: 'preview…',
          success: true,
        },
        success: true,
      });

      const { skillsRuntime } = await import('../skills');
      const runtime = await skillsRuntime.factory({
        activeDeviceId: 'device-1',
        serverDB: {} as never,
        toolManifestMap: {},
        topicId: 'topic-1',
        userId: 'user-1',
      });

      const result = await runtime.execScript({
        activatedSkills: [],
        command: 'cat big.log',
        description: 'noisy script',
      });

      expect(result.success).toBe(true);
      expect(result.content).toContain('/tmp/lobe-shell/shell-1.stdout.log');
      expect(result.state).toMatchObject({
        outputFiles: { stdout: expect.objectContaining({ truncated: true }) },
      });
    });

    // The device manifest hides the sandbox-only APIs, but the builtin
    // executor dispatches any method on the runtime regardless of the
    // manifest — a prompt-following or hallucinated call must be refused at
    // execution time, not silently run in the sandbox.
    it('refuses the sandbox runCommand while a device is routed', async () => {
      const { skillsRuntime } = await import('../skills');
      const runtime = await skillsRuntime.factory({
        activeDeviceId: 'device-1',
        serverDB: {} as never,
        toolManifestMap: {},
        topicId: 'topic-1',
        userId: 'user-1',
      });

      const result = await runtime.runCommand({ command: 'ls' });

      expect(result.success).toBe(false);
      expect(result.content).toContain('lobe-local-system');
      expect(mocks.createSandboxService).not.toHaveBeenCalled();
    });

    it('refuses the sandbox exportFile while a device is routed', async () => {
      const { skillsRuntime } = await import('../skills');
      const runtime = await skillsRuntime.factory({
        activeDeviceId: 'device-1',
        serverDB: {} as never,
        toolManifestMap: {},
        topicId: 'topic-1',
        userId: 'user-1',
      });

      const result = await runtime.exportFile({ filename: 'out.csv', path: '/tmp/out.csv' });

      expect(result.success).toBe(false);
      expect(result.content).toContain("already on the user's machine");
      expect(mocks.sandboxService.exportAndUploadFile).not.toHaveBeenCalled();
    });
  });

  // Regression guard for the device-gating fix: builtin skills must be filtered
  // with canExecuteOnDevice derived from the run's activeDeviceId, not the
  // compile-time isDesktop constant (always false on the server).
  it('gates device-only builtin skills on activeDeviceId presence', async () => {
    const { filterBuiltinSkills } = await import('@/helpers/skillFilters');
    const { skillsRuntime } = await import('../skills');

    await skillsRuntime.factory({
      serverDB: {} as never,
      toolManifestMap: {},
      topicId: 'topic-1',
      userId: 'user-1',
    });

    expect(filterBuiltinSkills).toHaveBeenLastCalledWith(expect.anything(), {
      canExecuteOnDevice: false,
    });

    await skillsRuntime.factory({
      activeDeviceId: 'device-1',
      serverDB: {} as never,
      toolManifestMap: {},
      topicId: 'topic-1',
      userId: 'user-1',
    });

    expect(filterBuiltinSkills).toHaveBeenLastCalledWith(expect.anything(), {
      canExecuteOnDevice: true,
    });
  });
});
