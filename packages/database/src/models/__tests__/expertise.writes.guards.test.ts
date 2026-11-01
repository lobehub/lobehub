// @vitest-environment node
import { asc, eq, inArray } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import {
  agents,
  expertiseBindings,
  expertiseDomains,
  expertiseHits,
  expertiseLessonRevisions,
  expertiseLessons,
  expertiseRuns,
  projects,
  users,
  workspaces,
} from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { ExpertiseModel } from '../expertise';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'expertise-writes-user';
const otherUserId = 'expertise-writes-other';
const workspaceId = 'expertise-writes-workspace';
const domainId = 'expertise-writes-domain';
const secondDomainId = 'expertise-writes-domain-2';
const foreignDomainId = 'expertise-writes-foreign-domain';

const model = () => new ExpertiseModel(serverDB, userId);

const seedDomain = async (
  id: string,
  overrides: Partial<typeof expertiseDomains.$inferInsert> = {},
) => {
  await serverDB.insert(expertiseDomains).values({
    anchorChosenAt: new Date(),
    domainFilter: `${id} filter`,
    id,
    slug: id,
    title: `${id} title`,
    userId,
    ...overrides,
  });
};

const seedLesson = async (
  code: string,
  overrides: Partial<typeof expertiseLessons.$inferInsert> = {},
) => {
  const [lesson] = await serverDB
    .insert(expertiseLessons)
    .values({
      code,
      domainId,
      polarity: 'rule',
      sections: [{ body: code, key: 'rule' }],
      title: code,
      ...overrides,
    })
    .returning();
  return lesson;
};

const readLesson = async (id: string) => {
  const [row] = await serverDB.select().from(expertiseLessons).where(eq(expertiseLessons.id, id));
  return row;
};

const cleanup = async () => {
  // Workspaces, projects, agents and every expertise row cascade from the users.
  await serverDB.delete(users).where(inArray(users.id, [userId, otherUserId]));
};

beforeEach(async () => {
  await cleanup();
  await serverDB.insert(users).values([{ id: userId }, { id: otherUserId }]);
});

afterEach(cleanup);

