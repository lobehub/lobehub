// @vitest-environment node
import { and, eq, inArray } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { QuickNoteRepository } from '../../repositories/quickNote';
import {
  documents,
  quickNoteComments,
  quickNoteProposals,
  quickNoteResources,
  quickNoteRuns,
  quickNotes,
  topics,
  users,
  userSettings,
  workspaceMembers,
  workspaces,
} from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { QuickNoteModel } from '../quickNote';
import {
  QUICK_NOTE_FAILURE_RETRY_BASE_MS,
  QUICK_NOTE_MAX_AUTOMATIC_FAILURES,
} from '../quickNote/runs';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'quick-note-model-user';
const otherUserId = 'quick-note-model-other-user';
const quickNoteModel = new QuickNoteModel(serverDB, userId);
const quickNoteRepo = new QuickNoteRepository(serverDB, userId);
const otherRepo = new QuickNoteRepository(serverDB, otherUserId);

const renderSourceText = (editorData: Record<string, unknown>) =>
  typeof editorData.markdown === 'string' ? editorData.markdown : '';

/** Claims an Analyze Run for an owned note. */
const claimAnalyze = (id: string) =>
  quickNoteRepo.claimRun(id, { kind: 'analyze', renderSourceText });

/** Creates a note whose completed Run produced one pending Task Proposal. */
const seedProposal = async (content = 'Research duplex speech models') => {
  const note = await quickNoteRepo.create({ content });
  const run = await claimAnalyze(note.id);
  const output = await quickNoteRepo.completeRun(run!.id, {
    proposals: [{ kind: 'task', payload: { instruction: content }, preset: 'research' }],
    summary: 'Summary',
  });

  return { note, proposal: output!.proposals[0], run: run! };
};

beforeEach(async () => {
  await serverDB.delete(users);
  await serverDB.insert(users).values([{ id: userId }, { id: otherUserId }]);
});

afterEach(async () => {
  await serverDB.delete(users);
});

