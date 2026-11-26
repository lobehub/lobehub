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
  describe.each(['runCommand', 'execScript'] as const)('%s sandbox recreation', (api) => {
    it.each([true, false])('reports workspace loss when command success is %s', async (success) => {
      const commandResult = {
        exitCode: success ? 0 : 1,
        output: 'command output',
        sessionExpiredAndRecreated: true,
        stderr: success ? undefined : 'missing input file',
        success,
      } satisfies CommandResult;
      const runtime = new SkillsExecutionRuntime({
        service: createMockService({ [api]: vi.fn().mockResolvedValue(commandResult) }),
      });

      const result = await runtime[api]({ command: 'cat /tmp/input', description: 'Read input' });

      expect(result.content).toContain('sandbox session expired and was recreated');
      expect(result.content).toContain('Inform the user and ask before regenerating previous work');
      expect(result.content).toContain('command output');
      expect(result.state).toMatchObject({ sessionExpiredAndRecreated: true, success });
      expect(result.success).toBe(success);
    });
  });

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

        expect(result.content).toBe('Command completed successfully.\n\n(no output)');
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

      it('should fall back to constructor activatedSkills when args carry none', async () => {
        const execScript = vi.fn().mockResolvedValue({
          exitCode: 0,
          output: 'ok',
          success: true,
        } satisfies CommandResult);
        const contextSkills = [{ description: 'PDF tools', id: 'skl_1', name: 'pdf' }];
        const runtime = new SkillsExecutionRuntime({
          activatedSkills: contextSkills,
          service: createMockService({ execScript }),
        });

        await runtime.execScript(args);

        expect(execScript).toHaveBeenCalledWith('echo hello', {
          activatedSkills: contextSkills,
          description: 'test command',
        });
      });

      it('should prefer args activatedSkills over the constructor fallback', async () => {
        const execScript = vi.fn().mockResolvedValue({
          exitCode: 0,
          output: 'ok',
          success: true,
        } satisfies CommandResult);
        const argsSkills = [{ id: 'skl_2', name: 'xlsx' }];
        const runtime = new SkillsExecutionRuntime({
          activatedSkills: [{ id: 'skl_1', name: 'pdf' }],
          service: createMockService({ execScript }),
        });

        await runtime.execScript({ ...args, activatedSkills: argsSkills });

        expect(execScript).toHaveBeenCalledWith('echo hello', {
          activatedSkills: argsSkills,
          description: 'test command',
        });
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

    it('returns a clear validation error instead of crashing when id is missing (e.g. model passed skillName)', async () => {
      const runtime = new SkillsExecutionRuntime({ service: createMockService() });

      const result = await runtime.readReference({
        path: 'guide.md',
        ...({ skillName: 'demo-skill' } as object),
      } as never);

      expect(result.success).toBe(false);
      expect(result.content).toContain('"id"');
      expect(result.content).not.toContain('toLowerCase');
    });

    it('falls back to findById when id is a DB skill id and normalizes leading ./ in resource paths', async () => {
      const readResource = vi.fn().mockResolvedValue({
        content: '# Guide',
        encoding: 'utf8',
        fileHash: 'h1',
        fileType: 'text/markdown',
        path: 'references/guide.md',
        size: 7,
      });
      const service = createMockService({
        findById: vi.fn().mockResolvedValue({
          id: 'skl_123',
          name: 'demo-skill',
          resources: { 'references/guide.md': { fileHash: 'h1', size: 7 } },
        }),
        findByName: vi.fn().mockResolvedValue(undefined),
        readResource,
      });
      const runtime = new SkillsExecutionRuntime({ service });

      const result = await runtime.readReference({
        id: 'skl_123',
        path: './references/guide.md',
      });

      expect(result.success).toBe(true);
      expect(readResource).toHaveBeenCalledWith('skl_123', 'references/guide.md');
      expect(result.content).toBe('# Guide');
    });

    it('matches builtin skills by identifier and normalizes leading ./ in resource paths', async () => {
      const runtime = new SkillsExecutionRuntime({
        builtinSkills: [
          {
            content: 'main',
            description: 'desc',
            identifier: 'lobe-lobehub',
            name: 'LobeHub',
            resources: { 'references/kb.md': { content: 'kb body', fileHash: 'h', size: 7 } },
            source: 'builtin',
          },
        ],
        service: createMockService(),
      });

      const result = await runtime.readReference({
        id: 'lobe-lobehub',
        path: './references/kb.md',
      });

      expect(result.success).toBe(true);
      expect(result.content).toBe('kb body');
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
      // call `local-system.globFiles` itself rather than pre-enumerating here,
      // and uses the real `id` parameter name for `readReference`.
      expect(result.content).toContain('/repo/.agents/skills/deploy');
      expect(result.content).toContain('globFiles');
      expect(result.content).toContain('id="deploy"');
      expect(result.content).not.toContain('skillName=');
      expect(result.state).toMatchObject({ name: 'deploy', source: 'project' });
    });

    it('activateSkill preserves device source for execution-device skills', async () => {
      const readFile = vi.fn().mockResolvedValue('# Device Writer\nWrite across projects.');
      const listFiles = vi.fn().mockResolvedValue([]);
      const runtime = new SkillsExecutionRuntime({
        deviceFileAccess: { listFiles, readFile },
        projectSkills: [
          {
            location: '/home/.agents/skills/device-writer/SKILL.md',
            name: 'device-writer',
            source: 'device',
          },
        ],
        service: createMockService(),
      });

      const result = await runtime.activateSkill({ name: 'device-writer' });

      expect(readFile).toHaveBeenCalledWith('/home/.agents/skills/device-writer/SKILL.md');
      expect(result.success).toBe(true);
      expect(result.state).toMatchObject({ name: 'device-writer', source: 'device' });
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
      expect(result.content).toContain('Resource not found in filesystem skill');
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

  describe('resolveSkill', () => {
    const userSkill = {
      content: 'PLAN BODY',
      description: 'How each unit is done',
      identifier: 'user-skills:goal-plan-x',
      name: 'user-skills:goal-plan-x',
      resources: {
        'scripts/check.sh': { content: 'echo ok', fileHash: 'h', size: 7 },
      },
      source: 'builtin' as const,
      title: 'Plan',
    };

    it('reads a skill that was not preloaded, once, only when it is asked for', async () => {
      const resolveSkill = vi.fn().mockResolvedValue(userSkill);
      const runtime = new SkillsExecutionRuntime({ resolveSkill, service: createMockService() });
      expect(resolveSkill).not.toHaveBeenCalled();

      const activated = await runtime.activateSkill({ name: 'user-skills:goal-plan-x' });
      expect(activated.success).toBe(true);
      expect(activated.content).toContain('PLAN BODY');
      expect(activated.state).toMatchObject({ source: 'user' });

      const script = await runtime.readReference({
        id: 'user-skills:goal-plan-x',
        path: 'scripts/check.sh',
      } as never);
      expect(script.content).toContain('echo ok');
      expect(resolveSkill).toHaveBeenCalledTimes(1);
    });
  });

  describe('activateSkill not-found candidates', () => {
    it('lists project, DB, builtin/agent, and lazy user-library skills without duplicates', async () => {
      const runtime = new SkillsExecutionRuntime({
        builtinSkills: [
          {
            content: 'builtin body',
            description: 'Builtin artifacts',
            identifier: 'artifacts',
            name: 'artifacts',
            source: 'builtin',
          },
          {
            content: 'shadowed builtin',
            description: 'Old overlap',
            identifier: 'overlap',
            name: 'Overlap',
            source: 'builtin',
          },
          {
            content: 'agent doc body',
            description: 'Agent workflow',
            identifier: 'agent-skills:workflow',
            name: 'agent-skills:workflow',
            source: 'builtin',
          },
        ],
        listAvailableSkills: vi
          .fn()
          .mockResolvedValue([{ description: 'Saved plan', name: 'user-skills:plan' }]),
        projectSkills: [
          {
            description: 'Deploy helper',
            location: '/repo/.agents/skills/deploy/SKILL.md',
            name: 'deploy',
            source: 'project',
          },
        ],
        service: createMockService({
          findAll: vi.fn().mockResolvedValue({
            data: [
              { description: 'User override', id: 'db-1', name: 'overlap' },
              { description: 'PDF helper', id: 'db-2', name: 'pdf' },
            ],
            total: 2,
          }),
        }),
      });

      const result = await runtime.activateSkill({ name: 'nonexistent' });

      expect(result.success).toBe(false);
      expect(result.content).toContain('Skill not found: "nonexistent"');
      const jsonStart = result.content.indexOf('[');
      const candidates = JSON.parse(result.content.slice(jsonStart)) as Array<{
        description?: string;
        name: string;
      }>;
      expect(candidates).toEqual([
        { description: 'Deploy helper', name: 'deploy' },
        { description: 'User override', name: 'overlap' },
        { description: 'PDF helper', name: 'pdf' },
        { description: 'Builtin artifacts', name: 'artifacts' },
        { description: 'Agent workflow', name: 'agent-skills:workflow' },
        { description: 'Saved plan', name: 'user-skills:plan' },
      ]);
    });

    it('caps the list and says how many skills it left out', async () => {
      const runtime = new SkillsExecutionRuntime({
        listAvailableSkills: vi.fn().mockResolvedValue(
          Array.from({ length: 45 }, (_, index) => ({
            description: 'd'.repeat(400),
            name: `user-skills:plan-${index}`,
          })),
        ),
        service: createMockService(),
      });

      const result = await runtime.activateSkill({ name: 'nonexistent' });

      expect(result.content).toMatch(/ \(15 more not listed\)$/);
      const candidates = JSON.parse(
        result.content.slice(result.content.indexOf('['), result.content.lastIndexOf(']') + 1),
      ) as Array<{ description: string; name: string }>;
      expect(candidates).toHaveLength(30);
      expect(candidates[0].name).toBe('user-skills:plan-0');
      expect(candidates[0].description).toHaveLength(160);
    });

    it('lists the skills that resemble the request first, so the cap cannot drop them', async () => {
      const runtime = new SkillsExecutionRuntime({
        listAvailableSkills: vi
          .fn()
          .mockResolvedValue([
            ...Array.from({ length: 40 }, (_, index) => ({ name: `user-skills:plan-${index}` })),
            { name: 'user-skills:weekly-report' },
          ]),
        service: createMockService(),
      });

      const result = await runtime.activateSkill({ name: 'weekly-report' });

      const candidates = JSON.parse(
        result.content.slice(result.content.indexOf('['), result.content.lastIndexOf(']') + 1),
      ) as Array<{ name: string }>;
      expect(candidates[0].name).toBe('user-skills:weekly-report');
      expect(candidates[1].name).toBe('user-skills:plan-0');
    });

    it('does not treat a source prefix or the word "skill" as a resemblance', async () => {
      const runtime = new SkillsExecutionRuntime({
        listAvailableSkills: vi
          .fn()
          .mockResolvedValue([{ name: 'user-skills:plan' }, { name: 'user-skills:report' }]),
        projectSkills: [{ location: '/repo/.agents/skills/deploy/SKILL.md', name: 'deploy' }],
        service: createMockService(),
      });

      const result = await runtime.activateSkill({ name: 'user-skills:typo-skill' });

      const candidates = JSON.parse(result.content.slice(result.content.indexOf('['))) as Array<{
        name: string;
      }>;
      expect(candidates.map((skill) => skill.name)).toEqual([
        'deploy',
        'user-skills:plan',
        'user-skills:report',
      ]);
    });

    it('returns a clear validation error when name is missing', async () => {
      const runtime = new SkillsExecutionRuntime({ service: createMockService() });

      const result = await runtime.activateSkill({} as never);

      expect(result.success).toBe(false);
      expect(result.content).toContain('"name"');
    });
  });
});
