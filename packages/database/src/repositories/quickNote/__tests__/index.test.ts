// @vitest-environment node
import { and, eq, inArray } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import type { ClaimQuickNoteRunParams } from '../../../models/quickNote';
import { QuickNoteModel } from '../../../models/quickNote';
import { TaskModel } from '../../../models/task';
import {
  documentHistories,
  documents,
  quickNoteResources,
  quickNoteRuns,
  quickNotes,
  tasks,
  topics,
  users,
} from '../../../schemas';
import type { LobeChatDatabase } from '../../../type';
import { QuickNoteRepository } from '../index';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'quick-note-repo-user';
const otherUserId = 'quick-note-repo-other-user';
const quickNoteModel = new QuickNoteModel(serverDB, userId);
const quickNoteRepo = new QuickNoteRepository(serverDB, userId);
const otherRepo = new QuickNoteRepository(serverDB, otherUserId);

/** Test renderer: Markdown editor projections render to their Markdown text. */
const renderSourceText = (editorData: Record<string, unknown>) =>
  typeof editorData.markdown === 'string' ? editorData.markdown : '';

const claim = (
  id: string,
  params: Omit<ClaimQuickNoteRunParams, 'renderSourceText'> = { kind: 'analyze' },
  repo = quickNoteRepo,
) => repo.claimRun(id, { ...params, renderSourceText });

beforeEach(async () => {
  await serverDB.delete(users);
  await serverDB.insert(users).values([{ id: userId }, { id: otherUserId }]);
});

afterEach(async () => {
  await serverDB.delete(users);
});