describe('QuickNoteModel', () => {
  /** @example A second user cannot read or mutate another user's capture. */
  it('keeps Quick Notes isolated by owner', async () => {
    const note = await quickNoteRepo.create({ content: 'private note' });
    const otherModel = new QuickNoteModel(serverDB, otherUserId);

    const otherNotes = await otherModel.query();
    const updateResult = await otherRepo.updateContent(note.id, {
      content: 'hacked',
      editorData: { root: { children: [] } },
    });

    const [document] = await serverDB
      .select({ content: documents.content })
      .from(documents)
      .where(eq(documents.id, note.documentId));

    /** @example An unrelated owner receives an empty collection. */
    expect(otherNotes).toEqual([]);
    /** @example An unrelated owner cannot update the note. */
    expect(updateResult).toBeUndefined();
    /** @example The original Document remains unchanged. */
    expect(document?.content).toBe('private note');
  });

  /** @example Editing feedback overwrites the Comment; Runs keep their own snapshot text. */
  it('overwrites Comment content and keeps Comments owner-scoped', async () => {
    const note = await quickNoteRepo.create({ content: 'An unresolved capture' });
    const created = await quickNoteModel.createComment(note.id, {
      content: 'Please consider the data requirement.',
      editorData: { markdown: 'Please consider the data requirement.' },
    });
    const updated = await quickNoteModel.updateComment(created!.id, {
      content: 'Please consider the training data requirement.',
      editorData: { markdown: 'Please consider the training data requirement.' },
    });
    const otherModel = new QuickNoteModel(serverDB, otherUserId);
    const rejected = await otherModel.updateComment(created!.id, {
      content: 'Cross-owner edit',
    });
    const rejectedCreate = await otherModel.createComment(note.id, { content: 'Cross-owner add' });
    const hiddenComments = await otherModel.queryComments(note.id);
    const comments = await serverDB
      .select()
      .from(quickNoteComments)
      .where(eq(quickNoteComments.quickNoteId, note.id));

    /** @example One Comment row holds only the latest content. */
    expect(comments).toHaveLength(1);
    expect(comments[0].content).toBe('Please consider the training data requirement.');
    /** @example The edit API returns the updated Comment. */
    expect(updated?.content).toBe('Please consider the training data requirement.');
    /** @example Another owner cannot rewrite the feedback stream. */
    expect(rejected).toBeUndefined();
    /** @example Another owner cannot append feedback to the capture. */
    expect(rejectedCreate).toBeUndefined();
    /** @example Another owner cannot list the feedback stream. */
    expect(hiddenComments).toEqual([]);
  });

  /** @example Refresh recovery exposes an active Run even if another Run completed later. */
  it('prefers an active Run in the list projection', async () => {
    const note = await quickNoteRepo.create({ content: 'Enrich while analyze completes' });
    const enrichment = await quickNoteRepo.claimRun(note.id, {
      kind: 'signal_enrichment',
      renderSourceText,
    });
    const analyze = await claimAnalyze(note.id);
    await quickNoteRepo.completeRun(analyze!.id, { summary: 'Light summary' });

    const {
      items: [details],
    } = await quickNoteModel.queryDetails();

    /** @example The active Run remains recoverable rather than being hidden by Analyze. */
    expect(details.run).toMatchObject({ kind: enrichment!.kind, status: 'pending' });
    /** @example The completed Run's summary is still projected. */
    expect(details.summary).toMatchObject({ content: 'Light summary' });
  });

  // ROOT CAUSE:
  // The list returned every owned note with its full Document body and had no limit, and each
  // active Analyze poll re-read that whole list just to observe one Run.
  /** @example The list is read one bounded page at a time, and one note can be read alone. */
  it('pages the list by creation time and reads one note without the list', async () => {
    const created = [];
    for (const [index, content] of ['first', 'second', 'third'].entries()) {
      const note = await quickNoteRepo.create({ content });
      await serverDB
        .update(quickNotes)
        .set({ createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, index)) })
        .where(eq(quickNotes.id, note.id));
      created.push(note);
    }
    await otherRepo.create({ content: 'not mine' });
    // Editing the oldest note must not move it to the first page.
    await serverDB
      .update(quickNotes)
      .set({ updatedAt: new Date(Date.now() + 60_000) })
      .where(eq(quickNotes.id, created[0].id));

    const first = await quickNoteModel.queryDetails({ limit: 2 });
    const second = await quickNoteModel.queryDetails({ cursor: first.nextCursor, limit: 2 });

    /** @example Newest first, bounded by `limit`, with a cursor to the rest. */
    expect(first.items.map(({ content }) => content)).toEqual(['third', 'second']);
    expect(first.nextCursor).not.toBeNull();
    /** @example The last page holds the remainder and ends the list. */
    expect(second.items.map(({ content }) => content)).toEqual(['first']);
    expect(second.nextCursor).toBeNull();
    /** @example One note is read with the list projection, owner-scoped. */
    expect(await quickNoteModel.queryDetail(created[1].id)).toMatchObject({
      content: 'second',
      id: created[1].id,
    });
    const [foreign] = await serverDB
      .select({ id: quickNotes.id })
      .from(quickNotes)
      .where(eq(quickNotes.userId, otherUserId));
    expect(await quickNoteModel.queryDetail(foreign.id)).toBeUndefined();
  });

  /** @example Analyze can accept typed owned resources but not another user's Document. */
  it('links only owner-accessible typed Context resources', async () => {
    const note = await quickNoteRepo.create({ content: 'Connect this note' });
    const run = await claimAnalyze(note.id);
    await serverDB.insert(documents).values([
      {
        content: 'Owned context',
        fileType: 'text/plain',
        id: 'quick-note-owned-context',
        source: 'manual',
        sourceType: 'api',
        title: 'Duplex training notes',
        totalCharCount: 13,
        totalLineCount: 1,
        userId,
      },
      {
        content: 'Foreign context',
        fileType: 'text/plain',
        id: 'quick-note-foreign-context',
        source: 'manual',
        sourceType: 'api',
        totalCharCount: 15,
        totalLineCount: 1,
        userId: otherUserId,
      },
    ]);

    const accepted = await quickNoteModel.linkDocumentResource(run!.id, 'quick-note-owned-context');
    const acceptedAgain = await quickNoteModel.linkDocumentResource(
      run!.id,
      'quick-note-owned-context',
    );
    const relatedTopicId = 'quick-note-related-topic';
    await serverDB
      .insert(topics)
      .values({ id: relatedTopicId, title: 'Duplex model discussion', userId });
    const acceptedTopic = await quickNoteModel.linkResource(run!.id, {
      id: relatedTopicId,
      type: 'topic',
    });
    const rejected = await quickNoteModel.linkDocumentResource(
      run!.id,
      'quick-note-foreign-context',
    );
    const provenance = await serverDB
      .select()
      .from(quickNoteResources)
      .where(eq(quickNoteResources.runId, run!.id));
    const details = await quickNoteModel.queryAgenticDetails(note.id);

    /** @example The owned canonical Document becomes a Context resource. */
    expect(accepted).toMatchObject({
      documentId: 'quick-note-owned-context',
      resourceId: 'quick-note-owned-context',
      resourceType: 'document',
      role: 'context',
      runId: run!.id,
      sourceHistoryId: run!.sourceHistoryId,
    });
    /** @example Cross-owner Documents cannot be attached through model output. */
    expect(rejected).toBeUndefined();
    /** @example Workflow retry resolves to the same stable binding. */
    expect(acceptedAgain?.id).toBe(accepted?.id);
    /** @example A related Topic is retained as a Topic reference without a fake Document id. */
    expect(acceptedTopic).toMatchObject({
      documentId: null,
      resourceId: relatedTopicId,
      resourceType: 'topic',
    });
    /** @example The producing Run is recorded directly on both links. */
    expect(provenance.map(({ id }) => id).sort()).toEqual([accepted!.id, acceptedTopic!.id].sort());
    /** @example The detail projection resolves product-native labels for both resource families. */
    expect(details.resources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: 'Duplex training notes',
          resourceId: 'quick-note-owned-context',
        }),
        expect.objectContaining({
          label: 'Duplex model discussion',
          resourceId: relatedTopicId,
        }),
      ]),
    );
  });

  /** @example Missing preferences enable Automatic Analyze while explicit false opts out. */
  it('defaults Automatic Analyze on unless explicitly disabled', async () => {
    /** @example A user without a settings row receives the default-on behavior. */
    expect(await QuickNoteModel.isAutomaticAnalyzeEnabled(serverDB, userId)).toBe(true);

    await serverDB.insert(userSettings).values({
      id: userId,
      quickNote: {
        analyzeAgentId: null,
        autoAnalyze: { enabled: false, idleDelayMs: 6000 },
        maxAnalyzeSteps: 4,
      },
    });

    /** @example An explicit false preference disables background Analyze. */
    expect(await QuickNoteModel.isAutomaticAnalyzeEnabled(serverDB, userId)).toBe(false);
  });

  /** @example Analyze settings preserve the Agent binding while bounding runtime costs. */
  it('resolves and bounds configurable Analyze settings', async () => {
    await serverDB.insert(userSettings).values({
      id: userId,
      quickNote: {
        analyzeAgentId: 'agt_research',
        autoAnalyze: { enabled: true, idleDelayMs: 100 },
        maxAnalyzeSteps: 99,
      },
    });

    const settings = await QuickNoteModel.getAnalyzeSettings(serverDB, userId);

    /** @example User choice is retained and unsafe bounds are normalized server-side. */
    expect(settings).toEqual({
      analyzeAgentId: 'agt_research',
      autoAnalyze: { enabled: true, idleDelayMs: 1000 },
      maxAnalyzeSteps: 20,
    });
  });

  /** @example The global sweep includes missing preferences and excludes explicit opt-outs. */
  it('lists bounded Automatic Analyze candidates from user settings', async () => {
    await serverDB.insert(userSettings).values({
      id: otherUserId,
      quickNote: {
        analyzeAgentId: null,
        autoAnalyze: { enabled: false, idleDelayMs: 6000 },
        maxAnalyzeSteps: 4,
      },
    });
    const defaultEnabled = await quickNoteRepo.create({ content: 'eligible' });
    const disabled = await otherRepo.create({ content: 'ineligible' });
    const dueAt = new Date('2026-08-24T00:00:00Z');
    // Only a real text change (re)schedules Analyze.
    await quickNoteRepo.updateContent(defaultEnabled.id, {
      content: 'eligible now',
      analyzeDueAt: dueAt,
      editorData: { root: { children: [] } },
    });
    await otherRepo.updateContent(disabled.id, {
      content: 'ineligible now',
      analyzeDueAt: dueAt,
      editorData: { root: { children: [] } },
    });

    const candidates = await QuickNoteModel.findDueAnalyzeCandidates(serverDB, {
      now: new Date('2026-08-24T00:01:00Z'),
    });

    /** @example Only the owner without an explicit opt-out is scheduled. */
    expect(candidates).toMatchObject([{ id: defaultEnabled.id, userId, workspaceId: null }]);
  });
  /** @example A due-time tie does not repeat or omit rows across sweep pages. */
  it('pages due notes after the last due-time and id pair', async () => {
    const dueAt = new Date('2026-08-24T00:00:00Z');
    const first = await quickNoteRepo.create({ id: 'qn_page_a', content: 'first' });
    const second = await quickNoteRepo.create({ id: 'qn_page_b', content: 'second' });
    await serverDB
      .update(quickNotes)
      .set({ analyzeDueAt: dueAt })
      .where(inArray(quickNotes.id, [first.id, second.id]));
    const next = await QuickNoteModel.findDueAnalyzeCandidates(serverDB, {
      after: { analyzeDueAt: dueAt, id: first.id },
      limit: 1,
      now: dueAt,
    });
    /** @example The tie-breaker advances to the second capture without skipping equal due times. */
    expect(next.map(({ id }) => id)).toEqual([second.id]);
  });

  /** @example A check whose enqueue failed is due again, unless a newer edit re-armed it. */
  it('releases a claimed content check without overriding a newer edit', async () => {
    const dueAt = new Date('2026-08-24T00:00:00Z');
    const note = await quickNoteRepo.create({ content: 'checked' });
    await serverDB
      .update(quickNotes)
      .set({ contentCheckDueAt: dueAt })
      .where(eq(quickNotes.id, note.id));
    const readDueAt = async () =>
      (await serverDB.select().from(quickNotes).where(eq(quickNotes.id, note.id)))[0]
        .contentCheckDueAt;

    expect(await QuickNoteModel.claimContentCheck(serverDB, note.id, dueAt)).toBe(true);
    /** @example The released check is due again at its original time. */
    expect(await QuickNoteModel.releaseContentCheck(serverDB, note.id, dueAt)).toBe(true);
    expect(await readDueAt()).toEqual(dueAt);

    const newerDueAt = new Date('2026-08-24T00:05:00Z');
    await QuickNoteModel.claimContentCheck(serverDB, note.id, dueAt);
    await serverDB
      .update(quickNotes)
      .set({ contentCheckDueAt: newerDueAt })
      .where(eq(quickNotes.id, note.id));
    /** @example A newer edit's later due time wins over the released one. */
    expect(await QuickNoteModel.releaseContentCheck(serverDB, note.id, dueAt)).toBe(false);
    expect(await readDueAt()).toEqual(newerDueAt);
  });

  /** @example Due work of a user without Quick Note leaves the sweep queue for good. */
  it('retires only the due work of the given user', async () => {
    const now = new Date('2026-08-24T00:00:00Z');
    const later = new Date('2026-08-24T01:00:00Z');
    const due = await quickNoteRepo.create({ content: 'due' });
    const future = await quickNoteRepo.create({ content: 'future' });
    const foreign = await otherRepo.create({ content: 'foreign' });
    await serverDB
      .update(quickNotes)
      .set({ analyzeDueAt: now, contentCheckDueAt: now })
      .where(inArray(quickNotes.id, [due.id, foreign.id]));
    await serverDB
      .update(quickNotes)
      .set({ analyzeDueAt: later, contentCheckDueAt: now })
      .where(eq(quickNotes.id, future.id));

    expect(await QuickNoteModel.retireDueWork(serverDB, userId, now)).toBe(2);

    const rows = await serverDB
      .select()
      .from(quickNotes)
      .where(inArray(quickNotes.id, [due.id, future.id, foreign.id]));
    const byId = new Map(rows.map((row) => [row.id, row]));
    /** @example Due times are cleared. */
    expect(byId.get(due.id)).toMatchObject({ analyzeDueAt: null, contentCheckDueAt: null });
    /** @example A time that is not yet due is kept. */
    expect(byId.get(future.id)).toMatchObject({ analyzeDueAt: later, contentCheckDueAt: null });
    /** @example Other users' work is untouched. */
    expect(byId.get(foreign.id)).toMatchObject({ analyzeDueAt: now, contentCheckDueAt: now });
    /** @example The sweep no longer finds the retired notes. */
    expect(
      (await QuickNoteModel.findDueAnalyzeCandidates(serverDB, { now })).map(({ id }) => id),
    ).not.toContain(due.id);
  });

  /** @example A user can refine a Proposal only until they decide on it. */
  it('edits a Proposal payload only while pending and keeps the original draft', async () => {
    const { proposal } = await seedProposal();
    const otherModel = new QuickNoteModel(serverDB, otherUserId);

    const edited = await quickNoteModel.updateProposalPayload(proposal.id, {
      instruction: 'Research duplex speech models and latency',
    });
    const foreignEdit = await otherModel.updateProposalPayload(proposal.id, { instruction: 'x' });
    await quickNoteModel.decideProposal(proposal.id, 'dismissed');
    const afterDecision = await quickNoteModel.updateProposalPayload(proposal.id, {
      instruction: 'Too late',
    });
    const [persisted] = await serverDB
      .select()
      .from(quickNoteProposals)
      .where(eq(quickNoteProposals.id, proposal.id));

    /** @example The edit overwrites the payload but keeps the AI draft for diffing. */
    expect(edited).toMatchObject({
      originalPayload: { instruction: 'Research duplex speech models' },
      payload: { instruction: 'Research duplex speech models and latency' },
    });
    /** @example Another owner and a decided Proposal both reject edits. */
    expect(foreignEdit).toBeUndefined();
    expect(afterDecision).toBeUndefined();
    expect(persisted.payload).toEqual({ instruction: 'Research duplex speech models and latency' });
  });

  /** @example Dismissing records when and why, and a decision is final. */
  it('records decided_at and the dismiss reason once', async () => {
    const { note, proposal } = await seedProposal();
    const otherModel = new QuickNoteModel(serverDB, otherUserId);

    const foreign = await otherModel.decideProposal(proposal.id, 'dismissed', 'Not mine');
    const dismissed = await quickNoteModel.decideProposal(
      proposal.id,
      'dismissed',
      '  Already done  ',
    );
    const again = await quickNoteModel.decideProposal(proposal.id, 'accepted');
    const [listed] = await quickNoteModel.queryProposals(note.id);

    expect(foreign).toBeUndefined();
    /** @example The decision carries its timestamp and trimmed reason. */
    expect(dismissed).toMatchObject({ decisionStatus: 'dismissed', dismissReason: 'Already done' });
    expect(dismissed?.decidedAt).toBeInstanceOf(Date);
    /** @example A decided Proposal cannot be decided again. */
    expect(again).toBeUndefined();
    expect(listed).toMatchObject({ decisionStatus: 'dismissed', dismissReason: 'Already done' });
  });

  /** @example Applying twice returns the same result instead of producing a second object. */
  it('marks a Proposal applied idempotently', async () => {
    const { proposal } = await seedProposal();
    const dismissedSeed = await seedProposal('Another note');
    const otherModel = new QuickNoteModel(serverDB, otherUserId);

    const foreign = await otherModel.markProposalApplied(proposal.id, 'task', 'task_foreign');
    const applied = await quickNoteModel.markProposalApplied(proposal.id, 'task', 'task_1');
    const repeated = await quickNoteModel.markProposalApplied(proposal.id, 'task', 'task_2');
    await quickNoteModel.decideProposal(dismissedSeed.proposal.id, 'dismissed');
    const afterDismiss = await quickNoteModel.markProposalApplied(
      dismissedSeed.proposal.id,
      'task',
      'task_3',
    );

    expect(foreign).toBeUndefined();
    /** @example The first apply accepts the Proposal and records its product object. */
    expect(applied).toMatchObject({
      decisionStatus: 'accepted',
      resultId: 'task_1',
      resultType: 'task',
    });
    expect(applied?.decidedAt).toBeInstanceOf(Date);
    /** @example A repeated apply returns the original result unchanged. */
    expect(repeated).toMatchObject({ resultId: 'task_1' });
    /** @example A dismissed Proposal cannot be applied. */
    expect(afterDismiss).toBeUndefined();
  });

  /** @example Executors lock only pending Proposals; stale ones stay applicable. */
  it('locks pending Proposals including stale ones', async () => {
    const { note, proposal } = await seedProposal();
    await quickNoteModel.markPendingProposalsStale(note.id, new Date());

    const locked = await serverDB.transaction(async (tx) =>
      new QuickNoteModel(tx as LobeChatDatabase, userId).lockPendingProposal(proposal.id),
    );
    const foreign = await new QuickNoteModel(serverDB, otherUserId).lockPendingProposal(
      proposal.id,
    );
    await quickNoteModel.decideProposal(proposal.id, 'dismissed');
    const decided = await quickNoteModel.lockPendingProposal(proposal.id);

    expect(locked).toMatchObject({ id: proposal.id, validity: 'stale' });
    expect(foreign).toBeUndefined();
    expect(decided).toBeUndefined();
  });

  // ROOT CAUSE:
  // Only stale Proposals were superseded. With Auto Analyze on, the next Run lands before the
  // debounced meaning check marks anything stale, so earlier suggestions stayed pending + current.
  /** @example A newer judgement supersedes every pending earlier suggestion, not decided ones. */
  it.each([
    ['current', false],
    ['stale', true],
  ])('supersedes a %s pending Proposal of an earlier Run', async (_, markStale) => {
    const { note, proposal: decided } = await seedProposal();
    await quickNoteModel.decideProposal(decided.id, 'dismissed');
    const earlierRun = await claimAnalyze(note.id);
    const earlierOutput = await quickNoteRepo.completeRun(earlierRun!.id, {
      proposals: [{ kind: 'topic', payload: { title: 'Discuss' } }],
    });
    const pending = earlierOutput!.proposals[0];
    if (markStale) await quickNoteModel.markPendingProposalsStale(note.id, new Date());
    const foreign = await new QuickNoteModel(serverDB, otherUserId).supersedeEarlierProposals(
      note.id,
      '00000000-0000-0000-0000-000000000000',
    );
    const latestRun = await claimAnalyze(note.id);
    const latestOutput = await quickNoteRepo.completeRun(latestRun!.id, {
      proposals: [{ kind: 'goal', payload: { title: 'New goal' } }],
    });
    const repeated = await quickNoteModel.supersedeEarlierProposals(note.id, latestRun!.id);
    const byId = new Map(
      (await quickNoteModel.queryProposals(note.id)).map((proposal) => [proposal.id, proposal]),
    );

    expect(foreign).toEqual([]);
    /** @example Completing a Run of the current source supersedes the earlier pending Proposal. */
    expect(latestOutput!.superseded.map(({ id }) => id)).toEqual([pending.id]);
    expect(repeated).toEqual([]);
    expect(byId.get(pending.id)).toMatchObject({
      decisionStatus: 'pending',
      validity: 'superseded',
    });
    /** @example A decided Proposal keeps its record. */
    expect(byId.get(decided.id)).toMatchObject({
      decisionStatus: 'dismissed',
      validity: 'current',
    });
    /** @example The new Run's Proposal stays current. */
    expect(byId.get(latestOutput!.proposals[0].id)?.validity).toBe('current');
  });
});

