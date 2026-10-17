// @vitest-environment node
import type { LobeChatDatabase } from '@lobechat/database';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SkillImporter } from './importer';

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  findByIdentifier: vi.fn(),
  findByName: vi.fn(),
  parseSkillMd: vi.fn(),
  ssrfSafeFetch: vi.fn(),
  update: vi.fn(),
}));
vi.mock('@/database/models/agentSkill', () => ({
  AgentSkillModel: class {
    create = mocks.create;
    findByIdentifier = mocks.findByIdentifier;
    findByName = mocks.findByName;
    update = mocks.update;
  },
}));
vi.mock('@/server/modules/GitHub', () => ({
  GitHub: class {},
  GitHubNotFoundError: class extends Error {},
  GitHubParseError: class extends Error {},
}));
vi.mock('@/server/services/file', () => ({ FileService: class {} }));
vi.mock('./resource', () => ({ SkillResourceService: class {} }));
vi.mock('./parser', () => ({
  SkillParser: class {
    parseSkillMd = mocks.parseSkillMd;
  },
}));
vi.mock('@lobechat/ssrf-safe-fetch', () => ({ ssrfSafeFetch: mocks.ssrfSafeFetch }));

const url = 'https://market.example/skills/new/SKILL.md';
const options = { identifier: 'new', overwrite: false, source: 'market' as const };
const importer = () => new SkillImporter({} as LobeChatDatabase, 'owner', 'scope');

beforeEach(() => {
  vi.resetAllMocks();
  mocks.ssrfSafeFetch.mockResolvedValue({ ok: true, text: async () => 'skill content' });
  mocks.parseSkillMd.mockReturnValue({ content: 'new content', manifest: { name: 'Shared Name' } });
  mocks.findByIdentifier.mockResolvedValue(undefined);
  mocks.findByName.mockResolvedValue(undefined);
  mocks.create.mockResolvedValue({ id: 'created' });
  mocks.update.mockResolvedValue({ id: 'overwritten' });
});

describe('SkillImporter ensure mode', () => {
  it('rejects a user identifier even when its source URL matches', async () => {
    mocks.findByIdentifier.mockResolvedValue({
      content: 'old content',
      id: 'existing',
      identifier: 'new',
      manifest: { sourceUrl: url },
      source: 'user',
      userId: 'owner',
    });
    await expect(importer().importFromUrl({ url }, options)).rejects.toMatchObject({
      code: 'CONFLICT',
    });
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('rejects a same-name user skill even when it was fetched from the same URL', async () => {
    mocks.findByName.mockResolvedValue({
      content: 'old content',
      id: 'existing',
      identifier: 'user.name',
      manifest: { sourceUrl: url },
      source: 'user',
      userId: 'owner',
    });
    await expect(importer().importFromUrl({ url }, options)).rejects.toMatchObject({
      code: 'CONFLICT',
    });
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('does not update an already installed market skill found during import', async () => {
    const existing = {
      content: 'old content',
      id: 'existing',
      identifier: 'new',
      source: 'market',
    };
    mocks.findByIdentifier.mockResolvedValue(existing);
    await expect(importer().importFromUrl({ url }, options)).resolves.toEqual({
      skill: existing,
      status: 'unchanged',
    });
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('creates a missing market skill through the SSRF safe downloader', async () => {
    await expect(importer().importFromUrl({ url }, options)).resolves.toMatchObject({
      status: 'created',
    });
    expect(mocks.ssrfSafeFetch).toHaveBeenCalledWith(
      url,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining({ identifier: 'new', source: 'market' }),
    );
  });
});
