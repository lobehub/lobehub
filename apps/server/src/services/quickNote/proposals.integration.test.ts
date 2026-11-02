// @vitest-environment node
import type { DecisionResponse } from '@lobechat/model-runtime';
import type { QuickNoteRunDecision } from '@lobechat/types';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getTestDB } from '@/database/core/getTestDB';
import { DocumentModel } from '@/database/models/document';
import { QuickNoteModel } from '@/database/models/quickNote';
import { TaskModel } from '@/database/models/task';
import { QuickNoteRepository } from '@/database/repositories/quickNote';
import { documents, quickNotes, tasks, users } from '@/database/schemas';
import { enqueueAgentSignalSourceEvent } from '@/server/services/agentSignal';
import type { AiGenerationService } from '@/server/services/aiGeneration';

import { QuickNoteProcessingService } from '.';
import { QuickNoteApplyError } from './executors';
import { QuickNoteProposalService } from './proposals';
import { renderQuickNoteSourceText as renderSourceText } from './sourceText';

// NOTICE:
// Route tests reuse the isolated migration-backed database instead of an application connection.
// Source: packages/trpc/src/lambda/middleware/serverDatabase.ts.
vi.mock('@/database/core/db-adaptor', () => ({ getServerDB: () => getTestDB() }));
vi.mock('@/server/services/agentSignal', () => ({ enqueueAgentSignalSourceEvent: vi.fn() }));
vi.mock('@/server/services/quickNote/featureGate', () => ({ assertQuickNoteEnabled: vi.fn() }));
const { execAgent, runTask } = vi.hoisted(() => ({ execAgent: vi.fn(), runTask: vi.fn() }));
vi.mock('@/server/services/taskRunner', () => ({
  TaskRunnerService: class {
    runTask = runTask;
  },
}));
vi.mock('@/server/services/aiAgent', () => ({
  AiAgentService: class {
    execAgent = execAgent;
  },
}));

const db = await getTestDB();
const userId = 'quick-note-proposals-test';
const otherUserId = 'quick-note-proposals-other';
const model = new QuickNoteModel(db, userId);
const repo = new QuickNoteRepository(db, userId);
const { quickNoteRouter } = await import('@/server/routers/lambda/quickNote');
const caller = quickNoteRouter.createCaller({ userId });

const enqueued = (sourceType: string) =>
  vi
    .mocked(enqueueAgentSignalSourceEvent)
    .mock.calls.filter(([input]) => input.sourceType === sourceType);

const researchDecision = (delegate: 3 | 4): QuickNoteRunDecision => ({
  decisionMode: 'emulated',
  evidence: '"调研一下"',
  explicitGoalRequest: false,
  preset: 'research',
  presetScores: { discuss: 0, goal: 0, research: 4, write_document: 0 },
  primary: 'delegate',
  scores: { delegate, enrich: 1, keep: 0, link: 0 },
});

const researchOutput = JSON.stringify({
  delegate: {
    instruction: 'Compare gpt-live and moshi latency and duplex',
    name: 'gpt-live vs moshi',
  },
  summary: 'Compare two speech models',
  tags: ['speech'],
});

/** Seeds a note with a claimed Run that already holds `decision`. */
const seedJudgedRun = async (content: string, decision: QuickNoteRunDecision) => {
  const note = await repo.create({ content, editorData: { markdown: content } });
  const run = await repo.claimRun(note.id, {
    kind: 'analyze',
    renderSourceText,
    trigger: 'manual',
  });
  await model.recordRunDecision(run!.id, decision);
  return { note, run: run! };
};

const writeDecision = (delegate: 3 | 4): QuickNoteRunDecision => ({
  decisionMode: 'emulated',
  evidence: '"加到 moshi 调研页"',
  explicitGoalRequest: false,
  preset: 'write_document',
  presetScores: { discuss: 0, goal: 0, research: 0, write_document: 4 },
  primary: 'delegate',
  scores: { delegate, enrich: 0, keep: 0, link: 0 },
});

/** Creates a Page owned by `owner` with one paragraph. */
const createPage = (owner: string, content = 'Existing intro') =>
  new DocumentModel(db, owner).create({
    content,
    fileType: 'custom/document',
    source: 'test',
    sourceType: 'api',
    title: 'Moshi research',
    totalCharCount: content.length,
    totalLineCount: 1,
  });

/** Seeds a pending `tool_call` Proposal that appends to an existing Page. */
const seedAppendProposal = async (documentId: string) => {
  const { note, run } = await seedJudgedRun('把这段加到 moshi 调研页', writeDecision(3));
  const output = await repo.completeRun(run.id, {
    proposals: [
      {
        kind: 'tool_call',
        payload: {
          apiName: 'modifyNodes',
          arguments: { markdown: '## Duplex\n\nMoshi is full duplex.' },
          documentId,
          identifier: 'lobe-page-agent',
        },
        preset: 'write_document',
      },
    ],
  });
  return { note, proposal: output!.proposals[0], run };
};