/** @example The list projects when the latest Run finished, for 「已分析 HH:MM」. */
describe('QuickNoteModel run completion time', () => {
  it('lists the latest Run with its completion time', async () => {
    const { note } = await seedProposal();
    const {
      items: [details],
    } = await quickNoteModel.queryDetails();

    expect(details.id).toBe(note.id);
    expect(details.run).toMatchObject({ completedAt: expect.any(Date), status: 'completed' });
  });
});

/** @example The list projection picks one Run and one summary per note from a long history. */
describe('QuickNoteModel run projection', () => {
  const at = (minute: number) => new Date(Date.UTC(2026, 0, 1, 0, minute));

  it('returns the latest active Run and the latest completed summary among many Runs', async () => {
    const note = await quickNoteRepo.create({ content: 'Long history' });
    // Claim once for a real source revision, then replace the Run with a seeded history.
    const history = (await claimAnalyze(note.id))!;
    await serverDB.delete(quickNoteRuns).where(eq(quickNoteRuns.id, history.id));
    const base = {
      kind: 'analyze' as const,
      quickNoteId: note.id,
      sourceHistoryId: history.sourceHistoryId,
    };

    await serverDB.insert(quickNoteRuns).values([
      // Many older completed Runs with summaries.
      ...Array.from({ length: 30 }, (_, index) => ({
        ...base,
        completedAt: at(index),
        status: 'completed' as const,
        summary: `Summary ${index}`,
        updatedAt: at(index),
      })),
      // Newer completed Runs whose summary is missing or empty never replace the summary.
      {
        ...base,
        completedAt: at(40),
        status: 'completed' as const,
        summary: null,
        updatedAt: at(40),
      },
      {
        ...base,
        completedAt: at(41),
        status: 'completed' as const,
        summary: '',
        updatedAt: at(41),
      },
      // The most recently updated Run is terminal; the older active one still wins.
      { ...base, completedAt: at(50), status: 'failed' as const, updatedAt: at(50) },
      {
        ...base,
        kind: 'signal_enrichment' as const,
        status: 'running' as const,
        updatedAt: at(45),
      },
    ]);

    const detail = await quickNoteModel.queryDetail(note.id);

    expect(detail?.summary).toEqual({ completedAt: at(29), content: 'Summary 29' });
    expect(detail?.run).toMatchObject({ kind: 'signal_enrichment', status: 'running' });

    await serverDB
      .update(quickNoteRuns)
      .set({ completedAt: at(51), status: 'canceled', updatedAt: at(44) })
      .where(and(eq(quickNoteRuns.quickNoteId, note.id), eq(quickNoteRuns.status, 'running')));
    const settled = await quickNoteModel.queryDetail(note.id);

    /** @example Without an active Run, the most recently updated Run is shown. */
    expect(settled?.run).toMatchObject({ status: 'failed', updatedAt: at(50) });
  });
});

