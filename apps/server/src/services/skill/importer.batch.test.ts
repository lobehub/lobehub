// @vitest-environment node
import type { LobeChatDatabase } from '@lobechat/database';
import type { ParsedBatchSkill } from '@lobechat/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SkillImportError, SkillParseError } from './errors';
import { SkillImporter } from './importer';

const mocks = vi.hoisted(() => ({
  cleanup: vi.fn(),
  create: vi.fn(),
  createGlobalFile: vi.fn(),
  downloadFileToLocal: vi.fn(),
  findByName: vi.fn(),
  parseZipPackageBatch: vi.fn(),
  readFile: vi.fn(),
  storeResources: vi.fn(),
  update: vi.fn(),
  uploadBuffer: vi.fn(),
}));

vi.mock('@/database/models/agentSkill', () => ({
  AgentSkillModel: class {
    create = mocks.create;
    findByName = mocks.findByName;
    update = mocks.update;
  },
}));

vi.mock('@/server/modules/GitHub', () => ({
  GitHub: class {},
  GitHubNotFoundError: class extends Error {},
  GitHubParseError: class extends Error {},
}));

vi.mock('@/server/services/file', () => ({
  FileService: class {
    createGlobalFile = mocks.createGlobalFile;
    downloadFileToLocal = mocks.downloadFileToLocal;
    uploadBuffer = mocks.uploadBuffer;
  },
}));

vi.mock('./resource', () => ({
  SkillResourceService: class {
    storeResources = mocks.storeResources;
  },
}));

vi.mock('./parser', () => ({
  SkillParser: class {
    parseZipPackageBatch = mocks.parseZipPackageBatch;
  },
}));

vi.mock('node:fs/promises', () => ({ readFile: mocks.readFile }));

vi.mock('@lobechat/ssrf-safe-fetch', () => ({ ssrfSafeFetch: vi.fn() }));

const makeSkill = (
  path: string,
  name: string,
  overrides: Partial<ParsedBatchSkill> = {},
): ParsedBatchSkill => ({
  content: `# ${name}`,
  manifest: { description: `${name} description`, name },
  path,
  resources: new Map([['README.md', Buffer.from(name)]]),
  skillZipBuffer: Buffer.from(`zip-${path}`),
  zipHash: `hash-${path}`,
  ...overrides,
});

