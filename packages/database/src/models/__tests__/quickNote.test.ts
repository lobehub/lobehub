// @vitest-environment node
import { and, eq, inArray } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import {
  documentHistories,
  documents,
  quickNoteCommentRevisions,
  quickNoteComments,
  quickNoteResources,
  quickNoteRunInputs,
  quickNoteRunResources,
  quickNoteRuns,
  quickNotes,
  tasks,
  topics,
  users,
  userSettings,
} from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { QuickNoteModel } from '../quickNote';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'quick-note-model-user';
const otherUserId = 'quick-note-model-other-user';
const quickNoteModel = new QuickNoteModel(serverDB, userId);

beforeEach(async () => {
  await serverDB.delete(users);
  await serverDB.insert(users).values([{ id: userId }, { id: otherUserId }]);
});

afterEach(async () => {
  await serverDB.delete(users);
});

/** @example A capture creates its private content and conversation containers atomically. */
describe('QuickNoteModel', () => {
  /** @example Creating "Remember Tokyo" returns the persisted note and backing IDs. */
  it('creates a Quick Note with one backing Document and Topic', async () => {
    const note = await quickNoteModel.create({
      content: 'Remember Tokyo',
      editorData: { root: { children: [] } },
      location: 'Shanghai',
      tags: ['travel'],
    });

    const [document] = await serverDB
      .select()
      .from(documents)
      .where(eq(documents.id, note.documentId));
    const [topic] = await serverDB.select().from(topics).where(eq(topics.id, note.topicId));

    /** @example The source content remains in the hidden backing Document. */
    expect(document).toMatchObject({
      content: 'Remember Tokyo',
      sourceType: 'quick-note',
      userId,
      visibility: 'private',
    });
    /** @example The hidden Topic is scoped to the same owner. */
    expect(topic).toMatchObject({ trigger: 'quick-note', userId });
    /** @example The main record owns organization rather than copied content. */
    expect(note).toMatchObject({ location: 'Shanghai', tags: ['travel'], userId });
  });

  /** @example A second user cannot read or mutate another user's capture. */
  it('keeps Quick Notes isolated by owner', async () => {
    const note = await quickNoteModel.create({ content: 'private note' });
    const otherModel = new QuickNoteModel(serverDB, otherUserId);

    const otherNotes = await otherModel.query();
    const updateResult = await otherModel.updateContent(note.id, {
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

  /** @example Rich-text autosaves retain bounded Document History revisions. */
  it('coalesces source edits through the shared Document History window', async () => {
    const firstEditorData = { root: { children: [{ text: 'Version one' }] } };
    const secondEditorData = { root: { children: [{ text: 'Version two' }] } };
    const note = await quickNoteModel.create({
      content: 'Version one',
      editorData: firstEditorData,
    });

    await quickNoteModel.updateContent(note.id, {
      content: 'Version two',
      editorData: secondEditorData,
    });
    await quickNoteModel.updateContent(note.id, {
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

  /** @example Editing feedback preserves the submitted text that an earlier Run consumed. */
  it('keeps Comment revisions append-only and owner-scoped', async () => {
    const note = await quickNoteModel.create({ content: 'An unresolved capture' });
    const created = await quickNoteModel.createComment(note.id, {
      content: 'Please consider the data requirement.',
      editorData: { markdown: 'Please consider the data requirement.' },
    });
    const updated = await quickNoteModel.updateComment(created!.comment.id, {
      content: 'Please consider the training data requirement.',
      editorData: { markdown: 'Please consider the training data requirement.' },
    });
    const otherModel = new QuickNoteModel(serverDB, otherUserId);
    const rejected = await otherModel.updateComment(created!.comment.id, {
      content: 'Cross-owner edit',
    });
    const rejectedCreate = await otherModel.createComment(note.id, { content: 'Cross-owner add' });
    const hiddenComments = await otherModel.queryComments(note.id);
    const revisions = await serverDB
      .select()
      .from(quickNoteCommentRevisions)
      .where(eq(quickNoteCommentRevisions.commentId, created!.comment.id))
      .orderBy(quickNoteCommentRevisions.createdAt, quickNoteCommentRevisions.id);
    const [comment] = await serverDB
      .select()
      .from(quickNoteComments)
      .where(eq(quickNoteComments.id, created!.comment.id));

    /** @example The lightweight Comment row contains only its current projection. */
    expect(comment.content).toBe('Please consider the training data requirement.');
    /** @example Create and edit each produce a stable revision identity. */
    expect(revisions.map(({ content }) => content)).toEqual([
      'Please consider the data requirement.',
      'Please consider the training data requirement.',
    ]);
    /** @example The edit API returns the newly submitted revision. */
    expect(updated?.revision.content).toBe('Please consider the training data requirement.');
    /** @example Another owner cannot rewrite the feedback stream. */
    expect(rejected).toBeUndefined();
    /** @example Another owner cannot append feedback to the capture. */
    expect(rejectedCreate).toBeUndefined();
    /** @example Another owner cannot list the feedback stream. */
    expect(hiddenComments).toEqual([]);
  });

  /** @example A background Run reads a stable source snapshot, not the mutable autosave row. */
  it('claims a Run against a non-coalescing Document History snapshot', async () => {
    const editorData = { root: { children: [{ text: 'Version one' }] } };
    const note = await quickNoteModel.create({ content: 'Version one', editorData });

    const run = await quickNoteModel.claimRun(note.id, { kind: 'analyze', trigger: 'manual' });

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
    const note = await quickNoteModel.create({
      content: 'Stable content',
      editorData: { root: { children: [] } },
    });

    const first = await quickNoteModel.claimRun(note.id, { kind: 'analyze' });
    const second = await quickNoteModel.claimRun(note.id, { kind: 'analyze' });
    const runs = await serverDB
      .select()
      .from(quickNoteRuns)
      .where(and(eq(quickNoteRuns.quickNoteId, note.id), eq(quickNoteRuns.kind, 'analyze')));

    /** @example Both claim callers observe the same active Run. */
    expect(second?.id).toBe(first?.id);
    /** @example Only one active Run row exists. */
    expect(runs).toHaveLength(1);
  });

  /** @example Refresh recovery exposes an active Dive even if another Run completed later. */
  it('prefers an active Run in the list projection', async () => {
    const note = await quickNoteModel.create({ content: 'Dive while analyze completes' });
    const dive = await quickNoteModel.claimRun(note.id, { kind: 'dive' });
    const analyze = await quickNoteModel.claimRun(note.id, { kind: 'analyze' });
    await quickNoteModel.acceptAnnotation(analyze!.id, { content: 'Light annotation' });

    const [details] = await quickNoteModel.queryDetails();

    /** @example The active Dive remains recoverable rather than being hidden by Analyze. */
    expect(details.run).toMatchObject({ kind: dive!.kind, status: 'pending' });
  });

  /** @example Analyze accepts one Document-backed Annotation for its pinned source history. */
  it('persists accepted Annotation output with Run provenance', async () => {
    const note = await quickNoteModel.create({ content: 'Unclassified thought' });
    const run = await quickNoteModel.claimRun(note.id, { kind: 'analyze' });

    const output = await quickNoteModel.acceptAnnotation(run!.id, {
      content: 'A concise interpretation',
      editorData: { root: { children: [{ text: 'A concise interpretation' }] } },
      tags: ['idea'],
    });

    const [resource] = await serverDB
      .select()
      .from(quickNoteResources)
      .where(eq(quickNoteResources.id, output!.resource.id));
    const [annotationDocument] = await serverDB
      .select()
      .from(documents)
      .where(eq(documents.id, resource.documentId!));
    const [outputHistory] = await serverDB
      .select()
      .from(documentHistories)
      .where(eq(documentHistories.id, output!.documentHistory.id));
    const [runResource] = await serverDB
      .select()
      .from(quickNoteRunResources)
      .where(eq(quickNoteRunResources.runId, run!.id));

    /** @example Annotation is a private canonical Document, not copied into the binding. */
    expect(annotationDocument).toMatchObject({
      content: 'A concise interpretation',
      sourceType: 'quick-note',
      visibility: 'private',
    });
    /** @example Annotation lineage belongs to the exact source snapshot read by the Run. */
    expect(resource).toMatchObject({ role: 'annotation', sourceHistoryId: run!.sourceHistoryId });
    /** @example Accepted output uses an immutable LLM-authored Document History. */
    expect(outputHistory).toMatchObject({ saveSource: 'llm_call' });
    /** @example Provenance connects the producing Run to the accepted output revision. */
    expect(runResource).toMatchObject({
      documentHistoryId: outputHistory.id,
      resourceId: resource.id,
    });
  });

  /** @example Analyze emits an inert Document-backed Task Proposal with independent state. */
  it('versions Proposal content and separates source validity from user decision', async () => {
    const note = await quickNoteModel.create({ content: 'An actionable note' });
    const run = await quickNoteModel.claimRun(note.id, { kind: 'analyze' });
    const output = await quickNoteModel.acceptAnnotation(run!.id, {
      content: 'A concise interpretation',
      proposals: [{ content: 'Prepare a small training-data experiment.', kind: 'task' }],
    });
    const proposal = output!.proposals[0];
    const edited = await quickNoteModel.updateProposal(proposal.id, {
      content: 'Prepare and review a small training-data experiment.',
      editorData: { markdown: 'Prepare and review a small training-data experiment.' },
    });

    await quickNoteModel.updateContent(note.id, {
      content: 'The source changed after the suggestion.',
      editorData: { markdown: 'The source changed after the suggestion.' },
    });
    const [stale] = await quickNoteModel.queryProposals(note.id);
    const otherModel = new QuickNoteModel(serverDB, otherUserId);
    const rejectedDecision = await otherModel.decideProposal(proposal.id, 'dismissed');
    const rejectedEdit = await otherModel.updateProposal(proposal.id, {
      content: 'Cross-owner proposal edit',
      editorData: { markdown: 'Cross-owner proposal edit' },
    });
    const hiddenProposals = await otherModel.queryProposals(note.id);
    const accepted = await quickNoteModel.decideProposal(proposal.id, 'accepted');
    const [proposalDocument] = await serverDB
      .select()
      .from(documents)
      .where(eq(documents.id, proposal.documentId));

    /** @example Proposal text lives in a private Document rather than the lifecycle row. */
    expect(proposalDocument).toMatchObject({
      content: 'Prepare and review a small training-data experiment.',
      sourceType: 'quick-note',
      visibility: 'private',
    });
    /** @example User editing advances the current Document History identity. */
    expect(edited?.proposal.currentHistoryId).toBe(edited?.history.id);
    /** @example A source edit invalidates but does not dismiss the pending Proposal. */
    expect(stale).toMatchObject({ decisionStatus: 'pending', validity: 'stale' });
    /** @example Acceptance pins the exact edited version while retaining stale provenance. */
    expect(accepted).toMatchObject({
      acceptedHistoryId: edited?.history.id,
      decisionStatus: 'accepted',
      validity: 'stale',
    });
    /** @example Another owner cannot edit or list the Proposal. */
    expect(rejectedEdit).toBeUndefined();
    /** @example Another owner cannot decide the Proposal. */
    expect(rejectedDecision).toBeUndefined();
    /** @example Proposal reads remain scoped through the parent Quick Note. */
    expect(hiddenProposals).toEqual([]);
  });

  /** @example Accepting a current Task Proposal creates exactly the explicit downstream object. */
  it('converts an accepted Task Proposal and links the created Task', async () => {
    const note = await quickNoteModel.create({ content: 'Ship the duplex model experiment' });
    const run = await quickNoteModel.claimRun(note.id, { kind: 'analyze' });
    const output = await quickNoteModel.acceptAnnotation(run!.id, {
      content: 'A concrete next action',
      proposals: [{ content: 'Train a small duplex model experiment.', kind: 'task' }],
    });

    const accepted = await quickNoteModel.acceptTaskProposal(output!.proposals[0].id);
    const [task] = await serverDB.select().from(tasks).where(eq(tasks.id, accepted!.task.id));
    const details = await quickNoteModel.queryAgenticDetails(note.id);
    const acceptedAgain = await quickNoteModel.acceptTaskProposal(output!.proposals[0].id);

    /** @example The created Task keeps the edited Proposal body as its instruction. */
    expect(task).toMatchObject({
      instruction: 'Train a small duplex model experiment.',
      visibility: 'private',
    });
    /** @example The exact Proposal version becomes terminally accepted. */
    expect(accepted?.proposal).toMatchObject({
      acceptedHistoryId: output!.proposals[0].currentHistoryId,
      decisionStatus: 'accepted',
    });
    /** @example The created Task is immediately visible as typed Quick Note context. */
    expect(details.resources).toEqual([
      expect.objectContaining({
        resourceId: task.id,
        resourceType: 'task',
        taskIdentifier: task.identifier,
      }),
    ]);
    /** @example Repeated acceptance cannot create a second Task. */
    expect(acceptedAgain).toBeUndefined();
  });

  /** @example A Run records the exact current source, Comment, and Proposal revisions it sees. */
  it('pins all mutable context through immutable Run Inputs', async () => {
    const note = await quickNoteModel.create({ content: 'A note with follow-up context' });
    const comment = await quickNoteModel.createComment(note.id, {
      content: 'Initial feedback',
    });
    const analyze = await quickNoteModel.claimRun(note.id, { kind: 'analyze' });
    const analyzeContext = await quickNoteModel.getRunContext(analyze!.id);
    await quickNoteModel.updateComment(comment!.comment.id, { content: 'Revised feedback' });
    const output = await quickNoteModel.acceptAnnotation(analyze!.id, {
      content: 'A concise interpretation',
      proposals: [{ content: 'Review this later.', kind: 'task' }],
    });
    const editedProposal = await quickNoteModel.updateProposal(output!.proposals[0].id, {
      content: 'Review this with the latest feedback.',
      editorData: { markdown: 'Review this with the latest feedback.' },
    });

    const dive = await quickNoteModel.claimRun(note.id, { kind: 'dive' });
    const diveContext = await quickNoteModel.getRunContext(dive!.id);
    const persistedInputs = await serverDB
      .select()
      .from(quickNoteRunInputs)
      .where(eq(quickNoteRunInputs.runId, dive!.id));

    /** @example The first Run remains fixed to the Comment text present at claim time. */
    expect(analyzeContext?.inputs.find(({ role }) => role === 'comment')?.commentContent).toBe(
      'Initial feedback',
    );
    /** @example A later Run consumes the latest Comment revision. */
    expect(diveContext?.inputs.find(({ role }) => role === 'comment')?.commentContent).toBe(
      'Revised feedback',
    );
    /** @example The later Run pins the edited Proposal Document History. */
    expect(diveContext?.inputs.find(({ role }) => role === 'proposal')?.documentHistoryId).toBe(
      editedProposal?.history.id,
    );
    /** @example Source, Comment, and Proposal are three independently auditable inputs. */
    expect(persistedInputs.map(({ role }) => role).sort()).toEqual([
      'comment',
      'proposal',
      'source',
    ]);
  });

  /** @example Editing the source creates a separate Annotation lineage on the next Run. */
  it('keeps Annotation resources separate across source histories', async () => {
    const note = await quickNoteModel.create({ content: 'Version one' });
    const firstRun = await quickNoteModel.claimRun(note.id, { kind: 'analyze' });
    await quickNoteModel.acceptAnnotation(firstRun!.id, { content: 'Annotation one' });

    await quickNoteModel.updateContent(note.id, {
      content: 'Version two',
      editorData: { root: { children: [{ text: 'Version two' }] } },
    });
    const secondRun = await quickNoteModel.claimRun(note.id, { kind: 'analyze' });
    await quickNoteModel.acceptAnnotation(secondRun!.id, { content: 'Annotation two' });

    const resources = await serverDB
      .select()
      .from(quickNoteResources)
      .where(eq(quickNoteResources.quickNoteId, note.id));

    /** @example Each pinned source version has its own Annotation Document lineage. */
    expect(resources).toHaveLength(2);
    /** @example Source histories never share the same lineage identity. */
    expect(new Set(resources.map((resource) => resource.sourceHistoryId)).size).toBe(2);
  });

  /** @example An old Run remains auditable but cannot become the current Annotation after editing. */
  it('does not project a stale Run over a newer source revision', async () => {
    const note = await quickNoteModel.create({ content: 'Version one' });
    const oldRun = await quickNoteModel.claimRun(note.id, { kind: 'analyze' });
    const dueAt = new Date('2026-08-24T01:00:00Z');
    await quickNoteModel.updateContent(note.id, {
      content: 'Version two',
      analyzeDueAt: dueAt,
      editorData: { root: { children: [{ text: 'Version two' }] } },
    });

    await quickNoteModel.acceptAnnotation(oldRun!.id, {
      content: 'Stale annotation',
      tags: ['stale-tag'],
    });
    const [details] = await quickNoteModel.queryDetails();
    const [persistedNote] = await serverDB
      .select()
      .from(quickNotes)
      .where(eq(quickNotes.id, note.id));

    /** @example The old output is retained in resources but hidden from the current projection. */
    expect(details.annotation).toBeUndefined();
    /** @example The newer edit remains eligible for a fresh Analyze claim. */
    expect(persistedNote.analyzeDueAt).toEqual(dueAt);
    /** @example Stale interpretation metadata cannot leak into the current source revision. */
    expect(persistedNote.tags).toEqual([]);
  });

  /** @example Analyze can accept typed owned resources but not another user's Document. */
  it('links only owner-accessible typed Context resources', async () => {
    const note = await quickNoteModel.create({ content: 'Connect this note' });
    const run = await quickNoteModel.claimRun(note.id, { kind: 'analyze' });
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
      .from(quickNoteRunResources)
      .where(eq(quickNoteRunResources.runId, run!.id));
    const details = await quickNoteModel.queryAgenticDetails(note.id);

    /** @example The owned canonical Document becomes a Context resource. */
    expect(accepted).toMatchObject({
      documentId: 'quick-note-owned-context',
      resourceId: 'quick-note-owned-context',
      resourceType: 'document',
      role: 'context',
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
    /** @example The producing Run records provenance without fabricating a Document History. */
    expect(provenance).toHaveLength(2);
    /** @example The single provenance row points at the accepted resource. */
    expect(provenance[0]).toMatchObject({
      documentHistoryId: null,
      resourceId: accepted!.id,
    });
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

  /** @example Removing a Quick Note cleans generated private containers and outputs. */
  it('deletes generated Documents and Topic without touching unrelated Documents', async () => {
    const note = await quickNoteModel.create({ content: 'Disposable' });
    const run = await quickNoteModel.claimRun(note.id, { kind: 'analyze' });
    const output = await quickNoteModel.acceptAnnotation(run!.id, {
      content: 'Generated',
      proposals: [{ content: 'Generated proposal', kind: 'task' }],
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

    const deleted = await quickNoteModel.delete(note.id);
    const remainingDocuments = await serverDB
      .select({ id: documents.id })
      .from(documents)
      .where(
        inArray(documents.id, [
          note.documentId,
          output!.resource.documentId!,
          output!.proposals[0].documentId,
          unrelatedDocumentId,
        ]),
      );
    const remainingTopics = await serverDB
      .select({ id: topics.id })
      .from(topics)
      .where(eq(topics.id, note.topicId));

    /** @example The owner can delete the capture exactly once. */
    expect(deleted).toBe(true);
    /** @example Only the unrelated user Document remains. */
    expect(remainingDocuments).toEqual([{ id: unrelatedDocumentId }]);
    /** @example The hidden Topic is removed with the capture. */
    expect(remainingTopics).toEqual([]);
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
    const defaultEnabled = await quickNoteModel.create({ content: 'eligible' });
    const disabledModel = new QuickNoteModel(serverDB, otherUserId);
    const disabled = await disabledModel.create({ content: 'ineligible' });
    const dueAt = new Date('2026-08-24T00:00:00Z');
    await quickNoteModel.updateContent(defaultEnabled.id, {
      content: 'eligible',
      analyzeDueAt: dueAt,
      editorData: { root: { children: [] } },
    });
    await disabledModel.updateContent(disabled.id, {
      content: 'ineligible',
      analyzeDueAt: dueAt,
      editorData: { root: { children: [] } },
    });

    const candidates = await QuickNoteModel.findDueAnalyzeCandidates(serverDB, {
      now: new Date('2026-08-24T00:01:00Z'),
    });

    /** @example Only the owner without an explicit opt-out is scheduled. */
    expect(candidates).toEqual([{ id: defaultEnabled.id, userId, workspaceId: null }]);
  });
});