// ROOT CAUSE:
// A failed Run kept `analyze_due_at`, so the minute sweep claimed the same note again and again
// (four full Agent runs in 3.5 minutes) until the user edited it.
/** @example Automatic Analyze backs off after failures and stops at the cap for one version. */
describe('QuickNoteModel failed Run scheduling', () => {
  const error = { code: 'start_failed', message: 'boom' };
  const dueAtOf = async (id: string) => {
    const [row] = await serverDB
      .select({ dueAt: quickNotes.analyzeDueAt })
      .from(quickNotes)
      .where(eq(quickNotes.id, id));
    return row?.dueAt?.getTime() ?? null;
  };
  const seedDueNote = async (content = 'Research duplex speech models') => {
    const note = await quickNoteRepo.create({
      analyzeDueAt: new Date(Date.now() - 1000),
      content,
      editorData: { markdown: content },
    });
    return note;
  };
  const failNextRun = async (id: string, retryable?: boolean) => {
    const run = await claimAnalyze(id);
    await quickNoteModel.failRun(
      run!.id,
      error,
      retryable === undefined ? undefined : { retryable },
    );
  };

  it('backs off, then stops retrying after the cap until the note changes', async () => {
    const note = await seedDueNote();

    for (let failure = 1; failure < QUICK_NOTE_MAX_AUTOMATIC_FAILURES; failure += 1) {
      const before = Date.now();
      await failNextRun(note.id);
      /** @example 1 min after the first failure, 2 min after the second. */
      expect(await dueAtOf(note.id)).toBeGreaterThanOrEqual(
        before + QUICK_NOTE_FAILURE_RETRY_BASE_MS * 2 ** (failure - 1),
      );
    }
    await failNextRun(note.id);
    /** @example The cap clears the schedule; the sweep no longer claims the note. */
    expect(await dueAtOf(note.id)).toBeNull();

    // A real edit re-arms Automatic Analyze and starts a fresh failure count.
    await quickNoteRepo.updateContent(note.id, {
      analyzeDueAt: new Date(Date.now() - 1000),
      content: 'Research sesame latency',
      editorData: { markdown: 'Research sesame latency' },
    });
    const before = Date.now();
    await failNextRun(note.id);
    expect(await dueAtOf(note.id)).toBeGreaterThanOrEqual(
      before + QUICK_NOTE_FAILURE_RETRY_BASE_MS,
    );
    expect(await dueAtOf(note.id)).toBeLessThan(before + 2 * QUICK_NOTE_FAILURE_RETRY_BASE_MS);
  });

  it('stops at once after a non-retryable failure', async () => {
    const note = await seedDueNote();
    await failNextRun(note.id, false);
    expect(await dueAtOf(note.id)).toBeNull();
  });

  it('leaves the schedule of a newer edit alone', async () => {
    const note = await seedDueNote();
    const run = await claimAnalyze(note.id);
    const newerDueAt = new Date(Date.now() + 6000);
    await quickNoteRepo.updateContent(note.id, {
      analyzeDueAt: newerDueAt,
      content: 'Edited while running',
      editorData: { markdown: 'Edited while running' },
    });

    await quickNoteModel.failRun(run!.id, error, { retryable: false });

    expect(await dueAtOf(note.id)).toBe(newerDueAt.getTime());
  });
});