describe('ExpertiseModel domain writes', () => {
  it('mounts a new domain on a project after the ones already there', async () => {
    await serverDB
      .insert(projects)
      .values({ id: 'expertise-writes-project', name: 'Project', userId });

    const first = await model().createDomain({
      brief: '  Delivery bar  ',
      canonEntries: [
        { key: 'contrast', source: 'WCAG', statement: 'Text must stand out', title: 'Contrast' },
      ],
      carrier: { id: 'expertise-writes-project', type: 'project' },
      domainFilter: '  Is it a delivery?  ',
      layerCanonRef: 'canon-ref',
      layerSource: 'canonical',
      layers: [{ key: 'craft', title: 'Craft' }],
      outOfScope: '  Drafts  ',
      rationale: '  Keeps the bar visible  ',
      title: '  Delivery Bar  ',
    });
    const second = await model().createDomain({
      brief: 'Second',
      carrier: { id: 'expertise-writes-project', type: 'project' },
      domainFilter: 'Second',
      outOfScope: '   ',
      rationale: '   ',
      title: 'Second',
    });

    const [domain] = await serverDB
      .select()
      .from(expertiseDomains)
      .where(eq(expertiseDomains.id, first));
    const [blank] = await serverDB
      .select()
      .from(expertiseDomains)
      .where(eq(expertiseDomains.id, second));
    const bindings = await serverDB
      .select({ domainId: expertiseBindings.domainId, sortOrder: expertiseBindings.sortOrder })
      .from(expertiseBindings)
      .where(eq(expertiseBindings.projectId, 'expertise-writes-project'))
      .orderBy(asc(expertiseBindings.sortOrder));

    expect(domain).toMatchObject({
      description: 'Delivery bar',
      domainFilter: 'Is it a delivery?',
      layerSource: 'canonical',
      outOfScope: 'Drafts',
      title: 'Delivery Bar',
    });
    expect(domain.slug).toMatch(/^delivery-bar-/);
    expect(domain.anchorCandidates).toEqual([
      expect.objectContaining({
        layerCanonRef: 'canon-ref',
        outOfScope: 'Drafts',
        rationale: 'Keeps the bar visible',
      }),
    ]);
    expect(blank.outOfScope).toBeNull();
    expect(blank.layerSource).toBe('invented');
    expect(blank.anchorCandidates?.[0]).not.toHaveProperty('rationale', expect.anything());
    expect(bindings).toEqual([
      { domainId: first, sortOrder: 0 },
      { domainId: second, sortOrder: 1 },
    ]);
  });

  it('mounts an always-on domain on the workspace when one is in scope', async () => {
    await serverDB.insert(workspaces).values({
      id: workspaceId,
      name: 'Workspace',
      primaryOwnerId: userId,
      slug: 'expertise-writes-ws',
    });
    const ws = new ExpertiseModel(serverDB, userId, workspaceId);

    const id = await ws.createDomain({
      brief: 'Team bar',
      carrier: { type: 'user' },
      domainFilter: 'Team',
      title: 'Team bar',
    });
    const [binding] = await serverDB
      .select()
      .from(expertiseBindings)
      .where(eq(expertiseBindings.domainId, id));
    const listed = await ws.listDomainsForOwner();

    expect(binding).toMatchObject({
      boundUserId: null,
      boundWorkspaceId: workspaceId,
      sortOrder: 0,
    });
    expect(listed.map(({ domain }) => domain.id)).toEqual([id]);
    expect(await model().listDomainsForOwner()).toEqual([]);
  });

  it('mounts a domain on an agent', async () => {
    await serverDB.insert(agents).values({ id: 'expertise-writes-agent', userId });

    const id = await model().createDomain({
      brief: 'Agent bar',
      carrier: { id: 'expertise-writes-agent', type: 'agent' },
      domainFilter: 'Agent',
      title: 'Agent bar',
    });

    const listed = await model().listDomainsForAgent('expertise-writes-agent');
    expect(listed.map(({ domain }) => domain.id)).toEqual([id]);
  });

  it('deletes only a domain the caller owns', async () => {
    await seedDomain(domainId);
    await seedDomain(foreignDomainId, { userId: otherUserId });

    expect(await model().deleteDomain(foreignDomainId)).toBeNull();
    expect(await model().deleteDomain(domainId)).toEqual({ id: domainId });
    const left = await serverDB
      .select({ id: expertiseDomains.id })
      .from(expertiseDomains)
      .where(inArray(expertiseDomains.id, [domainId, foreignDomainId]));
    expect(left).toEqual([{ id: foreignDomainId }]);
  });

  it('compares reaches: the same domain, two unbound ones, and an agent against the reviewer', async () => {
    await serverDB.insert(agents).values([
      { id: 'expertise-writes-agent', userId },
      { id: 'expertise-writes-agent-2', userId },
    ]);
    await seedDomain(domainId);
    await seedDomain(secondDomainId);
    await seedDomain('expertise-writes-agent-domain');
    await seedDomain('expertise-writes-agent-domain-2');
    await seedDomain('expertise-writes-mine');
    await serverDB.insert(expertiseBindings).values([
      { agentId: 'expertise-writes-agent', domainId: 'expertise-writes-agent-domain' },
      { agentId: 'expertise-writes-agent-2', domainId: 'expertise-writes-agent-domain' },
      { agentId: 'expertise-writes-agent-2', domainId: 'expertise-writes-agent-domain-2' },
      { agentId: 'expertise-writes-agent', domainId: 'expertise-writes-agent-domain-2' },
      { boundUserId: userId, domainId: 'expertise-writes-mine' },
      // A disabled mount reaches nothing.
      { boundUserId: userId, domainId: secondDomainId, enabled: false },
    ]);

    const m = model();
    expect(await m.sameReach(domainId, domainId)).toBe(true);
    expect(await m.sameReach(domainId, secondDomainId)).toBe(true);
    expect(
      await m.sameReach('expertise-writes-agent-domain', 'expertise-writes-agent-domain-2'),
    ).toBe(true);
    expect(await m.sameReach('expertise-writes-agent-domain', 'expertise-writes-mine')).toBe(false);
    expect(await m.sameReach('expertise-writes-agent-domain', domainId)).toBe(false);
  });

  it('reuses a group whose name differs only in case and spacing', async () => {
    const id = await model().createRuleGroup({ gate: 'Design?', title: 'Design System' });

    const again = await model().createRuleGroup({ gate: 'Other', title: '  design system ' });
    const other = await model().createRuleGroup({
      gate: 'Copy?',
      outOfScope: 'Ads',
      title: 'Copywriting',
    });

    expect(again).toBe(id);
    expect(other).not.toBe(id);
    const [created] = await serverDB
      .select({ outOfScope: expertiseDomains.outOfScope })
      .from(expertiseDomains)
      .where(eq(expertiseDomains.id, other));
    expect(created.outOfScope).toBe('Ads');
  });

  it('updates a group only where the patch says so', async () => {
    await seedDomain(domainId, { outOfScope: 'Drafts', title: 'Old' });
    await seedDomain(foreignDomainId, { userId: otherUserId });
    const read = async () => {
      const [row] = await serverDB
        .select()
        .from(expertiseDomains)
        .where(eq(expertiseDomains.id, domainId));
      return row;
    };

    expect(await model().updateRuleGroup(foreignDomainId, { title: 'Stolen' })).toBeNull();

    expect(await model().updateRuleGroup(domainId, { gate: '  ', title: '  ' })).toEqual({
      id: domainId,
    });
    expect(await read()).toMatchObject({
      domainFilter: `${domainId} filter`,
      outOfScope: 'Drafts',
      title: 'Old',
    });

    await model().updateRuleGroup(domainId, {
      gate: ' New gate ',
      outOfScope: '  ',
      title: ' New ',
    });
    expect(await read()).toMatchObject({
      domainFilter: 'New gate',
      outOfScope: null,
      title: 'New',
    });

    await model().updateRuleGroup(domainId, { outOfScope: null });
    expect((await read()).outOfScope).toBeNull();

    await model().updateRuleGroup(domainId, { outOfScope: ' Ads ' });
    expect((await read()).outOfScope).toBe('Ads');
  });
});

