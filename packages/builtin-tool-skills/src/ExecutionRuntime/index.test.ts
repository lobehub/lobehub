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
        expect(result.content).toBe('Command completed successfully.\n\nStdout:\nhello');
        expect(result.state).toEqual({ command: 'echo hello', exitCode: 0, success: true });
      });

      it('should return success: false when script fails with non-zero exit code', async () => {
        const service = createMockService({
          execScript: vi.fn().mockResolvedValue({
            exitCode: 1,
            output: 'command not found',
            success: false,
          } satisfies CommandResult),
        });
        const runtime = new SkillsExecutionRuntime({ service });

        const result = await runtime.execScript(args);

        expect(result.success).toBe(false);
        expect(result.content).toBe(
          'Command failed with exit code 1\n\nStdout:\ncommand not found',
        );
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

        expect(result.content).toBe(
          'Command completed successfully.\n\nStdout:\nstdout line\n\nStderr:\nstderr line',
        );
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

        expect(result.content).toBe('Command completed successfully.');
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
        expect(result.content).toBe('Command completed successfully.\n\nStdout:\nok');
      });

      it('should return success: false when command fails with non-zero exit code', async () => {
        const service = createMockService({
          runCommand: vi.fn().mockResolvedValue({
            exitCode: 127,
            output: 'not found',
            success: false,
          } satisfies CommandResult),
        });
        const runtime = new SkillsExecutionRuntime({ service });

        const result = await runtime.execScript(args);

        expect(result.success).toBe(false);
        expect(result.content).toBe('Command failed with exit code 127\n\nStdout:\nnot found');
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
      const listFiles = vi.fn().mockResolvedValue([]);
      const runtime = new SkillsExecutionRuntime({
        deviceFileAccess: { listFiles, readFile },
        projectSkills: [projectSkill],
        service: createMockService(),
      });

      const result = await runtime.activateSkill({ name: 'deploy' });

      expect(readFile).toHaveBeenCalledWith('/repo/.agents/skills/deploy/SKILL.md');
      expect(result.success).toBe(true);
      expect(result.content).toContain('Run the deploy steps.');
      // The hint points at the skill's directory and instructs the model to
      // call `local-system.globFiles` itself rather than pre-enumerating here.
      expect(result.content).toContain('/repo/.agents/skills/deploy');
      expect(result.content).toContain('globFiles');
      expect(result.state).toMatchObject({ name: 'deploy', source: 'project' });
    });

    it('activateSkill takes precedence over a same-named DB skill', async () => {
      const readFile = vi.fn().mockResolvedValue('project content');
      const listFiles = vi.fn().mockResolvedValue([]);
      const findByName = vi
        .fn()
        .mockResolvedValue({ content: 'db content', id: 'x', name: 'deploy' });
      const runtime = new SkillsExecutionRuntime({
        deviceFileAccess: { listFiles, readFile },
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
      const listFiles = vi.fn().mockResolvedValue(['SKILL.md', 'scripts/run.py']);
      const runtime = new SkillsExecutionRuntime({
        deviceFileAccess: { listFiles, readFile },
        projectSkills: [projectSkill],
        service: createMockService(),
      });

      const result = await runtime.readReference({ id: 'deploy', path: 'scripts/run.py' });

      expect(listFiles).toHaveBeenCalledWith('/repo/.agents/skills/deploy');
      expect(readFile).toHaveBeenCalledWith('/repo/.agents/skills/deploy/scripts/run.py');
      expect(result.success).toBe(true);
      expect(result.content).toBe('print("run")');
    });

    it('readReference rejects paths not in the declared skill file list', async () => {
      const readFile = vi.fn();
      const listFiles = vi.fn().mockResolvedValue(['SKILL.md', 'scripts/run.py']);
      const runtime = new SkillsExecutionRuntime({
        deviceFileAccess: { listFiles, readFile },
        projectSkills: [projectSkill],
        service: createMockService(),
      });

      const result = await runtime.readReference({ id: 'deploy', path: 'secrets.json' });

      expect(listFiles).toHaveBeenCalledWith('/repo/.agents/skills/deploy');
      expect(readFile).not.toHaveBeenCalled();
      expect(result.success).toBe(false);
      expect(result.content).toContain('Resource not found in project skill');
    });

    it('readReference rejects hidden segments before consulting the device', async () => {
      const readFile = vi.fn();
      const listFiles = vi.fn();
      const runtime = new SkillsExecutionRuntime({
        deviceFileAccess: { listFiles, readFile },
        projectSkills: [projectSkill],
        service: createMockService(),
      });

      const result = await runtime.readReference({ id: 'deploy', path: '.env' });

      expect(listFiles).not.toHaveBeenCalled();
      expect(readFile).not.toHaveBeenCalled();
      expect(result.success).toBe(false);
      expect(result.content).toContain('not a permitted skill resource');
    });
  });

  describe('activation precedence', () => {
    it('DB skill wins over a same-named builtin (matches injection dedupe)', async () => {
      const findByName = vi.fn().mockResolvedValue({
        content: 'user-authored content',
        description: 'user skill',
        id: 'user-1',
        name: 'overlap',
      });
      const runtime = new SkillsExecutionRuntime({
        builtinSkills: [
          {
            content: 'builtin content',
            description: 'builtin skill',
            identifier: 'overlap',
            name: 'overlap',
            source: 'builtin',
          },
        ],
        service: createMockService({ findByName }),
      });

      const result = await runtime.activateSkill({ name: 'overlap' });

      expect(findByName).toHaveBeenCalledWith('overlap');
      expect(result.success).toBe(true);
      expect(result.content).toContain('user-authored content');
      expect(result.state).toMatchObject({ name: 'overlap', source: 'user' });
    });

    it('falls through to builtin when no DB skill exists', async () => {
      const findByName = vi.fn().mockResolvedValue(undefined);
      const runtime = new SkillsExecutionRuntime({
        builtinSkills: [
          {
            content: 'builtin only',
            description: 'builtin skill',
            identifier: 'artifacts',
            name: 'artifacts',
            source: 'builtin',
          },
        ],
        service: createMockService({ findByName }),
      });

      const result = await runtime.activateSkill({ name: 'artifacts' });

      expect(result.success).toBe(true);
      expect(result.content).toContain('builtin only');
      expect(result.state).toMatchObject({ name: 'artifacts', source: 'builtin' });
    });
  });

  describe('case-insensitive name matching', () => {
    it('activateSkill matches a builtin regardless of casing', async () => {
      const runtime = new SkillsExecutionRuntime({
        builtinSkills: [
          {
            content: 'browser content',
            description: 'browser',
            identifier: 'lobe-agent-browser',
            name: 'agent-browser',
            source: 'builtin',
          },
        ],
        service: createMockService(),
      });

      for (const name of ['agent-browser', 'Agent-Browser', 'AGENT-BROWSER']) {
        const result = await runtime.activateSkill({ name });
        expect(result.success).toBe(true);
        expect(result.content).toContain('browser content');
      }
    });

    it('activateSkill matches a project skill regardless of casing', async () => {
      const readFile = vi.fn().mockResolvedValue('# project skill body');
      const runtime = new SkillsExecutionRuntime({
        deviceFileAccess: { listFiles: vi.fn(), readFile },
        projectSkills: [{ location: '/work/.agents/skills/my-skill/SKILL.md', name: 'my-skill' }],
        service: createMockService(),
      });

      const result = await runtime.activateSkill({ name: 'My-Skill' });
      expect(result.success).toBe(true);
      expect(result.content).toContain('# project skill body');
      expect(result.state).toMatchObject({ source: 'project' });
    });

    it('readReference matches a builtin regardless of casing', async () => {
      const runtime = new SkillsExecutionRuntime({
        builtinSkills: [
          {
            content: 'main',
            description: '',
            identifier: 'lobehub',
            name: 'lobehub',
            resources: { 'references/kb': { content: 'kb body', fileHash: 'h', size: 7 } },
            source: 'builtin',
          },
        ],
        service: createMockService(),
      });

      const result = await runtime.readReference({ id: 'LobeHub', path: 'references/kb' });
      expect(result.success).toBe(true);
      expect(result.content).toBe('kb body');
    });
  });
});
