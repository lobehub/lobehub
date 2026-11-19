import { beforeEach, describe, expect, it, vi } from 'vitest';

import { desktopSkillRuntimeService } from '@/services/electron/desktopSkillRuntime';
import { localFileService } from '@/services/electron/localFileService';

import { skillsExecutor } from '../lobe-skills.desktop';

vi.mock('@lobechat/builtin-skills', () => ({ builtinSkills: [] }));
vi.mock('@/helpers/skillFilters', () => ({ filterBuiltinSkills: () => [] }));
vi.mock('@/services/skill', () => ({ agentSkillService: {} }));
vi.mock('@/services/electron/desktopSkillRuntime', () => ({
  desktopSkillRuntimeService: {
    resolveExecutionDirectory: vi.fn(),
    resolveReferenceFullPath: vi.fn(),
  },
}));
vi.mock('@/services/electron/localFileService', () => ({
  localFileService: { runCommand: vi.fn() },
}));

const SKILL_DIR = '/Users/me/.lobehub/skills/pdf';
const WORKING_DIR = '/Users/me/LobeHub/sandbox/agent-1';

const execScript = (ctx: Record<string, unknown> = {}) =>
  skillsExecutor.invoke(
    'execScript',
    { command: 'echo hi > /etc/owned', description: 'Write outside' },
    { messageId: 'test-message', workingDirectory: WORKING_DIR, ...ctx },
  );

describe('Desktop Skills execScript Local Sandbox fence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(localFileService.runCommand).mockResolvedValue({
      exit_code: 0,
      stdout: 'ok',
      success: true,
    } as any);
  });

  it('runs from the skill directory but fences to the working directory', async () => {
    // The skill directory is the shared skill cache: writable, a fenced run
    // could plant code that a later unfenced run executes.
    vi.mocked(desktopSkillRuntimeService.resolveExecutionDirectory).mockResolvedValue(SKILL_DIR);

    await execScript({ localSandbox: true, localSandboxNetwork: true });

    expect(localFileService.runCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        cwd: SKILL_DIR,
        sandbox: true,
        sandboxNetwork: true,
        sandboxRoot: WORKING_DIR,
      }),
    );
  });

  it('runs from the working directory when no skill directory resolves', async () => {
    vi.mocked(desktopSkillRuntimeService.resolveExecutionDirectory).mockResolvedValue(undefined);

    await execScript({ localSandbox: true });

    expect(localFileService.runCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        cwd: WORKING_DIR,
        sandbox: true,
        sandboxNetwork: false,
        sandboxRoot: WORKING_DIR,
      }),
    );
  });

  it('refuses a fenced run with no working directory instead of fencing the skill cache', async () => {
    vi.mocked(desktopSkillRuntimeService.resolveExecutionDirectory).mockResolvedValue(SKILL_DIR);

    const result = await execScript({ localSandbox: true, workingDirectory: undefined });

    expect(result.success).toBe(false);
    expect(result.content).toContain('requires a working directory');
    expect(localFileService.runCommand).not.toHaveBeenCalled();
  });

  it('surfaces the sandbox refusal instead of reporting success', async () => {
    vi.mocked(desktopSkillRuntimeService.resolveExecutionDirectory).mockResolvedValue(SKILL_DIR);
    vi.mocked(localFileService.runCommand).mockResolvedValue({
      exit_code: 1,
      stderr: 'bash: /etc/owned: Operation not permitted',
      success: false,
    } as any);

    const result = await execScript({ localSandbox: true });

    expect(result.success).toBe(false);
    expect(result.content).toContain('Operation not permitted');
  });

  it.each([
    ['off', { localSandbox: false }],
    ['unset', {}],
  ])('keeps the unfenced command unchanged when Local Sandbox is %s', async (_, ctx) => {
    vi.mocked(desktopSkillRuntimeService.resolveExecutionDirectory).mockResolvedValue(undefined);

    await execScript(ctx);

    const params = vi.mocked(localFileService.runCommand).mock.calls[0][0];
    expect(params).not.toHaveProperty('sandbox');
    expect(params).not.toHaveProperty('sandboxNetwork');
    expect(params).not.toHaveProperty('sandboxRoot');
    // No working-directory fallback either: the historical cwd is the skill dir only.
    expect(params.cwd).toBeUndefined();
  });
});