/** Reads a note's debounced meaning-check due time. */
const contentCheckDueAt = async (quickNoteId: string) => {
  const [row] = await db
    .select({ dueAt: quickNotes.contentCheckDueAt })
    .from(quickNotes)
    .where(eq(quickNotes.id, quickNoteId));
  return row?.dueAt;
};

/** Seeds a pending `task` Proposal created by a completed Run. */
const seedTaskProposal = async (content = '调研一下 gpt-live 和 moshi 的差异') => {
  const { note, run } = await seedJudgedRun(content, researchDecision(3));
  const output = await repo.completeRun(run.id, {
    proposals: [
      {
        kind: 'task',
        payload: { instruction: 'Compare gpt-live and moshi', name: 'gpt-live vs moshi' },
        preset: 'research',
      },
    ],
  });
  return { note, proposal: output!.proposals[0], run };
};

/** Resolves `promise`, or rejects once `ms` passes, so a blocked response fails fast. */
const settlesWithin = <T>(promise: Promise<T>, ms = 3000) =>
  Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`still pending after ${ms}ms`)), ms),
    ),
  ]);

beforeEach(async () => {
  await db.insert(users).values([{ id: userId }, { id: otherUserId }]);
  vi.spyOn(QuickNoteModel, 'isAutomaticAnalyzeEnabled').mockResolvedValue(true);
  vi.mocked(enqueueAgentSignalSourceEvent).mockReset();
  vi.mocked(enqueueAgentSignalSourceEvent).mockResolvedValue({
    accepted: true,
    scopeKey: 'x',
    workflowRunId: 'wf',
  });
  runTask.mockReset();
  execAgent.mockReset();
});
afterEach(async () => {
  await db.delete(tasks).where(eq(tasks.createdByUserId, userId));
  await db.delete(users).where(eq(users.id, userId));
  await db.delete(users).where(eq(users.id, otherUserId));
  vi.restoreAllMocks();
});

