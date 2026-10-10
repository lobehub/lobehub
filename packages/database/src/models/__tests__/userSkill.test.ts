// @vitest-environment node
import { and, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { documents, users } from '../../schemas';
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
});

const create = () =>
  model.create({
    content: '---\nname: migrate-slice\ndescription: Move one slice\n---\nv1 body',
    description: 'Move one slice',
    files: [{ content: 'echo ok', language: 'bash', path: 'scripts/check.sh' }],
    name: 'migrate-slice',
    origin: { goalId: 'goal_1' },
    title: 'Migrate a slice',
  });

describe('UserSkillModel', () => {
  it('creates a skill with its SKILL.md, its scripts and a v1 snapshot', async () => {
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
    expect(await model.listVersions(skill.id)).toMatchObject([{ version: 1 }]);
    expect(await model.nameTaken('migrate-slice')).toBe(true);
  });

  it('keeps every version whole as it revises, and serves the latest', async () => {
    const skill = await create();

    expect(await model.revise(skill.id, { content: 'v2 body', note: 'gate broke' })).toBe(2);
    expect(await model.revise(skill.id, { content: 'v3 body' })).toBe(3);

    const latest = await model.findById(skill.id);
    expect(latest).toMatchObject({ content: 'v3 body', version: 3 });
    expect((await model.listVersions(skill.id)).map((v) => [v.version, v.content, v.note])).toEqual(
      [
        [1, expect.stringContaining('v1 body'), undefined],
        [2, 'v2 body', 'gate broke'],
        [3, 'v3 body', undefined],
      ],
    );
  });

  it('loads skills by name for a run, and only the owner sees them', async () => {
    const skill = await create();

    expect((await model.findByNames(['migrate-slice', 'missing'])).map((s) => s.id)).toEqual([
      skill.id,
    ]);
    const other = new UserSkillModel(serverDB, otherUserId);
    expect(await other.findById(skill.id)).toBeUndefined();
    expect(await other.revise(skill.id, { content: 'hijack' })).toBeUndefined();
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