describe('ExpertiseModel rule filing', () => {
  it('refuses to file a rule into a domain the caller cannot see', async () => {
    await seedDomain(foreignDomainId, { userId: otherUserId });

    expect(await model().createRule({ domainId: foreignDomainId, title: 'Nope' })).toBeNull();
  });

  it('files a rule with its sections and settings, numbered past non-standard codes', async () => {
    await seedDomain(domainId);
    await seedLesson('legacy', { sortOrder: null });

    const rule = await model().createRule({
      compilability: 'compilable',
      direction: 'negative',
      domainId,
      enforcement: 'block',
      how: '  Use the token  ',
      limits: '   ',
      title: '  Never hard-code colours  ',
      why: ' Themes break ',
    });

    const row = await readLesson(rule!.id);
    expect(rule!.code).toBe('P-01');
    expect(row).toMatchObject({
      compilability: 'compilable',
      direction: 'negative',
      enforcement: 'block',
      // The only other row has no position yet, so the new one starts from the top.
      sortOrder: 0,
      title: 'Never hard-code colours',
    });
    expect(row.sections).toEqual([
      { body: 'Never hard-code colours', key: 'rule' },
      { body: 'Themes break', key: 'why' },
      { body: 'Use the token', key: 'how' },
    ]);
  });

  it('numbers a material run in the caller scope only, and keeps an empty quote as null', async () => {
    await seedDomain(domainId);
    await seedDomain(foreignDomainId, { userId: otherUserId });
    const lesson = await seedLesson('P-01');

    expect(
      await model().insertMaterialRun({
        domainId: foreignDomainId,
        reflectionKey: 'material:document:doc-x',
        subjectId: 'doc-x',
        subjectType: 'document',
      }),
    ).toBeNull();

    const runId = await model().insertMaterialRun({
      domainId,
      reflectionKey: 'material:document:doc-1',
      subjectId: 'doc-1',
      subjectType: 'document',
    });
    const hitId = await model().insertMaterialHit({
      domainId,
      lessonId: lesson.id,
      quote: '',
      runId: runId!,
      where: 'p. 1',
    });

    const [run] = await serverDB.select().from(expertiseRuns).where(eq(expertiseRuns.id, runId!));
    const [hit] = await serverDB.select().from(expertiseHits).where(eq(expertiseHits.id, hitId));
    expect(run).toMatchObject({ actorType: 'user', hadHumanInLoop: true, runIndex: 1 });
    expect(hit).toMatchObject({ example: null, outcome: 'pass', where: 'p. 1' });
  });

  it('reorders a rule within its group, and refuses a foreign group or a stranger rule', async () => {
    await seedDomain(domainId);
    await seedDomain(secondDomainId);
    await seedDomain(foreignDomainId, { userId: otherUserId });
    const a = await seedLesson('P-01', { sortOrder: 0 });
    const b = await seedLesson('P-02', { sortOrder: 1 });
    const c = await seedLesson('P-03', { sortOrder: 2 });
    const stranger = await seedLesson('P-01', { domainId: secondDomainId });

    expect(await model().reorderRule(foreignDomainId, a.id, null)).toBeNull();
    expect(await model().reorderRule(domainId, stranger.id, null)).toBeNull();

    // To the end when there is nothing to go before.
    expect(await model().reorderRule(domainId, a.id, null)).toEqual({
      domainId,
      order: [b.id, c.id, a.id],
    });
    // Also to the end when the anchor is not in the group.
    expect(await model().reorderRule(domainId, b.id, stranger.id)).toEqual({
      domainId,
      order: [c.id, a.id, b.id],
    });
    expect(await model().reorderRule(domainId, b.id, c.id)).toEqual({
      domainId,
      order: [b.id, c.id, a.id],
    });
    expect((await readLesson(a.id)).sortOrder).toBe(2);
  });
});