const makeExisting = (
  name: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> => ({
  content: `# old ${name}`,
  id: `existing-${name}`,
  identifier: `user.${name}`,
  manifest: { description: `${name} description`, name },
  name,
  source: 'user',
  updatedAt: new Date('2026-01-01T00:00:00Z'),
  userId: 'owner',
  zipFileHash: `old-hash-${name}`,
  ...overrides,
});

const importer = (workspaceRole?: string) =>
  workspaceRole
    ? new SkillImporter({} as LobeChatDatabase, 'member', 'workspace', { workspaceRole })
    : new SkillImporter({} as LobeChatDatabase, 'member');

beforeEach(() => {
  vi.clearAllMocks();

  mocks.cleanup.mockReturnValue(undefined);
  mocks.downloadFileToLocal.mockResolvedValue({
    cleanup: mocks.cleanup,
    filePath: '/tmp/batch.zip',
  });
  mocks.readFile.mockResolvedValue(Buffer.from('zip-buffer'));
  mocks.parseZipPackageBatch.mockResolvedValue({ failures: [], skills: [] });
  mocks.findByName.mockResolvedValue(undefined);
  mocks.storeResources.mockResolvedValue({});
  mocks.uploadBuffer.mockResolvedValue(undefined);
  mocks.createGlobalFile.mockResolvedValue({ fileHash: 'hash' });
  mocks.create.mockImplementation(async (data: Record<string, unknown>) => ({
    ...data,
    id: `created-${String(data.name)}`,
  }));
  mocks.update.mockImplementation(async (id: string, data: Record<string, unknown>) => ({
    ...data,
    id,
    name: data.name,
  }));
});

describe('SkillImporter.previewBatchImport', () => {
  it('reports conflicts, duplicates and unreadable folders', async () => {
    mocks.parseZipPackageBatch.mockResolvedValue({
      failures: [{ message: 'Invalid skill manifest', path: 'broken' }],
      skills: [makeSkill('a', 'Existing'), makeSkill('b', 'New'), makeSkill('c', 'Existing')],
    });
    mocks.findByName.mockImplementation(async (name: string) =>
      name === 'Existing' ? makeExisting('Existing') : undefined,
    );

    const preview = await importer().previewBatchImport({ zipFileId: 'zip' });

    expect(preview.candidates.map((candidate) => candidate.path)).toEqual([
      'a',
      'b',
      'broken',
      'c',
    ]);
    expect(preview.conflictCount).toBe(2);
    expect(preview.invalidCount).toBe(1);

    const byPath = new Map(preview.candidates.map((candidate) => [candidate.path, candidate]));
    expect(byPath.get('a')?.conflict).toMatchObject({ identifier: 'user.Existing' });
    expect(byPath.get('b')?.conflict).toBeUndefined();
    expect(byPath.get('c')?.duplicateOf).toBe('a');
    expect(byPath.get('broken')).toMatchObject({
      error: 'Invalid skill manifest',
      name: 'broken',
      resourceCount: 0,
    });
    expect(mocks.cleanup).toHaveBeenCalledTimes(1);
  });

  it('wraps a parse failure as an invalid package and still cleans the temp file', async () => {
    mocks.parseZipPackageBatch.mockRejectedValue(
      new SkillParseError('SKILL.md not found in zip package'),
    );

    await expect(importer().previewBatchImport({ zipFileId: 'zip' })).rejects.toMatchObject({
      code: 'INVALID_PACKAGE',
      message: 'SKILL.md not found in zip package',
    });
    expect(mocks.cleanup).toHaveBeenCalledTimes(1);
  });
});

describe('SkillImporter.importFromZipBatch', () => {
  it('creates new skills, overwrites by choice, and skips conflicts by default', async () => {
    const newSkill = makeSkill('a', 'New Skill');
    const skippedSkill = makeSkill('b', 'Skip Skill');
    const overwrittenSkill = makeSkill('c', 'Overwrite Skill');
    const unchangedSkill = makeSkill('d', 'Unchanged Skill');

    mocks.parseZipPackageBatch.mockResolvedValue({
      failures: [],
      skills: [newSkill, skippedSkill, overwrittenSkill, unchangedSkill],
    });
    mocks.findByName.mockImplementation(async (name: string) => {
      if (name === 'Skip Skill') return makeExisting(name);
      if (name === 'Overwrite Skill') return makeExisting(name);
      if (name === 'Unchanged Skill') {
        return makeExisting(name, {
          content: unchangedSkill.content,
          zipFileHash: unchangedSkill.zipHash,
        });
      }
      return undefined;
    });

    const result = await importer().importFromZipBatch({
      skills: [
        { onConflict: 'skip', path: 'a' },
        { onConflict: 'skip', path: 'b' },
        { onConflict: 'overwrite', path: 'c' },
        { onConflict: 'overwrite', path: 'd' },
      ],
      zipFileId: 'zip',
    });

    expect(result.results.map((item) => [item.path, item.status])).toEqual([
      ['a', 'created'],
      ['b', 'skipped'],
      ['c', 'updated'],
      ['d', 'unchanged'],
    ]);
    expect(result.summary).toEqual({
      created: 1,
      failed: 0,
      skipped: 1,
      unchanged: 1,
      updated: 1,
    });

    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining({
        content: newSkill.content,
        identifier: expect.stringMatching(/^user\./),
        name: 'New Skill',
        source: 'user',
        zipFileHash: newSkill.zipHash,
      }),
    );
    expect(mocks.update).toHaveBeenCalledTimes(1);
    expect(mocks.update).toHaveBeenCalledWith(
      'existing-Overwrite Skill',
      expect.objectContaining({
        name: 'Overwrite Skill',
        zipFileHash: overwrittenSkill.zipHash,
      }),
    );
    expect(mocks.uploadBuffer).toHaveBeenCalledTimes(2);
    expect(mocks.createGlobalFile).toHaveBeenCalledTimes(2);
    expect(mocks.cleanup).toHaveBeenCalledTimes(1);
  });

  it('reports unselected candidates as skipped and selected invalid ones as failed', async () => {
    const selected = makeSkill('a', 'Selected');
    const unselected = makeSkill('b', 'Unselected');
    mocks.parseZipPackageBatch.mockResolvedValue({
      failures: [{ message: 'Invalid skill manifest', path: 'broken' }],
      skills: [selected, unselected],
    });

    const result = await importer().importFromZipBatch({
      skills: [
        { onConflict: 'skip', path: 'a' },
        { onConflict: 'skip', path: 'broken' },
      ],
      zipFileId: 'zip',
    });

    expect(result.results.map((item) => [item.path, item.status])).toEqual([
      ['a', 'created'],
      ['b', 'skipped'],
      ['broken', 'failed'],
    ]);
    expect(result.results.find((item) => item.path === 'broken')?.error).toBe(
      'Invalid skill manifest',
    );
    expect(result.summary).toEqual({
      created: 1,
      failed: 1,
      skipped: 1,
      unchanged: 0,
      updated: 0,
    });
  });

  it('keeps importing the other skills when one package fails to store', async () => {
    const good = makeSkill('good', 'Good Skill');
    const bad = makeSkill('bad', 'Bad Skill');
    mocks.parseZipPackageBatch.mockResolvedValue({ failures: [], skills: [bad, good] });
    mocks.storeResources.mockImplementation(async (hash: string) => {
      if (hash === bad.zipHash) throw new Error('upload failed');
      return {};
    });

    const result = await importer().importFromZipBatch({
      skills: [
        { onConflict: 'skip', path: 'bad' },
        { onConflict: 'skip', path: 'good' },
      ],
      zipFileId: 'zip',
    });

    expect(result.results.map((item) => [item.path, item.status])).toEqual([
      ['bad', 'failed'],
      ['good', 'created'],
    ]);
    expect(result.results[0].error).toBe('upload failed');
    expect(result.summary).toEqual({
      created: 1,
      failed: 1,
      skipped: 0,
      unchanged: 0,
      updated: 0,
    });
  });

  it('refuses to overwrite a skill owned by another workspace member', async () => {
    const skill = makeSkill('a', 'Shared Skill');
    mocks.parseZipPackageBatch.mockResolvedValue({ failures: [], skills: [skill] });
    mocks.findByName.mockResolvedValue(makeExisting('Shared Skill', { userId: 'someone-else' }));

    const result = await importer('member').importFromZipBatch({
      skills: [{ onConflict: 'overwrite', path: 'a' }],
      zipFileId: 'zip',
    });

    expect(result.results[0].status).toBe('failed');
    expect(result.results[0].error).toContain('Only the creator or a workspace owner');
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.storeResources).not.toHaveBeenCalled();
  });

  it('rejects a concurrent name conflict with a failed result instead of aborting', async () => {
    const skill = makeSkill('a', 'Raced Skill');
    mocks.parseZipPackageBatch.mockResolvedValue({ failures: [], skills: [skill] });
    mocks.create.mockRejectedValue(
      new SkillImportError('Skill with name "Raced Skill" already exists', 'CONFLICT'),
    );

    const result = await importer().importFromZipBatch({
      skills: [{ onConflict: 'skip', path: 'a' }],
      zipFileId: 'zip',
    });

    expect(result.results[0]).toMatchObject({
      error: 'Skill with name "Raced Skill" already exists',
      status: 'failed',
    });
    expect(result.summary.failed).toBe(1);
  });
});
