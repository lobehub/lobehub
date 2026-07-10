import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { type App } from '@/core/App';

import WorkspaceCtr from '../WorkspaceCtr';

const { ipcMainHandleMock } = vi.hoisted(() => ({
  ipcMainHandleMock: vi.fn(),
}));

vi.mock('@/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  }),
}));

vi.mock('electron', () => ({
  ipcMain: {
    handle: ipcMainHandleMock,
  },
}));

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
  readdir: vi.fn(),
}));

vi.mock('@lobechat/local-file-shell', () => ({
  detectRepoType: vi.fn(async () => undefined),
}));

const mockLocalFileProtocolManager = {
  approveIndexedProjectRoot: vi.fn(),
};

const mockApp = {
  localFileProtocolManager: mockLocalFileProtocolManager,
} as unknown as App;

describe('WorkspaceCtr', () => {
  let workspaceCtr: WorkspaceCtr;
  let mockFsPromises: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.stubEnv('HOME', '/device-home');
    mockFsPromises = await import('node:fs/promises');
    workspaceCtr = new WorkspaceCtr(mockApp);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  const dirent = (name: string, kind: 'dir' | 'file') => ({
    isDirectory: () => kind === 'dir',
    isFile: () => kind === 'file',
    isSymbolicLink: () => false,
    name,
  });

  const frontmatter = (name: string, description: string) =>
    `---\nname: ${name}\ndescription: ${description}\n---\nbody`;

  describe('initWorkspace', () => {
    it('merges skills from both sources and reads instruction files', async () => {
      vi.mocked(mockFsPromises.readdir).mockImplementation(async (dir: string) => {
        if (dir === '/proj/.agents/skills') return [dirent('spa-routes', 'dir')];
        if (dir === '/proj/.agents/skills/spa-routes') return [dirent('SKILL.md', 'file')];
        if (dir === '/proj/.claude/skills') return [dirent('reviewer', 'dir')];
        if (dir === '/proj/.claude/skills/reviewer') return [dirent('SKILL.md', 'file')];
        throw new Error('ENOENT');
      });
      vi.mocked(mockFsPromises.readFile).mockImplementation(async (file: string) => {
        if (file === '/proj/.agents/skills/spa-routes/SKILL.md')
          return frontmatter('spa-routes', 'SPA routing');
        if (file === '/proj/.claude/skills/reviewer/SKILL.md')
          return frontmatter('reviewer', 'Code review');
        if (file === '/proj/AGENTS.md') return '# Agents';
        if (file === '/proj/CLAUDE.md') return '# Claude';
        throw new Error('ENOENT');
      });

      const result = await workspaceCtr.initWorkspace({ scope: '/proj' });

      expect(result.skills.map((s) => s.name)).toEqual(['reviewer', 'spa-routes']);
      expect(result.instructions).toEqual([
        { content: '# Agents', source: 'AGENTS.md' },
        { content: '# Claude', source: 'CLAUDE.md' },
      ]);
      // Approves the scanned root for the lobe-file:// preview protocol.
      expect(mockLocalFileProtocolManager.approveIndexedProjectRoot).toHaveBeenCalledWith('/proj');
    });

    it('dedupes skills by name with .agents/skills winning', async () => {
      vi.mocked(mockFsPromises.readdir).mockImplementation(async (dir: string) => {
        if (dir === '/proj/.agents/skills') return [dirent('shared', 'dir')];
        if (dir === '/proj/.claude/skills') return [dirent('shared', 'dir')];
        if (dir.endsWith('/shared')) return [dirent('SKILL.md', 'file')];
        throw new Error('ENOENT');
      });
      vi.mocked(mockFsPromises.readFile).mockImplementation(async (file: string) => {
        if (file === '/proj/.agents/skills/shared/SKILL.md')
          return frontmatter('shared', 'from agents');
        if (file === '/proj/.claude/skills/shared/SKILL.md')
          return frontmatter('shared', 'from claude');
        throw new Error('ENOENT');
      });

      const result = await workspaceCtr.initWorkspace({ scope: '/proj' });

      expect(result.skills).toHaveLength(1);
      expect(result.skills[0]).toMatchObject({
        description: 'from agents',
        path: '/proj/.agents/skills/shared/SKILL.md',
      });
    });

    it('merges execution-device skills and keeps project skills first on duplicate names', async () => {
      vi.mocked(mockFsPromises.readdir).mockImplementation(async (dir: string) => {
        if (dir === '/proj/.agents/skills') return [dirent('shared', 'dir')];
        if (dir === '/proj/.agents/skills/shared') return [dirent('SKILL.md', 'file')];
        if (dir === '/device-home/.agents/skills')
          return [dirent('device-writer', 'dir'), dirent('shared', 'dir')];
        if (dir === '/device-home/.agents/skills/device-writer')
          return [dirent('SKILL.md', 'file')];
        if (dir === '/device-home/.agents/skills/shared') return [dirent('SKILL.md', 'file')];
        throw new Error('ENOENT');
      });
      vi.mocked(mockFsPromises.readFile).mockImplementation(async (file: string) => {
        if (file === '/proj/.agents/skills/shared/SKILL.md')
          return frontmatter('shared', 'from project');
        if (file === '/device-home/.agents/skills/device-writer/SKILL.md')
          return frontmatter('device-writer', 'from device');
        if (file === '/device-home/.agents/skills/shared/SKILL.md')
          return frontmatter('shared', 'from device');
        throw new Error('ENOENT');
      });

      const result = await workspaceCtr.listProjectSkills({ scope: '/proj' });

      expect(result.skills.map((skill) => `${skill.name}:${skill.scope}`)).toEqual([
        'device-writer:device',
        'shared:project',
      ]);
      expect(result.skills.find((skill) => skill.name === 'device-writer')).toMatchObject({
        previewRoot: '/device-home/.agents/skills',
        scope: 'device',
      });
      expect(mockLocalFileProtocolManager.approveIndexedProjectRoot).toHaveBeenCalledWith('/proj');
      expect(mockLocalFileProtocolManager.approveIndexedProjectRoot).toHaveBeenCalledWith(
        '/device-home/.agents/skills',
      );
    });

    it('caps instruction file content', async () => {
      vi.mocked(mockFsPromises.readdir).mockRejectedValue(new Error('ENOENT'));
      const huge = 'x'.repeat(100 * 1024);
      vi.mocked(mockFsPromises.readFile).mockImplementation(async (file: string) => {
        if (file === '/proj/AGENTS.md') return huge;
        throw new Error('ENOENT');
      });

      const result = await workspaceCtr.initWorkspace({ scope: '/proj' });

      expect(result.skills).toEqual([]);
      expect(result.instructions).toHaveLength(1);
      expect(result.instructions[0].content.length).toBe(64 * 1024);
    });

    it('returns empty skills and instructions when nothing is present', async () => {
      vi.mocked(mockFsPromises.readdir).mockRejectedValue(new Error('ENOENT'));
      vi.mocked(mockFsPromises.readFile).mockRejectedValue(new Error('ENOENT'));

      const result = await workspaceCtr.initWorkspace({ scope: '/proj' });

      expect(result).toEqual({ instructions: [], root: '/proj', skills: [] });
    });
  });

  describe('listProjectSkills', () => {
    it('returns the first source with skills (.agents/skills wins) and ignores .claude', async () => {
      vi.mocked(mockFsPromises.readdir).mockImplementation(async (dir: string) => {
        if (dir === '/proj/.agents/skills') return [dirent('alpha', 'dir')];
        if (dir === '/proj/.agents/skills/alpha') return [dirent('SKILL.md', 'file')];
        throw new Error('ENOENT');
      });
      vi.mocked(mockFsPromises.readFile).mockResolvedValue(frontmatter('alpha', 'A'));

      const result = await workspaceCtr.listProjectSkills({ scope: '/proj' });

      expect(result.source).toBe('.agents/skills');
      expect(result.skills.map((s) => s.name)).toEqual(['alpha']);
    });

    it('parses folded block scalar descriptions', async () => {
      vi.mocked(mockFsPromises.readdir).mockImplementation(async (dir: string) => {
        if (dir === '/proj/.agents/skills') return [dirent('agent-testing', 'dir')];
        if (dir === '/proj/.agents/skills/agent-testing') return [dirent('SKILL.md', 'file')];
        throw new Error('ENOENT');
      });
      vi.mocked(mockFsPromises.readFile).mockResolvedValue(
        [
          '---',
          'name: agent-testing',
          'description: >',
          '  Agentic end-to-end testing for LobeHub: backend verification via the CLI,',
          '  frontend verification via agent-browser (Electron).',
          '---',
          'body',
        ].join('\n'),
      );

      const result = await workspaceCtr.listProjectSkills({ scope: '/proj' });

      expect(result.skills[0]).toMatchObject({
        description:
          'Agentic end-to-end testing for LobeHub: backend verification via the CLI, frontend verification via agent-browser (Electron).',
        name: 'agent-testing',
      });
    });

    it('returns empty + null source when no skills exist', async () => {
      vi.mocked(mockFsPromises.readdir).mockRejectedValue(new Error('ENOENT'));

      const result = await workspaceCtr.listProjectSkills({ scope: '/proj' });

      expect(result).toEqual({ root: '/proj', skills: [], source: null });
    });
  });
});