describe('ExpertiseModel rule moves', () => {
  it('refuses a missing rule, a missing group and a rule that is not active', async () => {
    await seedDomain(domainId);
    await seedDomain(secondDomainId);
    await seedDomain(foreignDomainId, { userId: otherUserId });
    const lesson = await seedLesson('P-01');
    const retired = await seedLesson('P-02', { status: 'retired' });

    expect(await model().moveRule('00000000-0000-4000-8000-000000000000', domainId)).toBeNull();
    expect(await model().moveRule(lesson.id, foreignDomainId)).toBeNull();
    expect(await model().moveRule(lesson.id, domainId)).toEqual({ domainId, id: lesson.id });
    expect(await model().moveRule(retired.id, secondDomainId)).toBeNull();
    expect((await readLesson(retired.id)).domainId).toBe(domainId);
  });

  it('refuses to move a rule into a group with a different reach', async () => {
    await serverDB.insert(agents).values({ id: 'expertise-writes-agent', userId });
    await seedDomain(domainId);
    await seedDomain(secondDomainId);
    await serverDB.insert(expertiseBindings).values([
      { boundUserId: userId, domainId },
      { agentId: 'expertise-writes-agent', domainId: secondDomainId },
    ]);
    const lesson = await seedLesson('P-01');

    expect(await model().moveRule(lesson.id, secondDomainId)).toBeNull();
  });

  it('moves a rule without evidence in place, after the rules already in the target', async () => {
    await seedDomain(domainId);
    await seedDomain(secondDomainId);
    const lesson = await seedLesson('P-01');
    await seedLesson('P-07', { domainId: secondDomainId, sortOrder: 4 });

    expect(await model().moveRule(lesson.id, secondDomainId)).toEqual({
      domainId: secondDomainId,
      id: lesson.id,
    });
    expect(await readLesson(lesson.id)).toMatchObject({
      code: 'P-08',
      domainId: secondDomainId,
      sortOrder: 5,
    });
  });

  it('copies a rule with evidence into an empty target and hides the original', async () => {
    await seedDomain(domainId);
    await seedDomain(secondDomainId);
    const lesson = await seedLesson('P-01');
    const [run] = await serverDB
      .insert(expertiseRuns)
      .values({
        actorId: 'agent-1',
        actorType: 'agent',
        domainId,
        runIndex: 1,
        subjectId: 'topic-1',
        subjectType: 'topic',
      })
      .returning();
    await serverDB
      .insert(expertiseHits)
      .values({ domainId, lessonId: lesson.id, outcome: 'violation', runId: run.id });

    const moved = await model().moveRule(lesson.id, secondDomainId);

    expect(moved!.id).not.toBe(lesson.id);
    expect(await readLesson(moved!.id)).toMatchObject({
      code: 'P-01',
      domainId: secondDomainId,
      salvagedFromId: lesson.id,
      sortOrder: 0,
    });
    expect(await readLesson(lesson.id)).toMatchObject({
      rejectedReason: `moved-to:${moved!.id}`,
      status: 'rejected',
    });
  });
});

