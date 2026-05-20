import { readFile } from 'node:fs/promises';

import { readdir } from 'fs-extra';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { detectRepoType } from '../git';

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
}));

vi.mock('fs-extra', () => ({
  readdir: vi.fn(),
}));

const eisdir = () => Object.assign(new Error('EISDIR'), { code: 'EISDIR' });
const enoent = () => Object.assign(new Error('ENOENT'), { code: 'ENOENT' });

// Stub a flat (non-worktree) git repo at /repo whose config is `config`.
const stubRepo = (config: string) => {
  vi.mocked(readFile).mockImplementation(async (filePath) => {
    const p = String(filePath);
    if (p.endsWith('/.git')) throw eisdir(); // .git is a directory
    if (p.endsWith('/commondir')) throw enoent(); // no commondir → use gitDir
    if (p.endsWith('/config')) return config;
    throw new Error(`unexpected readFile: ${p}`);
  });
  vi.mocked(readdir).mockResolvedValue(['HEAD', 'config'] as any);
};

describe('detectRepoType', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it.each([
    ['SCP-like SSH', '[remote "origin"]\n\turl = git@github.com:owner/repo.git\n'],
    ['HTTPS', '[remote "origin"]\n\turl = https://github.com/owner/repo.git\n'],
    ['ssh:// scheme', '[remote "origin"]\n\turl = ssh://git@github.com/owner/repo.git\n'],
    ['git:// scheme', '[remote "origin"]\n\turl = git://github.com/owner/repo.git\n'],
  ])('classifies %s remote as github', async (_label, config) => {
    stubRepo(config);
    await expect(detectRepoType('/repo')).resolves.toBe('github');
  });

  it.each([
    ['look-alike host', '[remote "origin"]\n\turl = git@evilgithub.com:owner/repo.git\n'],
    ['suffix injection', '[remote "origin"]\n\turl = https://github.com.attacker.com/x.git\n'],
    [
      'github.com inside path of unrelated host',
      '[remote "origin"]\n\turl = https://attacker.com/?ref=github.com/x\n',
    ],
    ['GitHub Enterprise', '[remote "origin"]\n\turl = git@github.example.com:owner/repo.git\n'],
    ['no remote at all', '[core]\n\trepositoryformatversion = 0\n'],
  ])('does not misclassify %s as github', async (_label, config) => {
    stubRepo(config);
    await expect(detectRepoType('/repo')).resolves.toBe('git');
  });

  it('returns undefined when there is no .git', async () => {
    vi.mocked(readFile).mockRejectedValue(enoent());
    vi.mocked(readdir).mockRejectedValue(enoent());
    await expect(detectRepoType('/not-a-repo')).resolves.toBeUndefined();
  });
});