// ROOT CAUSE:
// Workspace-mode Topic authorization matched `topics.workspace_id` only, so any member could link
// another member's Topic, including one under a private Agent (via `create.resources` or an
// Analyze `linkResource`), and then read its title through the Quick Note resource list.
/** @example A workspace member links only the Topics they may see. */
describe('QuickNoteModel workspace Topic resources', () => {
  const workspaceId = 'quick-note-model-topic-ws';
  const ownTopicId = 'quick-note-ws-own-topic';
  const foreignTopicId = 'quick-note-ws-foreign-topic';
  const wsRepo = new QuickNoteRepository(serverDB, userId, workspaceId);
  const wsModel = new QuickNoteModel(serverDB, userId, workspaceId);

  beforeEach(async () => {
    await serverDB
      .insert(workspaces)
      .values({ id: workspaceId, name: 'ws', primaryOwnerId: otherUserId, slug: workspaceId });
    await serverDB.insert(workspaceMembers).values([
      { userId, workspaceId },
      { userId: otherUserId, workspaceId },
    ]);
    await serverDB.insert(topics).values([
      { id: ownTopicId, title: 'My workspace topic', userId, workspaceId },
      { id: foreignTopicId, title: 'Teammate topic', userId: otherUserId, workspaceId },
    ]);
  });

  afterEach(async () => {
    await serverDB.delete(workspaces).where(eq(workspaces.id, workspaceId));
  });

  it('skips another member’s Topic sent with a new note', async () => {
    const note = await wsRepo.create({
      content: 'Sent from topics',
      resources: [
        { id: foreignTopicId, type: 'topic' },
        { id: ownTopicId, type: 'topic' },
      ],
    });

    const details = await wsModel.queryAgenticDetails(note.id);

    /** @example Only the caller's own Topic is linked and listed. */
    expect(details.resources.map(({ resourceId }) => resourceId)).toEqual([ownTopicId]);
  });

  it('rejects another member’s Topic reported by an Analyze Run', async () => {
    const note = await wsRepo.create({ content: 'Analyze me', editorData: { markdown: 'x' } });
    const run = await wsRepo.claimRun(note.id, { kind: 'analyze', renderSourceText });

    const rejected = await wsModel.linkResource(run!.id, { id: foreignTopicId, type: 'topic' });
    const rejectedConversation = await wsModel.linkResource(run!.id, {
      id: foreignTopicId,
      type: 'conversation',
    });
    const accepted = await wsModel.linkResource(run!.id, { id: ownTopicId, type: 'topic' });

    expect(rejected).toBeUndefined();
    expect(rejectedConversation).toBeUndefined();
    expect(accepted).toMatchObject({ resourceId: ownTopicId, resourceType: 'topic' });
  });

  it('keeps personal mode limited to the caller’s personal Topics', async () => {
    await serverDB
      .insert(topics)
      .values({ id: 'quick-note-personal-topic', title: 'Personal topic', userId });
    const note = await quickNoteRepo.create({
      content: 'Personal capture',
      resources: [
        { id: 'quick-note-personal-topic', type: 'topic' },
        { id: ownTopicId, type: 'topic' },
      ],
    });

    const details = await quickNoteModel.queryAgenticDetails(note.id);

    /** @example A workspace Topic is not personal context, even for its creator. */
    expect(details.resources.map(({ resourceId }) => resourceId)).toEqual([
      'quick-note-personal-topic',
    ]);
  });
});