describe('QuickNoteRepository', () => {
  /** @example Creating "Remember Tokyo" returns the persisted note and its backing Document. */
  it('creates a Quick Note with one backing Document and no Topic', async () => {
    const topicsBefore = await serverDB.select().from(topics).where(eq(topics.userId, userId));
    const note = await quickNoteRepo.create({
      content: 'Remember Tokyo',
      editorData: { root: { children: [] } },
      location: 'Shanghai',
      tags: ['travel'],
    });

    const [document] = await serverDB
      .select()
      .from(documents)
      .where(eq(documents.id, note.documentId));
    const topicsAfter = await serverDB.select().from(topics).where(eq(topics.userId, userId));

    /** @example The source content remains in the hidden backing Document. */
    expect(document).toMatchObject({
      content: 'Remember Tokyo',
      sourceType: 'quick-note',
      userId,
      visibility: 'private',
    });
    /** @example Capture alone no longer creates a hidden Topic. */
    expect(topicsAfter).toHaveLength(topicsBefore.length);
    /** @example The main record owns organization rather than copied content. */
    expect(note).toMatchObject({ location: 'Shanghai', tags: ['travel'], userId });
  });

  /** @example A capture sent from a Topic and a Page links both as user-supplied context. */
  it('links accessible create-time resources as context and skips the rest', async () => {
    await serverDB.insert(topics).values({ id: 'qn-sent-topic', title: 'Origin chat', userId });
    await serverDB.insert(documents).values([
      {
        content: 'Origin page',
        fileType: 'text/plain',
        id: 'qn-sent-page',
        source: 'manual',
        sourceType: 'api',
        title: 'Origin page',
        totalCharCount: 11,
        totalLineCount: 1,
        userId,
      },
      {
        content: 'Foreign page',
        fileType: 'text/plain',
        id: 'qn-foreign-page',
        source: 'manual',
        sourceType: 'api',
        totalCharCount: 12,
        totalLineCount: 1,
        userId: otherUserId,
      },
    ]);

    const note = await quickNoteRepo.create({
      content: 'Sent from elsewhere',
      editorData: { markdown: 'Sent from elsewhere' },
      resources: [
        { id: 'qn-sent-topic', selector: { messageId: 'msg_1' }, type: 'topic' },
        { id: 'qn-sent-page', type: 'page' },
        { id: 'qn-foreign-page', type: 'document' },
      ],
    });
    const resources = await serverDB
      .select()
      .from(quickNoteResources)
      .where(eq(quickNoteResources.quickNoteId, note.id));
    const [history] = await serverDB
      .select()
      .from(documentHistories)
      .where(eq(documentHistories.id, resources[0].sourceHistoryId));
    const details = await quickNoteModel.queryAgenticDetails(note.id);

    /** @example Only the two accessible references are linked. */
    expect(resources.map(({ resourceId }) => resourceId).sort()).toEqual([
      'qn-sent-page',
      'qn-sent-topic',
    ]);
    /** @example User-supplied links are context without a producing Run. */
    expect(resources.every(({ role, runId }) => role === 'context' && runId === null)).toBe(true);
    /** @example Links are bound to a system revision of the initial source. */
    expect(history).toMatchObject({ documentId: note.documentId, saveSource: 'system' });
    /** @example The selector is kept with the link. */
    expect(resources.find(({ resourceId }) => resourceId === 'qn-sent-topic')?.selector).toEqual({
      messageId: 'msg_1',
    });

    await quickNoteRepo.updateContent(note.id, {
      content: 'Edited after sending',
      editorData: { markdown: 'Edited after sending' },
    });
    const afterEdit = await quickNoteModel.queryAgenticDetails(note.id);

    /** @example User-supplied links stay visible on the detail surface after a source edit. */
    expect(details.resources).toHaveLength(2);
    expect(afterEdit.resources).toHaveLength(2);
  });

  /** @example Rich-text autosaves retain bounded Document History revisions. */
  it('coalesces source edits through the shared Document History window', async () => {
    const firstEditorData = { root: { children: [{ text: 'Version one' }] } };
    const secondEditorData = { root: { children: [{ text: 'Version two' }] } };
    const note = await quickNoteRepo.create({
      content: 'Version one',
      editorData: firstEditorData,
    });

    await quickNoteRepo.updateContent(note.id, {
      content: 'Version two',
      editorData: secondEditorData,
    });
    await quickNoteRepo.updateContent(note.id, {
      content: 'Version three',
      editorData: { root: { children: [{ text: 'Version three' }] } },
    });
    const autosaves = await serverDB
      .select()
      .from(documentHistories)
      .where(
        and(
          eq(documentHistories.documentId, note.documentId),
          eq(documentHistories.saveSource, 'autosave'),
        ),
      );

    /** @example Continuous edits share one bounded autosave row. */
    expect(autosaves).toHaveLength(1);
    /** @example The row preserves the immediately previous rich-text revision. */
    expect(autosaves[0].editorData).toEqual(secondEditorData);
  });

  /** @example A background Run reads a stable source snapshot, not the mutable autosave row. */
  it('claims a Run against a non-coalescing Document History snapshot', async () => {
    const editorData = { root: { children: [{ text: 'Version one' }] } };
    const note = await quickNoteRepo.create({ content: 'Version one', editorData });

    const run = await claim(note.id, { kind: 'analyze', trigger: 'manual' });

    const [history] = await serverDB
      .select()
      .from(documentHistories)
      .where(eq(documentHistories.id, run?.sourceHistoryId ?? 'missing'));
    const [persistedRun] = await serverDB
      .select()
      .from(quickNoteRuns)
      .where(eq(quickNoteRuns.id, run?.id ?? '00000000-0000-0000-0000-000000000000'));

    /** @example The Run pins a system snapshot that autosave will not coalesce. */
    expect(history).toMatchObject({
      documentId: note.documentId,
      editorData,
      saveSource: 'system',
    });
    /** @example The domain Run stores the same immutable source identity. */
    expect(persistedRun?.sourceHistoryId).toBe(history?.id);
    /** @example Trigger provenance is pinned with the source revision. */
    expect(persistedRun?.trigger).toBe('manual');
  });

  /** @example A pending Analyze for unchanged content is claimed only once. */
  it('deduplicates active Runs for the same source snapshot and kind', async () => {
    const note = await quickNoteRepo.create({
      content: 'Stable content',
      editorData: { root: { children: [] } },
    });

    const first = await claim(note.id);
    const second = await claim(note.id);
    const runs = await serverDB
      .select()
      .from(quickNoteRuns)
      .where(and(eq(quickNoteRuns.quickNoteId, note.id), eq(quickNoteRuns.kind, 'analyze')));

    /** @example Both claim callers observe the same active Run. */
    expect(second?.id).toBe(first?.id);
    /** @example Only one active Run row exists. */
    expect(runs).toHaveLength(1);
  });

  /** @example A Run records the rendered text of the source, Comments, and pending Proposals. */
  it('persists a rendered input snapshot that later edits do not change', async () => {
    const note = await quickNoteRepo.create({
      content: 'Compare gpt-live and moshi',
      editorData: { markdown: 'Compare gpt-live and moshi' },
    });
    const comment = await quickNoteModel.createComment(note.id, { content: 'Initial feedback' });
    const first = await claim(note.id);
    const firstOutput = await quickNoteRepo.completeRun(first!.id, {
      proposals: [{ kind: 'task', payload: { instruction: 'Research both' }, preset: 'research' }],
      summary: 'Two speech models',
    });
    await quickNoteModel.updateComment(comment!.id, { content: 'Revised feedback' });

    const second = await claim(note.id);
    const [firstRun] = await serverDB
      .select()
      .from(quickNoteRuns)
      .where(eq(quickNoteRuns.id, first!.id));
    const secondContext = await quickNoteModel.getRunContext(second!.id);

    /** @example The first Run keeps the Comment text present at claim time. */
    expect(firstRun.inputSnapshot).toEqual({
      comments: [{ content: 'Initial feedback', id: comment!.id }],
      pendingProposals: [],
      source: 'Compare gpt-live and moshi',
      sourceHistoryId: first!.sourceHistoryId,
    });
    /** @example A later Run sees the overwritten Comment and the pending Proposal payload. */
    expect(secondContext?.inputSnapshot).toEqual({
      comments: [{ content: 'Revised feedback', id: comment!.id }],
      pendingProposals: [
        {
          id: firstOutput!.proposals[0].id,
          kind: 'task',
          payload: { instruction: 'Research both' },
        },
      ],
      source: 'Compare gpt-live and moshi',
      sourceHistoryId: second!.sourceHistoryId,
    });
  });

  /** @example Completing an Analyze Run stores its summary, decision, tags, and Proposals. */
  it('completes a Run with summary, decision, tags, and Proposals', async () => {
    const note = await quickNoteRepo.create({ content: 'Unclassified thought' });
    const run = await claim(note.id);
    const decision = {
      decisionMode: 'emulated' as const,
      evidence: 'Mentions research explicitly',
      model: 'gpt-mini',
      provider: 'openai',
      preset: 'research' as const,
      primary: 'delegate' as const,
      scores: { delegate: 3, enrich: 2, keep: 1, link: 0 } as const,
    };

    const output = await quickNoteRepo.completeRun(run!.id, {
      decision,
      proposals: [{ kind: 'task', payload: { instruction: 'Research it' }, preset: 'research' }],
      summary: '  A concise interpretation  ',
      tags: ['idea'],
    });
    const repeated = await quickNoteRepo.completeRun(run!.id, { summary: 'Twice' });
    const {
      items: [details],
    } = await quickNoteModel.queryDetails();

    /** @example The Run carries the trimmed summary and the full decision. */
    expect(output?.run).toMatchObject({
      decision,
      status: 'completed',
      summary: 'A concise interpretation',
    });
    /** @example A Proposal keeps its AI draft as the original payload. */
    expect(output?.proposals[0]).toMatchObject({
      decisionStatus: 'pending',
      kind: 'task',
      originalPayload: { instruction: 'Research it' },
      payload: { instruction: 'Research it' },
      preset: 'research',
      validity: 'current',
    });
    /** @example A terminal Run cannot be completed twice. */
    expect(repeated).toBeUndefined();
    /** @example The list projection exposes the latest summary and merged tags. */
    expect(details).toMatchObject({
      summary: { content: 'A concise interpretation' },
      tags: ['idea'],
    });
  });

  /** @example Cosmetic edits neither invalidate suggestions nor reschedule Analyze. */
  it('classifies text edits without marking Proposals stale', async () => {
    const note = await quickNoteRepo.create({ content: '我好喜欢北京' });
    const run = await claim(note.id);
    const output = await quickNoteRepo.completeRun(run!.id, {
      proposals: [{ kind: 'task', payload: { instruction: 'x', name: 'y' } }],
    });
    const dueAt = new Date('2026-10-20T01:00:00Z');
    const nextDueAt = new Date('2026-10-20T02:00:00Z');
    await serverDB
      .update(quickNotes)
      .set({ analyzeDueAt: dueAt })
      .where(eq(quickNotes.id, note.id));
    const isEquivalentText = (previous: string, next: string) =>
      previous.replaceAll('。', '') === next.replaceAll('。', '');

    const equivalent = await quickNoteRepo.updateContent(note.id, {
      analyzeDueAt: nextDueAt,
      content: '我好喜欢北京。',
      editorData: { markdown: '我好喜欢北京。' },
      isEquivalentText,
    });
    const changed = await quickNoteRepo.updateContent(note.id, {
      analyzeDueAt: nextDueAt,
      content: '我不喜欢北京。',
      editorData: { markdown: '我不喜欢北京。' },
      isEquivalentText,
    });
    const [proposal] = await quickNoteModel.queryProposals(note.id);

    /** @example A trailing full stop keeps the existing Analyze schedule. */
    expect(equivalent).toMatchObject({ analyzeDueAt: dueAt, contentChange: 'equivalent' });
    /** @example A real edit restarts the quiet period. */
    expect(changed).toMatchObject({ analyzeDueAt: nextDueAt, contentChange: 'changed' });
    /** @example Staleness is decided asynchronously, never by the save itself. */
    expect(proposal).toMatchObject({ id: output!.proposals[0].id, validity: 'current' });
  });

  /** @example An old Run remains auditable but cannot change current tags after editing. */
  it('does not let a stale Run mutate current tags or due time', async () => {
    const note = await quickNoteRepo.create({ content: 'Version one' });
    const oldRun = await claim(note.id);
    const dueAt = new Date('2026-08-24T01:00:00Z');
    await quickNoteRepo.updateContent(note.id, {
      content: 'Version two',
      analyzeDueAt: dueAt,
      editorData: { root: { children: [{ text: 'Version two' }] } },
    });

    const output = await quickNoteRepo.completeRun(oldRun!.id, {
      summary: 'Stale summary',
      tags: ['stale-tag'],
    });
    const [persistedNote] = await serverDB
      .select()
      .from(quickNotes)
      .where(eq(quickNotes.id, note.id));

    /** @example The stale Run itself is still completed with its summary for auditing. */
    expect(output?.run).toMatchObject({ status: 'completed', summary: 'Stale summary' });
    /** @example The newer edit remains eligible for a fresh Analyze claim. */
    expect(persistedNote.analyzeDueAt).toEqual(dueAt);
    /** @example Stale interpretation metadata cannot leak into the current source revision. */
    expect(persistedNote.tags).toEqual([]);
  });

  /** @example A save that lands between the completion read and its write still wins. */
  it('re-checks the source after reading the Run for completion', async () => {
    // ROOT CAUSE:
    // Completion decided "current" from the editor data read before its write. A save committing
    // in between left the Run looking current, so it cleared the new due time and wrote its tags.
    const note = await quickNoteRepo.create({ content: 'Version one' });
    const run = await claim(note.id);
    const snapshot = await quickNoteModel.findRunForCompletion(run!.id);
    const dueAt = new Date('2026-08-24T01:00:00Z');
    await quickNoteRepo.updateContent(note.id, {
      analyzeDueAt: dueAt,
      content: 'Version two',
      editorData: { root: { children: [{ text: 'Version two' }] } },
    });

    const completion = await quickNoteModel.completeRun(run!.id, snapshot!, {
      summary: 'Outdated summary',
      tags: ['outdated-tag'],
    });
    const [persistedNote] = await serverDB
      .select()
      .from(quickNotes)
      .where(eq(quickNotes.id, note.id));

    /** @example The Run completes but is reported as judging an outdated source. */
    expect(completion).toMatchObject({ run: { status: 'completed' }, sourceIsCurrent: false });
    /** @example The newer edit keeps its Automatic Analyze due time. */
    expect(persistedNote.analyzeDueAt).toEqual(dueAt);
    /** @example Outdated tags do not reach the current note. */
    expect(persistedNote.tags).toEqual([]);
  });

  /** @example Another owner cannot complete, claim, or create against a foreign note. */
  it('keeps Run claim and completion owner-scoped', async () => {
    const note = await quickNoteRepo.create({ content: 'Private' });
    const run = await claim(note.id);

    const foreignClaim = await claim(note.id, { kind: 'analyze' }, otherRepo);
    const foreignComplete = await otherRepo.completeRun(run!.id, { summary: 'Hijack' });
    const [persisted] = await serverDB
      .select()
      .from(quickNoteRuns)
      .where(eq(quickNoteRuns.id, run!.id));

    expect(foreignClaim).toBeUndefined();
    expect(foreignComplete).toBeUndefined();
    expect(persisted.status).toBe('pending');
  });

  /** @example Removing a Quick Note cleans its source Document and its Runs' Topics. */
  it('deletes the source Document and Run Topics without touching unrelated objects', async () => {
    const note = await quickNoteRepo.create({ content: 'Disposable' });
    const run = await claim(note.id);
    await serverDB.insert(topics).values([
      { id: 'qn-run-topic', title: 'Run topic', userId },
      { id: 'qn-unrelated-topic', title: 'Keep me', userId },
    ]);
    await serverDB
      .update(quickNoteRuns)
      .set({ topicId: 'qn-run-topic' })
      .where(eq(quickNoteRuns.id, run!.id));
    await quickNoteRepo.completeRun(run!.id, {
      proposals: [{ kind: 'task', payload: { instruction: 'Generated' } }],
      summary: 'Generated',
    });
    await quickNoteModel.createComment(note.id, { content: 'Disposable feedback' });
    const unrelatedDocumentId = 'quick-note-unrelated-document';
    await serverDB.insert(documents).values({
      content: 'Keep me',
      fileType: 'text/plain',
      id: unrelatedDocumentId,
      source: 'manual',
      sourceType: 'api',
      totalCharCount: 7,
      totalLineCount: 1,
      userId,
    });

    const foreignDelete = await otherRepo.delete(note.id);
    const deleted = await quickNoteRepo.delete(note.id);
    const remainingDocuments = await serverDB
      .select({ id: documents.id })
      .from(documents)
      .where(inArray(documents.id, [note.documentId, unrelatedDocumentId]));
    const remainingTopics = await serverDB
      .select({ id: topics.id })
      .from(topics)
      .where(inArray(topics.id, ['qn-run-topic', 'qn-unrelated-topic']));
    const remainingRuns = await serverDB
      .select()
      .from(quickNoteRuns)
      .where(eq(quickNoteRuns.quickNoteId, note.id));

    /** @example Another owner cannot delete the capture. */
    expect(foreignDelete).toBe(false);
    /** @example The owner can delete the capture. */
    expect(deleted).toBe(true);
    /** @example Only the unrelated user Document remains. */
    expect(remainingDocuments).toEqual([{ id: unrelatedDocumentId }]);
    /** @example The Run Topic is removed with the capture; unrelated Topics stay. */
    expect(remainingTopics).toEqual([{ id: 'qn-unrelated-topic' }]);
    /** @example Runs cascade with the capture. */
    expect(remainingRuns).toEqual([]);
  });

  // ROOT CAUSE:
  // Tasks a note started stay hidden from task lists and Recent (they are listed in the note
  // sidebar). Deleting the note left them reachable only by direct link.
  /** @example Deleting a note returns its Tasks to the normal task list. */
  it('turns the Tasks a deleted note started into ordinary Tasks', async () => {
    const note = await quickNoteRepo.create({ content: 'Research moshi' });
    const otherNote = await quickNoteRepo.create({ content: 'Keep me' });
    const seedTask = (id: string, quickNoteId: string, seq: number) =>
      serverDB.insert(tasks).values({
        context: { keep: true, source: { quickNoteId, runId: 'r', type: 'quick_note' } },
        createdByUserId: userId,
        id,
        identifier: `T-${seq}`,
        instruction: 'Compare moshi',
        seq,
      });
    await seedTask('task-of-deleted-note', note.id, 1);
    await seedTask('task-of-kept-note', otherNote.id, 2);
    const taskModel = new TaskModel(serverDB, userId);
    const before = await taskModel.list();

    await otherRepo.delete(note.id);
    const afterForeign = await serverDB
      .select()
      .from(tasks)
      .where(eq(tasks.id, 'task-of-deleted-note'));
    await quickNoteRepo.delete(note.id);
    const listed = await taskModel.list();
    const [detached] = await serverDB
      .select()
      .from(tasks)
      .where(eq(tasks.id, 'task-of-deleted-note'));

    expect(before.tasks).toEqual([]);
    /** @example Another owner's delete changes nothing. */
    expect(afterForeign[0].context).toMatchObject({ source: { quickNoteId: note.id } });
    /** @example The detached Task is listed again; the other note's Task stays hidden. */
    expect(listed.tasks.map(({ id }) => id)).toEqual(['task-of-deleted-note']);
    expect(detached.context).toEqual({ keep: true });
  });
});
