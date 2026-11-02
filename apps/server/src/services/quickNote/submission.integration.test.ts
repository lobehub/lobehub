// @vitest-environment node
import type { QuickNoteRunDecision } from '@lobechat/types';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getTestDB } from '@/database/core/getTestDB';
import { QuickNoteModel } from '@/database/models/quickNote';
import { QuickNoteRepository } from '@/database/repositories/quickNote';
import {
  agentOperations,
  messagePlugins,
  messages,
  quickNoteRuns,
  topics,
  users,
} from '@/database/schemas';

import { QuickNoteProcessingService } from '.';
import { renderQuickNoteSourceText as renderSourceText } from './sourceText';

vi.mock('@/server/services/agentSignal', () => ({ enqueueAgentSignalSourceEvent: vi.fn() }));

const db = await getTestDB();
const userId = 'quick-note-submission-test';
const model = new QuickNoteModel(db, userId);
const repo = new QuickNoteRepository(db, userId);

const researchDecision: QuickNoteRunDecision = {
  decisionMode: 'emulated',
  evidence: '"调研一下"',
  explicitGoalRequest: false,
  preset: 'research',
  presetScores: { discuss: 0, goal: 0, research: 3, write_document: 0 },
  primary: 'delegate',
  scores: { delegate: 3, enrich: 2, keep: 0, link: 0 },
};

const submission = {
  contextQueries: [],
  delegate: { instruction: 'Compare gpt-live and moshi latency', name: 'gpt-live vs moshi' },
  relatedResources: [],
  summary: 'Compare two speech models',
  tags: ['speech'],
};

/** Leaked DeepSeek tool-call markup: the last answer of a run that hit its step limit. */
const DSML_ONLY =
  '<｜DSML｜function_calls><｜DSML｜invoke name="lobe-web-browsing____search"></｜DSML｜invoke></｜DSML｜function_calls>';

let messageSeq = 0;

/** Seeds a judged Run attached to a finished operation with its own Topic. */
const seedRun = async () => {
  const note = await repo.create({
    content: '调研一下 gpt-live 和 moshi 的差异',
    editorData: { markdown: '调研一下 gpt-live 和 moshi 的差异' },
  });
  const run = (await repo.claimRun(note.id, {
    kind: 'analyze',
    renderSourceText,
    trigger: 'manual',
  }))!;
  await model.recordRunDecision(run.id, researchDecision);

  const topicId = `tpc_${run.id}`;
  const operationId = `op_${run.id}`;
  await db.insert(topics).values({ id: topicId, userId });
  await db.insert(agentOperations).values({
    id: operationId,
    model: 'deepseek-chat',
    provider: 'deepseek',
    status: 'done',
    topicId,
    userId,
  });
  await db
    .update(quickNoteRuns)
    .set({ operationId, status: 'running', topicId })
    .where(eq(quickNoteRuns.id, run.id));

  await addMessage(topicId, { content: '<quick_note>调研一下</quick_note>', role: 'user' });
  return { note, run, topicId };
};

const addMessage = async (
  topicId: string,
  message: { content: string; role: string },
  plugin?: { apiName: string; arguments: string; error?: unknown; identifier: string },
) => {
  messageSeq += 1;
  const id = `msg_submission_${messageSeq}`;
  await db.insert(messages).values({
    ...message,
    createdAt: new Date(Date.now() + messageSeq),
    id,
    topicId,
    userId,
  });
  if (plugin) {
    await db
      .insert(messagePlugins)
      .values({ ...plugin, error: plugin.error ?? null, id, toolCallId: `call_${id}`, userId });
  }
};

const addSubmitCall = (topicId: string, args: unknown, error?: unknown) =>
  addMessage(
    topicId,
    { content: error ? 'Result rejected' : 'Result recorded', role: 'tool' },
    {
      apiName: 'submitResult',
      arguments: JSON.stringify(args),
      error,
      identifier: 'lobe-quick-note',
    },
  );

beforeEach(async () => {
  await db.insert(users).values({ id: userId });
});
afterEach(async () => {
  await db.delete(users).where(eq(users.id, userId));
  vi.restoreAllMocks();
});

