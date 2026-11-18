// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getTestDB } from '@/database/core/getTestDB';
import { UserSkillModel } from '@/database/models/userSkill';
import { documents, files, globalFiles, users } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';

import { UserSkillService } from './index';
import { skillStorage } from './storage';
import { mockSkillStorage } from './testUtils';

const serverDB: LobeChatDatabase = await getTestDB();
const userId = 'user-skill-versions-test-user';

let storage: Map<string, Uint8Array>;

beforeEach(async () => {
  await serverDB.insert(users).values({ id: userId }).onConflictDoNothing();
  storage = mockSkillStorage();
});

afterEach(async () => {
  vi.restoreAllMocks();
  await serverDB.delete(documents);
  await serverDB.delete(users);
  await serverDB.delete(globalFiles);
});

const service = () => new UserSkillService(serverDB, userId);

const createPlan = () =>
  service().createSkill({
    body: 'v1 body',
    description: 'How each unit is done',
    files: [{ content: 'echo ok', path: 'scripts/check.sh' }],
    name: 'plan',
    title: 'Plan',
  });

describe('UserSkillService versions', () => {
  it('publishes each version as an archive and reads it back as it shipped', async () => {
    const skill = await createPlan();
    expect(skill.archive?.url).toMatch(/^skills\/user\/\w+\.zip$/);
    expect(storage.has(skill.archive!.url)).toBe(true);

    await service().reviseSkill(skill.id, {
      body: 'v2 body',
      files: {
        remove: ['scripts/check.sh'],
        upsert: [{ content: '# rules', path: 'references/review.md' }],
      },
      note: 'gate broke',
    });

    const v1 = await service().getVersion(skill.id, 1);
    expect(v1?.content).toContain('v1 body');
    expect(v1?.files).toEqual([{ content: 'echo ok', path: 'scripts/check.sh', size: 7 }]);
    const v2 = await service().getVersion(skill.id, 2);
    expect(v2).toMatchObject({ note: 'gate broke', version: 2 });
    expect(v2?.content).toContain('v2 body');
    expect(v2?.files).toEqual([{ content: '# rules', path: 'references/review.md', size: 7 }]);

    // The detail lists versions without reading any archive.
    const detail = await service().getSkill(skill.id);
    expect(detail?.versions.map((v) => [v.version, v.note])).toEqual([
      [1, undefined],
      [2, 'gate broke'],
    ]);
    expect(detail?.versions[0]).not.toHaveProperty('archive');
    expect(await service().getVersion(skill.id, 3)).toBeUndefined();
  });

  // The archive is built from the version the write read; another publish
  // landing in between makes it stale, so the write rebuilds on the new one.
  it('rebuilds the archive when another version lands while it publishes', async () => {
    const skill = await createPlan();
    const write = vi.mocked(skillStorage.write);
    write.mockClear();
    const store = write.getMockImplementation()!;
    // While this write uploads its archive, another one publishes v2.
    write.mockImplementationOnce(async (owner, key, bytes) => {
      await new UserSkillModel(serverDB, userId).revise(skill.id, {
        archive: { fileHash: 'f'.repeat(64), size: 1, url: 'skills/user/other.zip' },
        baseVersion: 1,
        content: 'concurrent body',
      });
      return store(owner, key, bytes);
    });

    expect(await service().reviseSkill(skill.id, { body: 'v3 body' })).toBe(3);
    expect(write).toHaveBeenCalledTimes(2);
    const v3 = await service().getVersion(skill.id, 3);
    expect(v3?.content).toContain('v3 body');
  });

  it('packs a binary file’s bytes from its files row', async () => {
    storage.set('uploads/logo.png', new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0xff, 0xfe]));
    const [logo] = await serverDB
      .insert(files)
      .values({ fileType: 'image/png', name: 'logo.png', size: 6, url: 'uploads/logo.png', userId })
      .returning({ id: files.id });
    const skill = await createPlan();

    await service().reviseSkill(skill.id, {
      body: 'v2 body',
      files: { upsert: [{ content: '', fileId: logo.id, path: 'assets/logo.png' }] },
    });

    expect((await service().getVersion(skill.id, 2))?.files).toEqual([
      { binary: true, content: '', path: 'assets/logo.png', size: 6 },
      { content: 'echo ok', path: 'scripts/check.sh', size: 7 },
    ]);
  });

  // A version from before archives kept only its SKILL.md.
  it('reads a version from before archives as its SKILL.md alone', async () => {
    const skill = await createPlan();
    await serverDB.delete(files);
    await serverDB.insert(documents).values({
      content: 'v1 as kept',
      fileType: 'skills/version',
      filename: 'v1',
      metadata: { version: 1 },
      parentId: skill.id,
      source: 'user-skills',
      sourceType: 'agent',
      title: 'v1',
      totalCharCount: 10,
      totalLineCount: 1,
      userId,
      visibility: 'private',
    });

    expect(await service().getVersion(skill.id, 1)).toEqual({
      content: 'v1 as kept',
      note: undefined,
      origin: undefined,
      version: 1,
    });
  });
});