describe('Quick Note Proposal apply', () => {
  it('creates and starts exactly one Task however often it is applied', async () => {
    const { note, proposal, run } = await seedTaskProposal();

    const [first, concurrent] = await Promise.all([
      caller.applyProposal({ proposalId: proposal.id }),
      caller.applyProposal({ proposalId: proposal.id }),
    ]);
    const repeated = await caller.applyProposal({ proposalId: proposal.id });

    const created = await db.select().from(tasks).where(eq(tasks.createdByUserId, userId));
    expect(created).toHaveLength(1);
    const [task] = created;
    expect([first.applied, concurrent.applied].sort()).toEqual([false, true]);
    expect(repeated).toMatchObject({ applied: false, proposal: { resultId: task.id } });
    expect(first.proposal).toMatchObject({
      decisionStatus: 'accepted',
      resultId: task.id,
      resultType: 'task',
    });
    expect(first.proposal.decidedAt).toBeInstanceOf(Date);
    // The Task carries its Quick Note provenance and the Quick Note agent as assignee.
    expect(task.context).toMatchObject({
      source: { proposalId: proposal.id, quickNoteId: note.id, runId: run.id, type: 'quick_note' },
    });
    expect(task.assigneeAgentId).toBeTruthy();
    expect(task.visibility).toBe('private');
    // Started once, after commit, without blocking on an Agent.
    expect(runTask).toHaveBeenCalledTimes(1);
    expect(runTask).toHaveBeenCalledWith({ taskId: task.id, trigger: 'manual' });
    // The reaction is emitted once, as data only.
    expect(enqueued('quick_note.proposal.decided')).toHaveLength(1);
    expect(enqueued('quick_note.proposal.decided')[0][0]).toMatchObject({
      payload: {
        decision: 'accepted',
        edited: false,
        kind: 'task',
        proposalId: proposal.id,
        resultId: task.id,
        via: 'user',
      },
      scopeKey: `quick-note:${note.id}`,
    });
  });

  // ROOT CAUSE:
  // apply awaited `TaskRunnerService.runTask` (~1s of reservation and enqueue) before responding.
  // The Task start now runs after the response, and its failure never fails the apply.
  it('responds before the Task start finishes, and survives a failed start', async () => {
    runTask.mockReturnValue(new Promise(() => {}));
    const { proposal } = await seedTaskProposal();

    const result = await settlesWithin(caller.applyProposal({ proposalId: proposal.id }));

    expect(result).toMatchObject({ applied: true, proposal: { decisionStatus: 'accepted' } });
    expect(runTask).toHaveBeenCalledWith({ taskId: result.proposal.resultId, trigger: 'manual' });

    runTask.mockRejectedValue(new Error('runner unavailable'));
    const { proposal: failing } = await seedTaskProposal('调研一下 sesame 的延迟');
    await expect(
      settlesWithin(caller.applyProposal({ proposalId: failing.id })),
    ).resolves.toMatchObject({ applied: true, proposal: { resultType: 'task' } });
  });

  it('hides Quick Note Tasks from task lists and lists them on the note', async () => {
    const { note, proposal } = await seedTaskProposal();
    await caller.applyProposal({ proposalId: proposal.id });
    const taskModel = new TaskModel(db, userId);
    const regular = await taskModel.create({ instruction: 'Regular task' } as any);

    const listed = await taskModel.list();
    const withQuickNote = await taskModel.list({ includeQuickNoteTasks: true });
    const noteTasks = await caller.listTasks({ id: note.id });

    expect(listed.tasks.map(({ id }) => id)).toEqual([regular.id]);
    expect(withQuickNote.total).toBe(2);
    expect(noteTasks).toHaveLength(1);
    expect(noteTasks[0]).toMatchObject({ proposalId: proposal.id, status: expect.any(String) });
  });

  it('keeps a stale Proposal applicable', async () => {
    const { note, proposal } = await seedTaskProposal();
    await model.markPendingProposalsStale(note.id, new Date());

    const result = await caller.applyProposal({ proposalId: proposal.id });

    expect(result).toMatchObject({ applied: true, proposal: { validity: 'stale' } });
  });

  it('records a dismissal with its reason and emits the reaction without an Agent', async () => {
    const { proposal } = await seedTaskProposal();

    const dismissed = await caller.decideProposal({
      decisionStatus: 'dismissed',
      proposalId: proposal.id,
      reason: 'not now',
    });

    expect(dismissed).toMatchObject({ decisionStatus: 'dismissed', dismissReason: 'not now' });
    expect(dismissed.decidedAt).toBeInstanceOf(Date);
    expect(enqueued('quick_note.proposal.decided')[0][0].payload).toMatchObject({
      decision: 'dismissed',
      reason: 'not now',
    });
    expect(runTask).not.toHaveBeenCalled();
    expect(execAgent).not.toHaveBeenCalled();
    // A dismissed Proposal can no longer be applied.
    await expect(caller.applyProposal({ proposalId: proposal.id })).rejects.toMatchObject({
      code: 'CONFLICT',
    });
  });

  it('validates edited payloads and reports edits on apply', async () => {
    const { proposal } = await seedTaskProposal();

    await expect(
      caller.updateProposal({ payload: { name: '' }, proposalId: proposal.id }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await caller.updateProposal({
      payload: { instruction: 'Only compare latency', name: 'Latency' },
      proposalId: proposal.id,
    });
    await caller.applyProposal({ proposalId: proposal.id });

    const [task] = await db.select().from(tasks).where(eq(tasks.createdByUserId, userId));
    expect(task.instruction).toBe('Only compare latency');
    expect(enqueued('quick_note.proposal.decided')[0][0].payload).toMatchObject({ edited: true });
  });

  it('rejects tool calls that need an Agent conversation', async () => {
    const { note, run } = await seedJudgedRun('write it up', researchDecision(3));
    const output = await repo.completeRun(run.id, {
      proposals: [
        {
          kind: 'tool_call',
          payload: { apiName: 'callSubAgent', arguments: {}, identifier: 'lobe-agent' },
          preset: 'write_document',
        },
      ],
    });

    await expect(
      new QuickNoteProposalService(db, userId).apply(output!.proposals[0].id),
    ).rejects.toBeInstanceOf(QuickNoteApplyError);
    expect((await model.queryProposals(note.id))[0].decisionStatus).toBe('pending');
  });
});

describe('Quick Note write into an existing Page', () => {
  it('appends to a Page the user can edit, once, however often it is applied', async () => {
    const page = await createPage(userId);
    const { proposal } = await seedAppendProposal(page.id);

    const [first, concurrent] = await Promise.all([
      caller.applyProposal({ proposalId: proposal.id }),
      caller.applyProposal({ proposalId: proposal.id }),
    ]);
    const repeated = await caller.applyProposal({ proposalId: proposal.id });

    expect([first.applied, concurrent.applied].sort()).toEqual([false, true]);
    expect(repeated).toMatchObject({
      applied: false,
      proposal: { decisionStatus: 'accepted', resultId: page.id, resultType: 'page' },
    });
    const [saved] = await db.select().from(documents).where(eq(documents.id, page.id));
    // The existing body stays first and the section is appended exactly once.
    expect(saved.content).toMatch(/^Existing intro\s+## Duplex\s+Moshi is full duplex\.\s*$/);
    expect(saved.content!.match(/Duplex/g)).toHaveLength(1);
    expect(saved.title).toBe('Moshi research');
    expect(saved.editorData).toBeTruthy();
  });

  it('rejects a Page the user cannot access and leaves the Proposal pending', async () => {
    const foreign = await createPage(otherUserId, 'Someone else');
    const { note, proposal } = await seedAppendProposal(foreign.id);

    await expect(caller.applyProposal({ proposalId: proposal.id })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });

    const [untouched] = await db.select().from(documents).where(eq(documents.id, foreign.id));
    expect(untouched.content).toBe('Someone else');
    expect((await model.queryProposals(note.id))[0]).toMatchObject({
      decisionStatus: 'pending',
      resultId: null,
    });
  });

  it('refuses to replace an existing Page with initPage', async () => {
    const page = await createPage(userId);
    const { proposal } = await seedAppendProposal(page.id);
    await caller.updateProposal({
      payload: { ...proposal.payload, apiName: 'initPage' },
      proposalId: proposal.id,
    });

    await expect(caller.applyProposal({ proposalId: proposal.id })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
    const [saved] = await db.select().from(documents).where(eq(documents.id, page.id));
    expect(saved.content).toBe('Existing intro');
  });

  it('auto-applies a score-4 draft that targets a linked Page', async () => {
    const page = await createPage(userId);
    const { note, run } = await seedJudgedRun(
      '把 duplex 的结论加到 moshi 调研页',
      writeDecision(4),
    );
    await model.linkResource(run.id, { id: page.id, type: 'document' });

    await new QuickNoteProcessingService(db, userId).onRunComplete({
      lastAssistantContent: JSON.stringify({
        delegate: { documentId: page.id, markdown: '## Duplex\n\nMoshi is full duplex.' },
        summary: 'Adds the duplex finding to the Moshi page',
        tags: [],
      }),
      reason: 'done',
      runId: run.id,
    });

    const [proposal] = await model.queryProposals(note.id);
    expect(proposal).toMatchObject({
      decisionStatus: 'accepted',
      kind: 'tool_call',
      payload: { apiName: 'modifyNodes', documentId: page.id },
      resultId: page.id,
      resultType: 'page',
    });
    const [saved] = await db.select().from(documents).where(eq(documents.id, page.id));
    expect(saved.content).toContain('Moshi is full duplex.');
    expect(saved.content).toContain('Existing intro');
    expect(enqueued('quick_note.proposal.decided')[0][0].payload).toMatchObject({ via: 'auto' });
  });
});

describe('Quick Note Analyze completion', () => {
  it('auto-applies a score-4 delegate and keeps the Proposal as the record', async () => {
    const { note, run } = await seedJudgedRun(
      '调研一下 gpt-live 和 moshi 的差异',
      researchDecision(4),
    );

    const completed = await new QuickNoteProcessingService(db, userId).onRunComplete({
      lastAssistantContent: researchOutput,
      reason: 'done',
      runId: run.id,
    });

    const [task] = await db.select().from(tasks).where(eq(tasks.createdByUserId, userId));
    const [proposal] = await model.queryProposals(note.id);
    expect(completed && 'run' in completed ? completed.run.status : undefined).toBe('completed');
    expect(proposal).toMatchObject({
      decisionStatus: 'accepted',
      kind: 'task',
      preset: 'research',
      resultId: task.id,
    });
    expect(runTask).toHaveBeenCalledTimes(1);
    expect(enqueued('quick_note.proposal.decided')[0][0].payload).toMatchObject({ via: 'auto' });
  });

  it('reads output after leaked tool-call markup, and never auto-retries unreadable output', async () => {
    const dsml =
      '<｜DSML｜function_calls><｜DSML｜invoke name="search"></｜DSML｜invoke></｜DSML｜function_calls>';
    const service = new QuickNoteProcessingService(db, userId);
    const { note, run } = await seedJudgedRun('调研一下 moshi', researchDecision(3));
    await db
      .update(quickNotes)
      .set({ analyzeDueAt: new Date(Date.now() - 1000) })
      .where(eq(quickNotes.id, note.id));

    await service.onRunComplete({
      lastAssistantContent: `${dsml}\n${researchOutput}`,
      reason: 'done',
      runId: run.id,
    });
    expect((await model.getRunContext(run.id))?.status).toBe('completed');

    await db
      .update(quickNotes)
      .set({ analyzeDueAt: new Date(Date.now() - 1000) })
      .where(eq(quickNotes.id, note.id));
    const next = await repo.claimRun(note.id, {
      kind: 'analyze',
      renderSourceText,
      trigger: 'automatic',
    });
    await service.onRunComplete({ lastAssistantContent: dsml, reason: 'done', runId: next!.id });

    expect(await model.getRunContext(next!.id)).toMatchObject({ status: 'failed' });
    const [row] = await db
      .select({ dueAt: quickNotes.analyzeDueAt })
      .from(quickNotes)
      .where(eq(quickNotes.id, note.id));
    /** @example The sweep has nothing left to claim for this version. */
    expect(row.dueAt).toBeNull();
  });

  it('leaves a score-3 delegate as a pending Proposal', async () => {
    const { note, run } = await seedJudgedRun('maybe look into moshi', researchDecision(3));

    await new QuickNoteProcessingService(db, userId).onRunComplete({
      lastAssistantContent: researchOutput,
      reason: 'done',
      runId: run.id,
    });

    const [proposal] = await model.queryProposals(note.id);
    expect(proposal).toMatchObject({
      decisionStatus: 'pending',
      payload: { name: 'gpt-live vs moshi' },
      validity: 'current',
    });
    expect(await db.select().from(tasks).where(eq(tasks.createdByUserId, userId))).toHaveLength(0);
    expect(runTask).not.toHaveBeenCalled();
  });

  it('records the decision and completes keep-only notes without an Agent', async () => {
    const note = await repo.create({
      content: '我好喜欢北京',
      editorData: { markdown: '我好喜欢北京' },
    });
    const run = await repo.claimRun(note.id, {
      kind: 'analyze',
      renderSourceText,
      trigger: 'manual',
    });
    // Emulated on a chat model: integer levels, evidence in provider metadata.
    const decide = vi.fn().mockResolvedValue({
      answers: {
        delegate: { score: 0, type: 'score' },
        enrich: { score: 0, type: 'score' },
        keep: { score: 4, type: 'score' },
        link: { score: 0, type: 'score' },
        preset_discuss: { score: 0, type: 'score' },
        preset_goal: { score: 0, type: 'score' },
        preset_research: { score: 1, type: 'score' },
        preset_write_document: { score: 0, type: 'score' },
      },
      model: 'gpt-5-mini',
      providerMetadata: {
        lobehub: {
          decisionMode: 'emulated',
          evidence: { keep: '"我好喜欢"', preset_research: 'n/a' },
        },
      },
      usage: { totalInputTokens: 1, totalOutputTokens: 1 },
    } satisfies DecisionResponse);
    const service = new QuickNoteProcessingService(db, userId, undefined, {
      decider: { decide } as unknown as Pick<AiGenerationService, 'decide'>,
    });

    const judged = await service.judgeRun(run!.id);
    await service.completeWithoutGeneration(run!.id);

    expect(decide).toHaveBeenCalledTimes(1);
    const [payload, options] = decide.mock.calls[0];
    expect(payload).toMatchObject({
      model: expect.any(String),
      provider: expect.any(String),
      state: { comments: [], note: '我好喜欢北京', pending_proposals: [] },
    });
    expect(Object.keys(payload.questions)).toEqual([
      'delegate',
      'enrich',
      'keep',
      'link',
      'preset_research',
      'preset_discuss',
      'preset_goal',
      'preset_write_document',
    ]);
    expect(options).toEqual({ metadata: { trigger: 'quick_note' } });
    expect(judged?.plan).toEqual({ enrich: false, link: false });
    expect(await model.getRunContext(run!.id)).toMatchObject({
      decision: {
        decisionMode: 'emulated',
        evidence: '"我好喜欢"',
        model: 'gpt-5-mini',
        primary: 'keep',
        provider: payload.provider,
        scores: { keep: 4 },
      },
      status: 'completed',
    });
    expect(await model.queryProposals(note.id)).toHaveLength(0);
    expect(execAgent).not.toHaveBeenCalled();
  });

  it.each([
    [3.62, true],
    [3.4, false],
  ])(
    'plans a research Task from a native fractional delegate score %s (auto-apply: %s)',
    async (delegate, autoApply) => {
      const note = await repo.create({
        content: '调研一下 gpt-live 和 moshi 的差异',
        editorData: { markdown: '调研一下 gpt-live 和 moshi 的差异' },
      });
      const run = await repo.claimRun(note.id, {
        kind: 'analyze',
        renderSourceText,
        trigger: 'manual',
      });
      // Native decision model: probability-weighted means, one per question.
      const decide = vi.fn().mockResolvedValue({
        answers: {
          delegate: { probabilities: [0, 0, 0.05, 0.28, 0.67], score: delegate, type: 'score' },
          enrich: { score: 1.2, type: 'score' },
          keep: { score: 0.3, type: 'score' },
          link: { score: 0.1, type: 'score' },
          preset_discuss: { score: 0.9, type: 'score' },
          preset_goal: { score: 0.3, type: 'score' },
          preset_research: { score: 3.4, type: 'score' },
          preset_write_document: { score: 0.2, type: 'score' },
        },
        model: 'typesafe/jev-1.13',
        providerMetadata: { lobehub: { decisionMode: 'native' } },
      } satisfies DecisionResponse);
      const service = new QuickNoteProcessingService(db, userId, undefined, {
        decider: { decide } as unknown as Pick<AiGenerationService, 'decide'>,
      });

      const judged = await service.judgeRun(run!.id);

      expect(judged?.plan).toEqual({
        delegate: { autoApply, preset: 'research', score: autoApply ? 4 : 3 },
        enrich: false,
        link: false,
      });
      expect((await model.getRunContext(run!.id))?.decision).toMatchObject({
        decisionMode: 'native',
        evidence: '',
        model: 'typesafe/jev-1.13',
        preset: 'research',
        primary: 'delegate',
      });
    },
  );

  it('treats a fully refused judgement as keep and records the reasons', async () => {
    const note = await repo.create({ content: 'x', editorData: { markdown: 'x' } });
    const run = await repo.claimRun(note.id, {
      kind: 'analyze',
      renderSourceText,
      trigger: 'manual',
    });
    const refusal = { reason: 'policy', type: 'refusal' } as const;
    const decide = vi.fn().mockResolvedValue({
      answers: {
        delegate: refusal,
        enrich: refusal,
        keep: refusal,
        link: refusal,
        preset_discuss: refusal,
        preset_goal: refusal,
        preset_research: refusal,
        preset_write_document: refusal,
      },
      model: 'gpt-5-mini',
      providerMetadata: { lobehub: { decisionMode: 'emulated', evidence: {} } },
    } satisfies DecisionResponse);
    const service = new QuickNoteProcessingService(db, userId, undefined, {
      decider: { decide } as unknown as Pick<AiGenerationService, 'decide'>,
    });

    const judged = await service.judgeRun(run!.id);

    expect(judged?.plan).toEqual({ enrich: false, link: false });
    expect(judged?.decision).toMatchObject({
      preset: null,
      primary: 'keep',
      refusals: {
        delegate: 'policy',
        enrich: 'policy',
        keep: 'policy',
        link: 'policy',
        preset_discuss: 'policy',
        preset_goal: 'policy',
        preset_research: 'policy',
        preset_write_document: 'policy',
      },
    });
  });

  // ROOT CAUSE:
  // With Auto Analyze on, the next Run completes ~10s after an edit, before the minute-level
  // meaning check; only stale Proposals were superseded, so the old one stayed pending + current.
  it.each([
    [3, 'pending'],
    [4, 'accepted'],
  ] as const)(
    'supersedes a current Proposal when a Run of the edited note completes (score %s)',
    async (score, newStatus) => {
      const { note, proposal: old } = await seedTaskProposal();
      await caller.updateContent({
        content: '调研一下 sesame 的端到端延迟',
        editorData: { markdown: '调研一下 sesame 的端到端延迟' },
        id: note.id,
      });
      const next = await repo.claimRun(note.id, {
        kind: 'analyze',
        renderSourceText,
        trigger: 'automatic',
      });
      await model.recordRunDecision(next!.id, researchDecision(score));

      const completed = await new QuickNoteProcessingService(db, userId).onRunComplete({
        lastAssistantContent: researchOutput,
        reason: 'done',
        runId: next!.id,
      });

      const byId = new Map((await model.queryProposals(note.id)).map((p) => [p.id, p]));
      const created = completed && 'proposals' in completed ? completed.proposals : [];
      expect(created).toHaveLength(1);
      expect(byId.get(old.id)).toMatchObject({ decisionStatus: 'pending', validity: 'superseded' });
      // Auto-apply (score 4) still runs on the new Proposal after the old one is superseded.
      expect(byId.get(created[0].id)).toMatchObject({
        decisionStatus: newStatus,
        validity: 'current',
      });
    },
  );

  it('supersedes stale Proposals once a newer Run of the current source completes', async () => {
    const { note, proposal } = await seedTaskProposal();
    await model.markPendingProposalsStale(note.id, new Date());
    const next = await repo.claimRun(note.id, {
      kind: 'analyze',
      renderSourceText,
      trigger: 'manual',
    });
    await model.recordRunDecision(next!.id, researchDecision(3));

    const completed = await new QuickNoteProcessingService(db, userId).completeWithoutGeneration(
      next!.id,
    );

    expect(completed?.superseded.map(({ id }) => id)).toEqual([proposal.id]);
    expect((await model.queryProposals(note.id))[0]).toMatchObject({
      decisionStatus: 'pending',
      validity: 'superseded',
    });
  });
});

describe('Quick Note source edits', () => {
  it('ignores a trailing full stop: no stale Proposals and no new Analyze schedule', async () => {
    const { note } = await seedTaskProposal('我好喜欢北京');
    const dueAt = new Date('2026-10-20T01:00:00Z');
    await db.update(quickNotes).set({ analyzeDueAt: dueAt }).where(eq(quickNotes.id, note.id));

    const updated = await caller.updateContent({
      content: '我好喜欢北京。',
      editorData: { markdown: '我好喜欢北京。' },
      id: note.id,
    });

    expect(updated.contentChange).toBe('equivalent');
    expect(updated.analyzeDueAt).toEqual(dueAt);
    expect(enqueued('quick_note.content.changed')).toHaveLength(0);
    expect((await model.queryProposals(note.id))[0].validity).toBe('current');
  });

  it('arms a debounced meaning check on a real edit instead of checking inline', async () => {
    const { note } = await seedTaskProposal('调研 moshi');

    const before = Date.now();
    const updated = await caller.updateContent({
      content: '调研 gpt-live 的定价',
      editorData: { markdown: '调研 gpt-live 的定价' },
      id: note.id,
    });

    expect(updated.contentChange).toBe('changed');
    expect(updated.contentCheckDueAt!.getTime()).toBeGreaterThan(before);
    // Nothing is enqueued per keystroke; the sweep runs the check once edits go quiet.
    expect(enqueued('quick_note.content.changed')).toHaveLength(0);
    expect((await model.queryProposals(note.id))[0].validity).toBe('current');
  });

  it('runs one check for a burst of edits, against the final text', async () => {
    const { note } = await seedTaskProposal('调研 moshi');
    await caller.updateContent({
      content: '调研 gpt-live',
      editorData: { markdown: '调研 gpt-live' },
      id: note.id,
    });
    const first = (await contentCheckDueAt(note.id))!;
    await new Promise((resolve) => setTimeout(resolve, 5));
    await caller.updateContent({
      content: '调研 gpt-live 的定价',
      editorData: { markdown: '调研 gpt-live 的定价' },
      id: note.id,
    });
    const last = (await contentCheckDueAt(note.id))!;

    // The later edit pushed the check back (last write wins): at the first due time nothing runs.
    expect(last.getTime()).toBeGreaterThan(first.getTime());
    expect(await QuickNoteModel.claimContentCheck(db, note.id, first)).toBe(false);

    const due = await QuickNoteModel.findDueContentCheckCandidates(db, { now: last });
    expect(due.filter(({ id }) => id === note.id)).toHaveLength(1);
    expect(await QuickNoteModel.claimContentCheck(db, note.id, last)).toBe(true);
    // Claimed once: the same burst never produces a second check.
    expect(await QuickNoteModel.claimContentCheck(db, note.id, last)).toBe(false);

    const decide = vi.fn().mockResolvedValue({
      answers: { meaningChanged: { probability: 1, type: 'boolean' } },
      id: 'dec-3',
      model: 'typesafe/jev-1.13',
      providerMetadata: { lobehub: { decisionMode: 'native' } },
    });
    const service = new QuickNoteProcessingService(db, userId, undefined, {
      decider: { decide } as unknown as Pick<AiGenerationService, 'decide'>,
    });
    expect(await service.judgeContentChange({ quickNoteId: note.id })).toMatchObject({
      status: 'changed',
    });
    expect(decide).toHaveBeenCalledOnce();
    expect(decide.mock.calls[0][0].state).toEqual({
      current: '调研 gpt-live 的定价',
      previous: '调研 moshi',
    });
  });

  it('keeps Proposals current when an edit is reverted before the check runs', async () => {
    const { note } = await seedTaskProposal('调研 moshi');
    await caller.updateContent({
      content: '调研 gpt-live',
      editorData: { markdown: '调研 gpt-live' },
      id: note.id,
    });
    await caller.updateContent({
      content: '调研 moshi。',
      editorData: { markdown: '调研 moshi。' },
      id: note.id,
    });
    const decide = vi.fn();
    const service = new QuickNoteProcessingService(db, userId, undefined, {
      decider: { decide } as unknown as Pick<AiGenerationService, 'decide'>,
    });

    expect(await service.judgeContentChange({ quickNoteId: note.id })).toMatchObject({
      status: 'equivalent',
    });
    expect(decide).not.toHaveBeenCalled();
    expect((await model.queryProposals(note.id))[0].validity).toBe('current');
  });

  it('re-arms the check for an edit made after a check was claimed', async () => {
    const { note } = await seedTaskProposal('调研 moshi');
    await caller.updateContent({
      content: '调研 gpt-live',
      editorData: { markdown: '调研 gpt-live' },
      id: note.id,
    });
    const due = (await contentCheckDueAt(note.id))!;
    expect(await QuickNoteModel.claimContentCheck(db, note.id, due)).toBe(true);

    await caller.updateContent({
      content: '调研 gpt-live 的定价',
      editorData: { markdown: '调研 gpt-live 的定价' },
      id: note.id,
    });

    // The edit inside the window is not lost: another check is due for it.
    expect(await contentCheckDueAt(note.id)).toBeInstanceOf(Date);
  });

  it('marks Proposals stale only when the meaningChanged boolean says so', async () => {
    const { note, run } = await seedTaskProposal('调研 moshi');
    await repo.updateContent(note.id, {
      content: '调研 gpt-live 的定价',
      editorData: { markdown: '调研 gpt-live 的定价' },
    });
    const decide = vi.fn().mockResolvedValue({
      answers: { meaningChanged: { probability: 1, type: 'boolean' } },
      id: 'dec-2',
      model: 'typesafe/jev-1.13',
      providerMetadata: { lobehub: { decisionMode: 'native' } },
    });
    const service = new QuickNoteProcessingService(db, userId, undefined, {
      decider: { decide } as unknown as Pick<AiGenerationService, 'decide'>,
    });

    const result = await service.judgeContentChange({
      baselineRunId: run.id,
      quickNoteId: note.id,
    });

    expect(result).toEqual({ baselineRunId: run.id, probability: 1, status: 'changed' });
    expect(decide.mock.calls[0][0].state).toEqual({
      current: '调研 gpt-live 的定价',
      previous: '调研 moshi',
    });
  });

  it.each([
    [{ probability: 0.5, type: 'boolean' }, 'changed', 0.5],
    [{ probability: 0.49, type: 'boolean' }, 'unchanged', 0.49],
    // A refusal never stales Proposals: that needs a positive answer.
    [{ reason: 'cannot compare', type: 'refusal' }, 'unchanged', 0],
  ] as const)('maps a meaningChanged answer %o to %s', async (answer, status, probability) => {
    const { note, run } = await seedTaskProposal('调研 moshi');
    await repo.updateContent(note.id, {
      content: '调研 gpt-live 的定价',
      editorData: { markdown: '调研 gpt-live 的定价' },
    });
    const decide = vi.fn().mockResolvedValue({
      answers: { meaningChanged: answer },
      model: 'gpt-5-mini',
      providerMetadata: { lobehub: { decisionMode: 'emulated', evidence: {} } },
    });
    const service = new QuickNoteProcessingService(db, userId, undefined, {
      decider: { decide } as unknown as Pick<AiGenerationService, 'decide'>,
    });

    expect(
      await service.judgeContentChange({ baselineRunId: run.id, quickNoteId: note.id }),
    ).toEqual({ baselineRunId: run.id, probability, status });
    expect(decide.mock.calls[0][0].questions.meaningChanged).toMatchObject({
      criteria: { false: expect.any(String), true: expect.any(String) },
      type: 'boolean',
    });
  });

  it('skips the model when the edit is cosmetic relative to the baseline', async () => {
    const { note, run } = await seedTaskProposal('调研 moshi');
    await repo.updateContent(note.id, {
      content: '调研 moshi！',
      editorData: { markdown: '调研 moshi！' },
    });
    const decide = vi.fn();
    const service = new QuickNoteProcessingService(db, userId, undefined, {
      decider: { decide } as unknown as Pick<AiGenerationService, 'decide'>,
    });

    expect(
      await service.judgeContentChange({ baselineRunId: run.id, quickNoteId: note.id }),
    ).toEqual({ baselineRunId: run.id, status: 'equivalent' });
    expect(decide).not.toHaveBeenCalled();
  });
});

describe('Quick Note Dive', () => {
  it('creates and starts a Task from the note without an inline Agent call', async () => {
    const note = await repo.create({
      content: '调研 moshi',
      editorData: { markdown: '调研 moshi' },
    });
    await caller.createComment({ content: 'focus on latency', quickNoteId: note.id });

    const { taskId } = await caller.dive({ id: note.id });

    const [task] = await db.select().from(tasks).where(eq(tasks.id, taskId));
    expect(task.context).toEqual({ source: { quickNoteId: note.id, type: 'quick_note' } });
    expect(task.instruction).toContain('调研 moshi');
    expect(task.instruction).toContain('focus on latency');
    expect(task.name).toBe('调研 moshi');
    expect(runTask).toHaveBeenCalledWith({ taskId, trigger: 'manual' });
    expect(execAgent).not.toHaveBeenCalled();
    // No summary is written by Dive.
    expect((await model.queryDetails()).items[0].summary).toBeUndefined();
  });

  it('responds before the Task start finishes', async () => {
    runTask.mockReturnValue(new Promise(() => {}));
    const note = await repo.create({
      content: '调研 moshi',
      editorData: { markdown: '调研 moshi' },
    });

    const { taskId } = await settlesWithin(caller.dive({ id: note.id }));

    expect(runTask).toHaveBeenCalledWith({ taskId, trigger: 'manual' });
  });

  it('creates notes sent from other surfaces with their resources', async () => {
    const source = await repo.create({ content: 'source page' });
    const service = new QuickNoteProcessingService(db, userId);

    const note = await service.createFromResources({
      content: 'from a page',
      resources: [{ id: source.documentId, type: 'document' }],
    });

    expect((await model.queryResources(note.id)).map(({ resourceId }) => resourceId)).toEqual([
      source.documentId,
    ]);
  });
});

/** @example The configured analyzer is a user-global setting, read from any workspace scope. */
describe('Quick Note Analyze agent resolution', () => {
  /** @example An analyzer the current scope cannot see falls back to the builtin one. */
  it('runs the builtin analyzer when the configured one is not visible in this scope', async () => {
    // ROOT CAUSE:
    // The analyzer picked in one workspace was passed as `agentId` everywhere, so in another
    // scope `execAgent` could not resolve it and every Analyze failed until the setting reset.
    const settings = await QuickNoteModel.getAnalyzeSettings(db, userId);
    vi.spyOn(QuickNoteModel, 'getAnalyzeSettings').mockResolvedValue({
      ...settings,
      analyzeAgentId: 'agent-in-another-workspace',
    });
    execAgent.mockRejectedValue(new Error('stop after dispatch'));
    const { run } = await seedJudgedRun('调研一下 gpt-live 和 moshi', researchDecision(3));

    await expect(
      new QuickNoteProcessingService(db, userId).dispatchGeneration(run.id),
    ).rejects.toThrow('stop after dispatch');

    const [params] = execAgent.mock.calls[0];
    /** @example The builtin analyzer runs instead of the inaccessible agent. */
    expect(params).toMatchObject({ slug: 'quick-note-analyze' });
    expect(params).not.toHaveProperty('agentId');
  });
});