describe('Quick Note run output via submitResult', () => {
  it('projects the submitResult call of a run that submitted early', async () => {
    const { note, run, topicId } = await seedRun();
    await addSubmitCall(topicId, submission);
    const generateObject = vi.fn();

    const completed = await new QuickNoteProcessingService(db, userId, undefined, {
      generator: { generateObject },
    }).onRunComplete({ lastAssistantContent: '', reason: 'done', runId: run.id });

    expect(completed && 'run' in completed ? completed.run : completed).toMatchObject({
      status: 'completed',
      summary: 'Compare two speech models',
    });
    expect(generateObject).not.toHaveBeenCalled();
    const [proposal] = await model.queryProposals(note.id);
    expect(proposal).toMatchObject({
      decisionStatus: 'pending',
      kind: 'task',
      payload: { name: 'gpt-live vs moshi' },
    });
  });

  // ROOT CAUSE:
  // At maxSteps the last assistant output was only DeepSeek DSML tool-call markup, so there was
  // no JSON answer and the Run failed. A run that never submitted now gets one forced call.
  it('forces a submit when the run hit its step limit with only tool calls', async () => {
    const { note, run, topicId } = await seedRun();
    await addMessage(topicId, { content: DSML_ONLY, role: 'assistant' });
    await addMessage(
      topicId,
      { content: 'moshi is full duplex', role: 'tool' },
      { apiName: 'search', arguments: '{}', identifier: 'lobe-web-browsing' },
    );
    // A rejected submit never becomes the Run's output.
    await addSubmitCall(
      topicId,
      { summary: '' },
      { message: 'invalid', type: 'INVALID_ARGUMENTS' },
    );
    const generateObject = vi
      .fn()
      .mockResolvedValue([{ arguments: JSON.stringify(submission), name: 'submitResult' }]);

    const completed = await new QuickNoteProcessingService(db, userId, undefined, {
      generator: { generateObject },
    }).onRunComplete({ lastAssistantContent: DSML_ONLY, reason: 'max_steps', runId: run.id });

    expect(completed && 'run' in completed ? completed.run : completed).toMatchObject({
      status: 'completed',
      summary: 'Compare two speech models',
    });
    expect(generateObject).toHaveBeenCalledTimes(1);
    const [input, options] = generateObject.mock.calls[0];
    expect(input).toMatchObject({ model: 'deepseek-chat', provider: 'deepseek' });
    expect(input.tools[0].function.name).toBe('submitResult');
    expect(input.messages[0].content).toContain('"delegate"');
    expect(input.messages[1].content).toContain('moshi is full duplex');
    expect(options.tracing).toMatchObject({ scenario: 'quick_note_submit', topicId });
    expect(await model.queryProposals(note.id)).toHaveLength(1);
  });

  it('fails without automatic retry when the forced submit stays invalid', async () => {
    const { run } = await seedRun();
    const generateObject = vi
      .fn()
      .mockResolvedValue([{ arguments: '{"tags":[]}', name: 'submitResult' }]);

    await new QuickNoteProcessingService(db, userId, undefined, {
      generator: { generateObject },
    }).onRunComplete({ lastAssistantContent: DSML_ONLY, reason: 'max_steps', runId: run.id });

    expect(generateObject).toHaveBeenCalledTimes(2);
    expect(await model.getRunContext(run.id)).toMatchObject({ status: 'failed' });
    const [saved] = await db.select().from(quickNoteRuns).where(eq(quickNoteRuns.id, run.id));
    expect(saved.error).toMatchObject({ code: 'projection_failed' });
  });

  it('still accepts a JSON text answer without a forced call', async () => {
    const { run } = await seedRun();
    const generateObject = vi.fn();

    const completed = await new QuickNoteProcessingService(db, userId, undefined, {
      generator: { generateObject },
    }).onRunComplete({
      lastAssistantContent: `\`\`\`json\n${JSON.stringify(submission)}\n\`\`\``,
      reason: 'done',
      runId: run.id,
    });

    expect(completed && 'run' in completed ? completed.run : completed).toMatchObject({
      status: 'completed',
    });
    expect(generateObject).not.toHaveBeenCalled();
  });

  it('does not spend a forced call after a cost cap', async () => {
    const { run } = await seedRun();
    const generateObject = vi.fn();

    await new QuickNoteProcessingService(db, userId, undefined, {
      generator: { generateObject },
    }).onRunComplete({ lastAssistantContent: '', reason: 'cost_limit', runId: run.id });

    expect(generateObject).not.toHaveBeenCalled();
    const [saved] = await db.select().from(quickNoteRuns).where(eq(quickNoteRuns.id, run.id));
    expect(saved).toMatchObject({ error: { code: 'no_accepted_output' }, status: 'failed' });
  });
});
