// @vitest-environment node
import { and, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import {
  documents,
  files,
  globalFiles,
  SKILL_FILE_FILE_TYPE,
  SKILL_SCRIPT_FILE_TYPE,
  users,
  workspaces,
} from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { DocumentModel } from '../document';
import { UserSkillModel } from '../userSkill';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'user-skill-model-test-user';
const otherUserId = 'user-skill-model-test-other';
const model = new UserSkillModel(serverDB, userId);

beforeEach(async () => {
  await serverDB.delete(users);
  await serverDB.insert(users).values([{ id: userId }, { id: otherUserId }]);
});

afterEach(async () => {
  await serverDB.delete(documents).where(eq(documents.userId, userId));
  await serverDB.delete(users);
  await serverDB.delete(globalFiles);
});

/** A version's archive as the service hands it over: already uploaded. */
const archive = () => {
  const fileHash = crypto.randomUUID().replaceAll('-', '');
  return { fileHash, size: 42, url: `skills/user/${fileHash}.zip` };
};

/** Revises from the version the caller reads, as the service does. */
const revise = async (
  skills: UserSkillModel,
  id: string,
  params: Omit<Parameters<UserSkillModel['revise']>[1], 'archive' | 'baseVersion'>,
) =>
  skills.revise(id, {
    archive: archive(),
    baseVersion: (await skills.findById(id))?.version ?? 1,
    ...params,
  });

const create = () =>
  model.create({
    archive: archive(),
    content: '---\nname: migrate-slice\ndescription: Move one slice\n---\nv1 body',
    description: 'Move one slice',
    files: [{ content: 'echo ok', language: 'bash', path: 'scripts/check.sh' }],
    name: 'migrate-slice',
    origin: { goalId: 'goal_1' },
    title: 'Migrate a slice',
  });

describe('UserSkillModel', () => {
  it('creates a skill with its SKILL.md, its files and v1 published', async () => {
    const skill = await create();

    expect(skill).toMatchObject({
      description: 'Move one slice',
      files: [{ content: 'echo ok', language: 'bash', path: 'scripts/check.sh' }],
      name: 'migrate-slice',
      origin: { goalId: 'goal_1' },
      title: 'Migrate a slice',
      version: 1,
    });
    expect(skill.content).toContain('v1 body');
    expect(skill.archive).toMatchObject({ size: 42 });
    const [bundle] = await serverDB
      .select({ content: documents.content })
      .from(documents)
      .where(eq(documents.id, skill.id));
    expect(bundle.content).toBe('Move one slice');
    expect(await model.listVersions(skill.id)).toMatchObject([
      { archive: skill.archive, version: 1 },
    ]);
    expect(await model.nameTaken('migrate-slice')).toBe(true);
  });

  // A version is a release: an archive in `files` under the bundle, never a
  // document row of its own.
  it('publishes every version as an archive under the bundle', async () => {
    const skill = await create();

    expect(await revise(model, skill.id, { content: 'v2 body', note: 'gate broke' })).toBe(2);
    expect(await revise(model, skill.id, { content: 'v3 body' })).toBe(3);

    const latest = await model.findById(skill.id);
    expect(latest).toMatchObject({ content: 'v3 body', version: 3 });
    const versions = await model.listVersions(skill.id);
    expect(versions.map((v) => [v.version, v.note])).toEqual([
      [1, undefined],
      [2, 'gate broke'],
      [3, undefined],
    ]);
    expect(latest!.archive).toEqual(versions[2].archive);
    const archives = await serverDB
      .select({ name: files.name, source: files.source })
      .from(files)
      .where(eq(files.parentId, skill.id));
    expect(archives.map((row) => row.name).sort()).toEqual([
      'migrate-slice@1.zip',
      'migrate-slice@2.zip',
      'migrate-slice@3.zip',
    ]);
    expect(new Set(archives.map((row) => row.source))).toEqual(new Set(['skill']));
    const versionRows = await serverDB
      .select({ id: documents.id })
      .from(documents)
      .where(and(eq(documents.parentId, skill.id), eq(documents.fileType, 'skills/version')));
    expect(versionRows).toEqual([]);
  });

  it('edits the files beside SKILL.md in place', async () => {
    const skill = await create();

    await revise(model, skill.id, {
      content: 'v2 body',
      files: {
        upsert: [
          { content: 'echo strict', language: 'bash', path: 'scripts/check.sh' },
          { content: '# review rules', path: 'references/review.md' },
        ],
      },
    });
    expect((await model.findById(skill.id))!.files).toEqual([
      { content: '# review rules', path: 'references/review.md' },
      { content: 'echo strict', language: 'bash', path: 'scripts/check.sh' },
    ]);

    await revise(model, skill.id, { content: 'v3 body', files: { remove: ['scripts/check.sh'] } });
    await revise(model, skill.id, { content: 'v4 body' });

    expect((await model.findById(skill.id))!.files).toEqual([
      { content: '# review rules', path: 'references/review.md' },
    ]);
    const rows = await serverDB
      .select({ filename: documents.filename })
      .from(documents)
      .where(and(eq(documents.parentId, skill.id), eq(documents.fileType, SKILL_FILE_FILE_TYPE)));
    expect(rows.map((row) => row.filename)).toEqual(['references/review.md']);
  });

  // The archive is built from the version read before the write: a publish
  // landing in between would leave it describing a package that never was.
  it('refuses a write built on a version that is no longer the latest', async () => {
    const skill = await create();
    expect(await revise(model, skill.id, { content: 'v2 body' })).toBe(2);

    expect(
      await model.revise(skill.id, { archive: archive(), baseVersion: 1, content: 'stale body' }),
    ).toBe('stale');
    expect(await model.findById(skill.id)).toMatchObject({ content: 'v2 body', version: 2 });
    expect(await model.listVersions(skill.id)).toHaveLength(2);
  });

  // Skills written before archives: their files are `skills/script` rows and
  // their versions `skills/version` snapshots of SKILL.md. Both still read; a
  // file written again becomes a `skills/file`.
  it('reads a skill written before archives, and moves its files over as they are written', async () => {
    const skill = await create();
    await serverDB
      .update(documents)
      .set({ fileType: SKILL_SCRIPT_FILE_TYPE })
      .where(eq(documents.parentId, skill.id));
    await serverDB.delete(files).where(eq(files.parentId, skill.id));
    await serverDB.insert(documents).values({
      content: 'v1 as kept',
      fileType: 'skills/version',
      filename: 'v1',
      metadata: { note: 'first', version: 1 },
      parentId: skill.id,
      source: 'user-skills',
      sourceType: 'agent',
      title: 'v1',
      totalCharCount: 10,
      totalLineCount: 1,
      userId,
      visibility: 'private',
    });
    // Only the index row is `skills/index`; restore it.
    await serverDB
      .update(documents)
      .set({ fileType: 'skills/index' })
      .where(and(eq(documents.parentId, skill.id), eq(documents.filename, 'SKILL.md')));

    expect((await model.findById(skill.id))!.files.map((file) => file.path)).toEqual([
      'scripts/check.sh',
    ]);
    const [legacy] = await model.listVersions(skill.id);
    expect(legacy).toMatchObject({ content: 'v1 as kept', note: 'first', version: 1 });
    expect(legacy.archive).toBeUndefined();

    await revise(model, skill.id, {
      content: 'v2 body',
      files: { upsert: [{ content: 'echo v2', path: 'scripts/check.sh' }] },
    });
    const [row] = await serverDB
      .select({ fileType: documents.fileType })
      .from(documents)
      .where(and(eq(documents.parentId, skill.id), eq(documents.filename, 'scripts/check.sh')));
    expect(row.fileType).toBe(SKILL_FILE_FILE_TYPE);
    expect((await model.listVersions(skill.id)).map((v) => [v.version, !!v.archive])).toEqual([
      [1, false],
      [2, true],
    ]);
  });

  // A binary file keeps its bytes in `files`; the package row links it.
  it('keeps a binary file in files and links it by fileId', async () => {
    const [logo] = await serverDB
      .insert(files)
      .values({
        fileType: 'image/png',
        name: 'logo.png',
        size: 3,
        url: 'skills/logo.png',
        userId,
      })
      .returning({ id: files.id });
    const skill = await create();
    await revise(model, skill.id, {
      content: 'v2 body',
      files: { upsert: [{ content: 'ignored', fileId: logo.id, path: 'assets/logo.png' }] },
    });

    expect((await model.findById(skill.id))!.files).toEqual([
      { content: '', fileId: logo.id, path: 'assets/logo.png' },
      { content: 'echo ok', language: 'bash', path: 'scripts/check.sh' },
    ]);
  });

  it('loads skills by name for a run, and only the owner sees them', async () => {
    const skill = await create();

    expect((await model.findByNames(['migrate-slice', 'missing'])).map((s) => s.id)).toEqual([
      skill.id,
    ]);
    const other = new UserSkillModel(serverDB, otherUserId);
    expect(await other.findById(skill.id)).toBeUndefined();
    expect(await revise(other, skill.id, { content: 'hijack' })).toBeUndefined();
  });

  it('lists the library as a catalog without reading any body', async () => {
    const skill = await create();
    expect(await model.listCatalog()).toEqual([
      {
        description: 'Move one slice',
        generated: false,
        id: skill.id,
        name: 'migrate-slice',
        title: 'Migrate a slice',
      },
    ]);
  });

  it('flags a skill a goal batch wrote as generated', async () => {
    await model.create({
      archive: archive(),
      content: 'v1',
      description: 'How each unit is done',
      name: 'goal-plan-x',
      origin: { batchNodeId: 'batch-1', goalId: 'goal-1', revision: 1 },
      title: 'Plan',
    });
    expect((await model.listCatalog()).map((item) => [item.name, item.generated])).toEqual([
      ['goal-plan-x', true],
    ]);
    // A run listing only hand-made skills does not read it at all.
    expect(await model.listCatalog({ includeGenerated: false })).toEqual([]);
  });

  it('keeps a workspace member’s skills away from the other members', async () => {
    const [workspace] = await serverDB
      .insert(workspaces)
      .values({ name: 'user-skill-ws', primaryOwnerId: userId, slug: 'user-skill-ws' })
      .returning();
    const creator = new UserSkillModel(serverDB, userId, workspace.id);
    const skill = await creator.create({
      archive: archive(),
      content: 'Do it.',
      description: 'Move one slice',
      name: 'migrate-slice',
      title: 'Migrate a slice',
    });

    const member = new UserSkillModel(serverDB, otherUserId, workspace.id);
    expect(await member.listCatalog()).toEqual([]);
    expect(await member.findByNames(['migrate-slice'])).toEqual([]);
    expect(await member.findById(skill.id)).toBeUndefined();
    expect(await revise(member, skill.id, { content: 'hijack' })).toBeUndefined();
    // The creator still has it…
    expect((await creator.listCatalog()).map((item) => item.id)).toEqual([skill.id]);
    // …but not through a workspace-public agent, which must not read (and
    // echo) its caller's private instructions.
    const throughPublicAgent = new UserSkillModel(serverDB, userId, workspace.id, 'public');
    expect(await throughPublicAgent.listCatalog()).toEqual([]);
    expect(await throughPublicAgent.findByNames(['migrate-slice'])).toEqual([]);
    // A goal batch's own plan loads there only when the run's Task names it —
    // it is the goal's plan — never because a name was merely supplied.
    await creator.create({
      archive: archive(),
      content: 'Plan body',
      description: 'How each unit is done',
      files: [{ content: 'echo ok', path: 'scripts/check.sh' }],
      name: 'goal-plan-x',
      origin: { batchNodeId: 'batch-1', goalId: 'goal-1', revision: 1 },
      title: 'Plan',
    });
    expect(await throughPublicAgent.findByNames(['goal-plan-x'])).toEqual([]);
    const [plan] = await throughPublicAgent.findByNames(['goal-plan-x', 'migrate-slice'], {
      trustedGenerated: ['goal-plan-x'],
    });
    expect(plan).toMatchObject({ content: 'Plan body', name: 'goal-plan-x' });
    expect(plan.files.map((file) => file.path)).toEqual(['scripts/check.sh']);
    await serverDB.delete(workspaces);
  });

  it('stays out of the Page library', async () => {
    await create();
    const { items } = await new DocumentModel(serverDB, userId).query();
    expect(items).toEqual([]);
    const stored = await serverDB
      .select({ sourceType: documents.sourceType })
      .from(documents)
      .where(and(eq(documents.userId, userId)));
    expect(new Set(stored.map((row) => row.sourceType))).toEqual(new Set(['agent']));
  });
});
