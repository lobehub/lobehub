import { describe, expect, it, vi } from 'vitest';

import type { CommandResult } from '../types';
import { type SkillRuntimeService, SkillsExecutionRuntime } from './index';

const createMockService = (overrides?: Partial<SkillRuntimeService>): SkillRuntimeService => ({
  findAll: vi.fn().mockResolvedValue({ data: [], total: 0 }),
  findById: vi.fn().mockResolvedValue(undefined),
  findByName: vi.fn().mockResolvedValue(undefined),
  readResource: vi.fn(),
  ...overrides,
});

describe('SkillsExecutionRuntime', () => {
  describe('execScript', () => {
    const args = { command: 'echo hello', description: 'test command' };

    describe('via execScript service method', () => {
      it('should return success: true when script succeeds', async () => {
        const service = createMockService({
          execScript: vi.fn().mockResolvedValue({
            exitCode: 0,
            output: 'hello',
            success: true,
          } satisfies CommandResult),
        });
        const runtime = new SkillsExecutionRuntime({ service });

        const result = await runtime.execScript(args);

        expect(result.success).toBe(true);
        expect(result.content).toBe('hello');
        expect(result.state).toEqual({ command: 'echo hello', exitCode: 0, success: true });
      });

      it('should return success: false when script fails with non-zero exit code', async () => {
        const service = createMockService({
          execScript: vi.fn().mockResolvedValue({
            exitCode: 1,
            output: '',
            stderr: 'command not found',
            success: false,
          } satisfies CommandResult),
        });
        const runtime = new SkillsExecutionRuntime({ service });

        const result = await runtime.execScript(args);

        expect(result.success).toBe(false);
        expect(result.content).toBe('command not found');
        expect(result.state).toEqual({ command: 'echo hello', exitCode: 1, success: false });
      });

      it('should combine output and stderr', async () => {
        const service = createMockService({
          execScript: vi.fn().mockResolvedValue({
            exitCode: 0,
            output: 'stdout line',
            stderr: 'stderr line',
            success: true,
          } satisfies CommandResult),
        });
        const runtime = new SkillsExecutionRuntime({ service });

        const result = await runtime.execScript(args);

        expect(result.content).toBe('stdout line\nstderr line');
      });

      it('should return "(no output)" when output is empty', async () => {
        const service = createMockService({
          execScript: vi.fn().mockResolvedValue({
            exitCode: 0,
            output: '',
            success: true,
          } satisfies CommandResult),
        });
        const runtime = new SkillsExecutionRuntime({ service });

        const result = await runtime.execScript(args);

        expect(result.content).toBe('(no output)');
      });

      it('should return success: false when execScript throws', async () => {
        const service = createMockService({
          execScript: vi.fn().mockRejectedValue(new Error('sandbox timeout')),
        });
        const runtime = new SkillsExecutionRuntime({ service });

        const result = await runtime.execScript(args);

        expect(result.success).toBe(false);
        expect(result.content).toBe('Failed to execute command: sandbox timeout');
      });
    });

    describe('via runCommand fallback', () => {
      it('should return success: true when command succeeds', async () => {
        const service = createMockService({
          runCommand: vi.fn().mockResolvedValue({
            exitCode: 0,
            output: 'ok',
            success: true,
          } satisfies CommandResult),
        });
        const runtime = new SkillsExecutionRuntime({ service });

        const result = await runtime.execScript(args);

        expect(result.success).toBe(true);
        expect(result.content).toBe('ok');
      });

      it('should return success: false when command fails with non-zero exit code', async () => {
        const service = createMockService({
          runCommand: vi.fn().mockResolvedValue({
            exitCode: 127,
            output: '',
            stderr: 'not found',
            success: false,
          } satisfies CommandResult),
        });
        const runtime = new SkillsExecutionRuntime({ service });

        const result = await runtime.execScript(args);

        expect(result.success).toBe(false);
        expect(result.content).toBe('not found');
        expect(result.state).toEqual({ command: 'echo hello', exitCode: 127, success: false });
      });

      it('should return success: false when runCommand throws', async () => {
        const service = createMockService({
          runCommand: vi.fn().mockRejectedValue(new Error('connection lost')),
        });
        const runtime = new SkillsExecutionRuntime({ service });

        const result = await runtime.execScript(args);

        expect(result.success).toBe(false);
        expect(result.content).toBe('Failed to execute command: connection lost');
      });

      it('should return success: false when neither execScript nor runCommand is available', async () => {
        const service = createMockService();
        const runtime = new SkillsExecutionRuntime({ service });

        const result = await runtime.execScript(args);

        expect(result.success).toBe(false);
        expect(result.content).toBe('Command execution is not available in this environment.');
      });
    });
  });

  describe('readReference', () => {
    it('should expose fullPath in state when provided by the service', async () => {
      const service = createMockService({
        findByName: vi.fn().mockResolvedValue({ id: 'skill-1', name: 'demo-skill' }),
        readResource: vi.fn().mockResolvedValue({
          content: 'print("hello")',
          encoding: 'utf8',
          fileHash: 'hash-1',
          fileType: 'text/x-python',
          fullPath: '/Users/test/lobehub/file-storage/skills/extracted/hash-1/bazi.py',
          path: 'bazi.py',
          size: 14,
        }),
      });
      const runtime = new SkillsExecutionRuntime({ service });

      const result = await runtime.readReference({ id: 'demo-skill', path: 'bazi.py' });

      expect(result.success).toBe(true);
      expect(result.state).toEqual({
        encoding: 'utf8',
        fileType: 'text/x-python',
        fullPath: '/Users/test/lobehub/file-storage/skills/extracted/hash-1/bazi.py',
        path: 'bazi.py',
        size: 14,
      });
    });
  });

  describe('project skills', () => {
    const projectSkill = {
      location: '/repo/.agents/skills/deploy/SKILL.md',
      name: 'deploy',
    };

    it('activateSkill reads SKILL.md and appends a directory hint for lazy discovery', async () => {
      const readFile = vi.fn().mockResolvedValue('# Deploy\nRun the deploy steps.');
      const runtime = new SkillsExecutionRuntime({
        deviceFileAccess: { readFile },
        projectSkills: [projectSkill],
        service: createMockService(),
      });

      const result = await runtime.activateSkill({ name: 'deploy' });

      expect(readFile).toHaveBeenCalledWith('/repo/.agents/skills/deploy/SKILL.md');
      expect(result.success).toBe(true);
      expect(result.content).toContain('Run the deploy steps.');
      // The hint points at the skill's directory and instructs the model to
      // call `local-system.listFiles` itself rather than pre-enumerating here.
      expect(result.content).toContain('/repo/.agents/skills/deploy');
      expect(result.content).toContain('listFiles');
      expect(result.state).toMatchObject({ name: 'deploy', source: 'project' });
    });

    it('activateSkill takes precedence over a same-named DB skill', async () => {
      const readFile = vi.fn().mockResolvedValue('project content');
      const findByName = vi
        .fn()
        .mockResolvedValue({ content: 'db content', id: 'x', name: 'deploy' });
      const runtime = new SkillsExecutionRuntime({
        deviceFileAccess: { readFile },
        projectSkills: [projectSkill],
        service: createMockService({ findByName }),
      });

      const result = await runtime.activateSkill({ name: 'deploy' });

      expect(result.content).toContain('project content');
      expect(findByName).not.toHaveBeenCalled();
    });

    it('activateSkill fails clearly when no device file access is available', async () => {
      const runtime = new SkillsExecutionRuntime({
        projectSkills: [projectSkill],
        service: createMockService(),
      });

      const result = await runtime.activateSkill({ name: 'deploy' });

      expect(result.success).toBe(false);
      expect(result.content).toContain('no device file access');
    });

    it('readReference resolves a project file relative to the SKILL.md directory', async () => {
      const readFile = vi.fn().mockResolvedValue('print("run")');
      const runtime = new SkillsExecutionRuntime({
        deviceFileAccess: { readFile },
        projectSkills: [projectSkill],
        service: createMockService(),
      });

      const result = await runtime.readReference({ id: 'deploy', path: 'scripts/run.py' });

      expect(readFile).toHaveBeenCalledWith('/repo/.agents/skills/deploy/scripts/run.py');
      expect(result.success).toBe(true);
      expect(result.content).toBe('print("run")');
    });
  });
});
