// @vitest-environment node
import { and, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { QuickNoteRepository } from '../../repositories/quickNote';
import {
  quickNoteProposals,
  quickNoteResources,
  quickNoteRuns,
  quickNotes,
  users,
} from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { QuickNoteModel } from '../quickNote';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'quick-note-write-scope-user';
const otherUserId = 'quick-note-write-scope-other-user';
const quickNoteRepo = new QuickNoteRepository(serverDB, userId);
const otherModel = new QuickNoteModel(serverDB, otherUserId);

const renderSourceText = () => 'Owner capture';

beforeEach(async () => {
  await serverDB.delete(users);
  await serverDB.insert(users).values([{ id: userId }, { id: otherUserId }]);
});

afterEach(async () => {
  await serverDB.delete(users);
});

/** Creates a note with a completed Analyze Run, one pending Proposal, and an active Run. */
const seed = async () => {
  const note = await quickNoteRepo.create({ content: 'Owner capture' });
  const analyze = await quickNoteRepo.claimRun(note.id, { kind: 'analyze', renderSourceText });
  const output = await quickNoteRepo.completeRun(analyze!.id, {
    proposals: [{ kind: 'task', payload: { instruction: 'Owner proposal' } }],
    summary: 'Owner summary',
  });
  const active = await quickNoteRepo.claimRun(note.id, {
    kind: 'signal_enrichment',
    renderSourceText,
  });

  return { active: active!, analyze: analyze!, note, output: output! };
};

describe('QuickNoteModel write scope', () => {
  /** @example Single-aggregate write helpers refuse rows outside the caller's scope. */
  it('does not mutate another owner’s Quick Note rows', async () => {
    const { active, analyze, note, output } = await seed();
    const proposal = output.proposals[0];
    const [noteBefore] = await serverDB.select().from(quickNotes).where(eq(quickNotes.id, note.id));

    const saved = await otherModel.recordContentSave(note.id, { updatedAt: new Date(0) });
    const deleted = await otherModel.deleteRecord(note.id);
    const edited = await otherModel.updateProposalPayload(proposal.id, { instruction: 'x' });
    await otherModel.markPendingProposalsStale(note.id, new Date(0));
    const created = await otherModel.createProposal({
      kind: 'task',
      payload: { instruction: 'Injected' },
      quickNoteId: note.id,
      runId: analyze.id,
      sourceHistoryId: analyze.sourceHistoryId,
    });
    const linked = await otherModel.linkUserResources(note.id, analyze.sourceHistoryId, [
      { id: note.documentId, type: 'document' },
    ]);
    // The Analyze Run is already completed, so only the ownership guard can refuse this insert.
    const inserted = await otherModel.insertPendingRun(note.id, active.sourceHistoryId, {
      inputSnapshot: {
        comments: [],
        pendingProposals: [],
        source: 'x',
        sourceHistoryId: active.sourceHistoryId,
      },
      kind: 'analyze',
    });
    const completed = await otherModel.completeRun(
      active.id,
      { quickNoteId: note.id, sourceHistoryEditorData: null },
      { summary: 'Hijacked', tags: ['hijacked'] },
    );
    const attached = await otherModel.attachOperation(active.id, {
      agentId: 'agt_foreign',
      executionConfig: { agentId: 'agt_foreign', maxSteps: 1, pluginIds: [] },
      operationId: 'op_foreign',
    });
    const failed = await otherModel.failRun(active.id, { message: 'Hijacked' });

    const [noteAfter] = await serverDB.select().from(quickNotes).where(eq(quickNotes.id, note.id));
    const proposals = await serverDB
      .select()
      .from(quickNoteProposals)
      .where(eq(quickNoteProposals.quickNoteId, note.id));
    const [activeAfter] = await serverDB
      .select()
      .from(quickNoteRuns)
      .where(eq(quickNoteRuns.id, active.id));
    const resources = await serverDB
      .select()
      .from(quickNoteResources)
      .where(eq(quickNoteResources.quickNoteId, note.id));
    const analyzeRuns = await serverDB
      .select()
      .from(quickNoteRuns)
      .where(and(eq(quickNoteRuns.quickNoteId, note.id), eq(quickNoteRuns.kind, 'analyze')));

    /** @example No helper reports a write for a foreign id. */
    expect({ attached, completed, created, deleted, edited, failed, inserted, saved }).toEqual({
      attached: undefined,
      completed: undefined,
      created: undefined,
      deleted: undefined,
      edited: undefined,
      failed: undefined,
      inserted: undefined,
      saved: undefined,
    });
    expect(linked).toEqual([]);
    /** @example No foreign Run was started. */
    expect(analyzeRuns).toHaveLength(1);
    /** @example The note row keeps its timestamps and tags. */
    expect(noteAfter).toEqual(noteBefore);
    /** @example The Proposal keeps its payload and stays current; nothing was injected. */
    expect(proposals).toHaveLength(1);
    expect(proposals[0]).toMatchObject({
      payload: { instruction: 'Owner proposal' },
      validity: 'current',
    });
    /** @example The active Run is not completed, started, or failed by another owner. */
    expect(activeAfter).toMatchObject({ operationId: null, status: 'pending', summary: null });
    /** @example No foreign resource link was added. */
    expect(resources).toEqual([]);
  });
});
