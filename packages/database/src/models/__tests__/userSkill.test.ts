// @vitest-environment node
import { and, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { documents, users, workspaces } from '../../schemas';
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
      content: 'Do it.',
      description: 'Move one slice',
      name: 'migrate-slice',
      title: 'Migrate a slice',
    });

    const member = new UserSkillModel(serverDB, otherUserId, workspace.id);
    expect(await member.listCatalog()).toEqual([]);
    expect(await member.findByNames(['migrate-slice'])).toEqual([]);
    expect(await member.findById(skill.id)).toBeUndefined();
    expect(await member.revise(skill.id, { content: 'hijack' })).toBeUndefined();
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
