import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { log } from '../utils/logger';
import { registerSkillCommand } from './skill';

const { mockTrpcClient } = vi.hoisted(() => ({
  mockTrpcClient: {
    agentSkills: {
      create: { mutate: vi.fn() },
      delete: { mutate: vi.fn() },
      getById: { query: vi.fn() },
      importFromGitHub: { mutate: vi.fn() },
      importFromMarket: { mutate: vi.fn() },
      importFromUrl: { mutate: vi.fn() },
      list: { query: vi.fn() },
      listResources: { query: vi.fn() },
      readResource: { query: vi.fn() },
      search: { query: vi.fn() },
      update: { mutate: vi.fn() },
    },
  },
}));

const { getTrpcClient: mockGetTrpcClient } = vi.hoisted(() => ({
  getTrpcClient: vi.fn(),
}));

vi.mock('../api/client', () => ({ getTrpcClient: mockGetTrpcClient }));
vi.mock('../utils/logger', () => ({
  log: { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() },
  setVerbose: vi.fn(),
}));

describe('skill command', () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let consoleSpy: ReturnType<typeof vi.spyOn>;
  let stdoutSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    mockGetTrpcClient.mockResolvedValue(mockTrpcClient);
    for (const method of Object.values(mockTrpcClient.agentSkills)) {
      for (const fn of Object.values(method)) {
        (fn as ReturnType<typeof vi.fn>).mockReset();
      }
    }
  });

  afterEach(() => {
    exitSpy.mockRestore();
    consoleSpy.mockRestore();
    stdoutSpy.mockRestore();
  });

  function createProgram() {
    const program = new Command();
    program.exitOverride();
    registerSkillCommand(program);
    return program;
  }

  describe('list', () => {
    it('should display skills in table format', async () => {
      mockTrpcClient.agentSkills.list.query.mockResolvedValue([
        {
          description: 'A skill',
          id: 's1',
          identifier: 'test-skill',
          name: 'Test Skill',
          source: 'user',
        },
      ]);

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'skill', 'list']);

      expect(consoleSpy).toHaveBeenCalledTimes(2); // header + 1 row
      expect(consoleSpy.mock.calls[0][0]).toContain('ID');
    });

    it('should output JSON when --json flag is used', async () => {
      const items = [{ id: 's1', name: 'Test' }];
      mockTrpcClient.agentSkills.list.query.mockResolvedValue(items);

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'skill', 'list', '--json']);

      expect(consoleSpy).toHaveBeenCalledWith(JSON.stringify(items, null, 2));
    });

    it('should filter by source', async () => {
      mockTrpcClient.agentSkills.list.query.mockResolvedValue([]);

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'skill', 'list', '--source', 'builtin']);

      expect(mockTrpcClient.agentSkills.list.query).toHaveBeenCalledWith(
        expect.objectContaining({ source: 'builtin' }),
      );
    });

    it('should reject invalid source', async () => {
      const program = createProgram();
      await program.parseAsync(['node', 'test', 'skill', 'list', '--source', 'invalid']);

      expect(log.error).toHaveBeenCalledWith(expect.stringContaining('Invalid source'));
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it('should show message when no skills found', async () => {
      mockTrpcClient.agentSkills.list.query.mockResolvedValue([]);

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'skill', 'list']);

      expect(consoleSpy).toHaveBeenCalledWith('No skills found.');
    });
  });

  describe('view', () => {
    it('should display skill details', async () => {
      mockTrpcClient.agentSkills.getById.query.mockResolvedValue({
        content: 'Skill content here',
        description: 'A test skill',
        id: 's1',
        name: 'Test Skill',
        source: 'user',
      });

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'skill', 'view', 's1']);

      expect(mockTrpcClient.agentSkills.getById.query).toHaveBeenCalledWith({ id: 's1' });
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Test Skill'));
    });

    it('should exit when not found', async () => {
      mockTrpcClient.agentSkills.getById.query.mockResolvedValue(null);

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'skill', 'view', 'nonexistent']);

      expect(log.error).toHaveBeenCalledWith(expect.stringContaining('not found'));
      expect(exitSpy).toHaveBeenCalledWith(1);
    });
  });

  describe('create', () => {
    it('should create a skill', async () => {
      mockTrpcClient.agentSkills.create.mutate.mockResolvedValue({ id: 'new-skill' });

      const program = createProgram();
      await program.parseAsync([
        'node',
        'test',
        'skill',
        'create',
        '--name',
        'My Skill',
        '--description',
        'A skill',
        '--content',
        'Do something',
      ]);

      expect(mockTrpcClient.agentSkills.create.mutate).toHaveBeenCalledWith(
        expect.objectContaining({
          content: 'Do something',
          description: 'A skill',
          name: 'My Skill',
        }),
      );
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('new-skill'));
    });
  });

  describe('edit', () => {
    it('should update skill content', async () => {
      mockTrpcClient.agentSkills.update.mutate.mockResolvedValue({});

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'skill', 'edit', 's1', '--content', 'updated']);

      expect(mockTrpcClient.agentSkills.update.mutate).toHaveBeenCalledWith(
        expect.objectContaining({ content: 'updated', id: 's1' }),
      );
    });

    it('should exit when no changes specified', async () => {
      const program = createProgram();
      await program.parseAsync(['node', 'test', 'skill', 'edit', 's1']);

      expect(log.error).toHaveBeenCalledWith(expect.stringContaining('No changes'));
      expect(exitSpy).toHaveBeenCalledWith(1);
    });
  });

  describe('delete', () => {
    it('should delete with --yes', async () => {
      mockTrpcClient.agentSkills.delete.mutate.mockResolvedValue({});

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'skill', 'delete', 's1', '--yes']);

      expect(mockTrpcClient.agentSkills.delete.mutate).toHaveBeenCalledWith({ id: 's1' });
    });
  });

  describe('search', () => {
    it('should search skills', async () => {
      mockTrpcClient.agentSkills.search.query.mockResolvedValue([
        { description: 'A skill', id: 's1', name: 'Found Skill' },
      ]);

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'skill', 'search', 'test']);

      expect(mockTrpcClient.agentSkills.search.query).toHaveBeenCalledWith({ query: 'test' });
      expect(consoleSpy).toHaveBeenCalledTimes(2); // header + 1 row
    });

    it('should show message when no results', async () => {
      mockTrpcClient.agentSkills.search.query.mockResolvedValue([]);

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'skill', 'search', 'nothing']);

      expect(consoleSpy).toHaveBeenCalledWith('No skills found.');
    });
  });

  describe('import-github', () => {
    it('should import from GitHub', async () => {
      mockTrpcClient.agentSkills.importFromGitHub.mutate.mockResolvedValue({
        id: 'imported',
        name: 'GH Skill',
      });

      const program = createProgram();
      await program.parseAsync([
        'node',
        'test',
        'skill',
        'import-github',
        '--url',
        'https://github.com/user/repo',
      ]);

      expect(mockTrpcClient.agentSkills.importFromGitHub.mutate).toHaveBeenCalledWith(
        expect.objectContaining({ gitUrl: 'https://github.com/user/repo' }),
      );
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Imported'));
    });
  });

  describe('import-market', () => {
    it('should install from marketplace', async () => {
      mockTrpcClient.agentSkills.importFromMarket.mutate.mockResolvedValue({ id: 'mk1' });

      const program = createProgram();
      await program.parseAsync([
        'node',
        'test',
        'skill',
        'import-market',
        '--identifier',
        'some-skill',
      ]);

      expect(mockTrpcClient.agentSkills.importFromMarket.mutate).toHaveBeenCalledWith({
        identifier: 'some-skill',
      });
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('some-skill'));
    });
  });

  describe('resources', () => {
    it('should list resources', async () => {
      mockTrpcClient.agentSkills.listResources.query.mockResolvedValue([
        { name: 'file.txt', size: 1024, type: 'text' },
      ]);

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'skill', 'resources', 's1']);

      expect(mockTrpcClient.agentSkills.listResources.query).toHaveBeenCalledWith({ id: 's1' });
      expect(consoleSpy).toHaveBeenCalledTimes(2); // header + 1 row
    });

    it('should show message when no resources', async () => {
      mockTrpcClient.agentSkills.listResources.query.mockResolvedValue([]);

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'skill', 'resources', 's1']);

      expect(consoleSpy).toHaveBeenCalledWith('No resources found.');
    });
  });

  describe('read-resource', () => {
    it('should output resource content', async () => {
      mockTrpcClient.agentSkills.readResource.query.mockResolvedValue({
        content: 'file contents here',
      });

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'skill', 'read-resource', 's1', 'file.txt']);

      expect(mockTrpcClient.agentSkills.readResource.query).toHaveBeenCalledWith({
        id: 's1',
        path: 'file.txt',
      });
      expect(stdoutSpy).toHaveBeenCalledWith('file contents here');
    });

    it('should exit when resource not found', async () => {
      mockTrpcClient.agentSkills.readResource.query.mockResolvedValue(null);

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'skill', 'read-resource', 's1', 'missing.txt']);

      expect(log.error).toHaveBeenCalledWith(expect.stringContaining('not found'));
      expect(exitSpy).toHaveBeenCalledWith(1);
    });
  });
});