describe('ExpertiseModel lesson writes', () => {
  it('refuses to teach, revise, restore or retire outside the caller scope', async () => {
    await seedDomain(foreignDomainId, { userId: otherUserId });
    const foreign = await seedLesson('P-01', { domainId: foreignDomainId });

    expect(await model().teachLesson({ domainId: foreignDomainId, text: 'x' })).toBeNull();
    expect(await model().reviseLesson(foreign.id, 'x')).toBeNull();
    expect(await model().restoreLesson(foreign.id)).toBeNull();
    expect(await model().retireLesson(foreign.id)).toBeNull();
    expect(await model().lockLesson(foreign.id)).toBeUndefined();
    expect(await model().findLesson(foreign.id)).toBeUndefined();
    expect(await readLesson(foreign.id)).toMatchObject({ currentRevision: 1, status: 'active' });
  });

  it('teaches a long lesson under a shortened title, numbered past non-standard codes', async () => {
    await seedDomain(domainId);
    await seedLesson('legacy');
    await seedLesson('P-03');
    const text = 'a'.repeat(100);

    const taught = await model().teachLesson({ domainId, text: `  ${text}  ` });
    const short = await model().teachLesson({ domainId, text: 'Short' });

    expect(taught!.code).toBe('P-04');
    expect((await readLesson(taught!.id)).title).toBe(`${'a'.repeat(79)}…`);
    expect(await readLesson(short!.id)).toMatchObject({ code: 'P-05', title: 'Short' });
  });

  it('replaces the limits section on a revision and records it', async () => {
    await seedDomain(domainId);
    const lesson = await seedLesson('P-01', {
      sections: [
        { body: 'Rule', key: 'rule' },
        { body: 'Old limit', key: 'limits' },
      ],
    });

    expect(await model().reviseLesson(lesson.id, '  Not for drafts  ')).toEqual({
      id: lesson.id,
      revision: 2,
    });
    expect((await readLesson(lesson.id)).sections).toEqual([
      { body: 'Rule', key: 'rule' },
      { body: 'Not for drafts', key: 'limits' },
    ]);
    const revisions = await model().listLessonRevisions(lesson.id);
    expect(revisions).toEqual([
      expect.objectContaining({ byViewer: true, feedback: 'Not for drafts', revision: 2 }),
    ]);
  });

  it('stops following a salvage chain that loops back on itself', async () => {
    await seedDomain(domainId);
    const a = await seedLesson('P-01');
    const b = await seedLesson('P-02', { salvagedFromId: a.id });
    await serverDB
      .update(expertiseLessons)
      .set({ salvagedFromId: b.id })
      .where(eq(expertiseLessons.id, a.id));
    await serverDB.insert(expertiseLessonRevisions).values([
      {
        changedBy: 'user',
        changedByUserId: otherUserId,
        lessonId: a.id,
        revision: 2,
        sections: [],
      },
      { changedBy: 'agent', lessonId: b.id, revision: 2, sections: [] },
    ]);

    const revisions = await model().listLessonRevisions(b.id, 5);

    expect(revisions.map(({ byViewer, changedBy }) => [changedBy, byViewer]).sort()).toEqual([
      ['agent', false],
      ['user', false],
    ]);
  });

  it('restores a retired rule, but not one a merge folded in', async () => {
    await seedDomain(domainId);
    const retired = await seedLesson('P-01', { retiredAt: new Date(), status: 'retired' });
    const merged = await seedLesson('P-02', {
      rejectedReason: 'merged-into:someone',
      status: 'rejected',
    });

    expect(await model().restoreLesson(merged.id)).toBeNull();
    expect(await model().restoreLesson(retired.id)).toEqual({ id: retired.id });
    expect(await readLesson(retired.id)).toMatchObject({ retiredAt: null, status: 'active' });
    expect((await readLesson(merged.id)).status).not.toBe('active');
  });

  it('retires a rule and keeps its row', async () => {
    await seedDomain(domainId);
    const lesson = await seedLesson('P-01');

    expect(await model().retireLesson(lesson.id)).toEqual({ id: lesson.id });
    const row = await readLesson(lesson.id);
    expect(row.status).toBe('retired');
    expect(row.retiredAt).toBeInstanceOf(Date);
  });

  it('locks, revises and patches a lesson inside one transaction', async () => {
    await seedDomain(domainId);
    const lesson = await seedLesson('P-01');

    await serverDB.transaction(async (tx) => {
      const m = new ExpertiseModel(tx as unknown as LobeChatDatabase, userId);
      const locked = await m.lockLesson(lesson.id);
      await m.insertLessonRevision({
        changedBy: 'user',
        changedByUserId: userId,
        lessonId: lesson.id,
        revision: locked!.currentRevision + 1,
        sections: locked!.sections,
      });
      await m.updateLessonFields(lesson.id, { currentRevision: 2, title: 'Patched' });
    });

    expect(await readLesson(lesson.id)).toMatchObject({ currentRevision: 2, title: 'Patched' });
    expect((await model().listLessonRevisions(lesson.id)).map(({ revision }) => revision)).toEqual([
      2,
    ]);
  });

  it('fills directions per kind and skips a kind nobody was judged as', async () => {
    await seedDomain(domainId);
    const open = await seedLesson('P-01');
    const set = await seedLesson('P-02', { direction: 'negative' });

    await model().fillLessonDirections([
      { direction: 'positive', id: open.id },
      { direction: 'positive', id: set.id },
    ]);

    expect((await readLesson(open.id)).direction).toBe('positive');
    expect((await readLesson(set.id)).direction).toBe('negative');
  });
});
