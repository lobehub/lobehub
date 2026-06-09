import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentEvalRunModel, AgentEvalRunTopicModel } from '@/database/models/agentEval';
import { ThreadModel } from '@/database/models/thread';
import { messages, topics } from '@/database/schemas';
import { AgentEvalRunService } from '@/server/services/agentEvalRun';
import type * as AgentEvalRunWorkflowModule from '@/server/workflows/agentEvalRun';
import { AgentEvalRunWorkflow } from '@/server/workflows/agentEvalRun';

import { cleanupDB, serverDB, setupEvalChain, userId } from './_setup';

const mockExecAgent = vi.fn();

vi.mock('@/server/services/aiAgent', () => ({
  AiAgentService: vi.fn().mockImplementation(() => ({
    execAgent: mockExecAgent,
  })),
}));

vi.mock('@/server/workflows/agentEvalRun', async (importOriginal) => {
  const actual = (await importOriginal()) as typeof AgentEvalRunWorkflowModule;

  return {
    ...actual,
    AgentEvalRunWorkflow: {
      ...actual.AgentEvalRunWorkflow,
      triggerResumeAgentTrajectory: vi.fn().mockResolvedValue({}),
      triggerResumeThreadTrajectory: vi.fn().mockResolvedValue({}),
    },
  };
});

vi.mock('@/envs/app', () => ({
  appEnv: { APP_URL: 'https://test.example.com' },
}));

vi.mock('@/server/services/agentRuntime/AgentRuntimeService', () => ({
  AgentRuntimeService: vi.fn().mockImplementation(() => ({
    interruptOperation: vi.fn().mockResolvedValue(true),
  })),
}));

const markTopicTimeout = async (params: { runId: string; testCaseId: string; topicId: string }) => {
  const runTopicModel = new AgentEvalRunTopicModel(serverDB, userId);

  await runTopicModel.updateByRunAndTopic(params.runId, params.topicId, {
    evalResult: { completionReason: 'timeout', duration: 1000, rubricScores: [] },
    passed: false,
    score: 0,
    status: 'timeout',
  });

  return runTopicModel.findByRunAndTestCase(params.runId, params.testCaseId);
};

beforeEach(async () => {
  await cleanupDB();
  mockExecAgent.mockReset();
  vi.mocked(AgentEvalRunWorkflow.triggerResumeAgentTrajectory).mockReset();
  vi.mocked(AgentEvalRunWorkflow.triggerResumeThreadTrajectory).mockReset();
});

describe('AgentEvalRunService', () => {
  describe('canResumeTrajectory', () => {
    it.each(['running', 'failed', 'aborted'] as const)(
      'should allow timeout trajectory resume when run status is %s',
      async (status) => {
        const { run, testCase, topic } = await setupEvalChain({ totalCases: 1 });

        await new AgentEvalRunModel(serverDB, userId).update(run.id, { status });
        await markTopicTimeout({ runId: run.id, testCaseId: testCase.id, topicId: topic.id });

        await expect(
          new AgentEvalRunService(serverDB, userId).canResumeTrajectory({
            runId: run.id,
            testCaseId: testCase.id,
          }),
        ).resolves.toEqual({ canResume: true });
      },
    );

    it('should reject completed runs', async () => {
      const { run, testCase, topic } = await setupEvalChain({ totalCases: 1 });

      await new AgentEvalRunModel(serverDB, userId).update(run.id, { status: 'completed' });
      await markTopicTimeout({ runId: run.id, testCaseId: testCase.id, topicId: topic.id });

      await expect(
        new AgentEvalRunService(serverDB, userId).canResumeTrajectory({
          runId: run.id,
          testCaseId: testCase.id,
        }),
      ).resolves.toEqual({
        canResume: false,
        reason: 'Trajectory is not resumable',
      });
    });

    it('should reject trajectories that are neither timeout nor error', async () => {
      const { run, testCase } = await setupEvalChain({ totalCases: 1 });

      await new AgentEvalRunModel(serverDB, userId).update(run.id, { status: 'failed' });

      await expect(
        new AgentEvalRunService(serverDB, userId).canResumeTrajectory({
          runId: run.id,
          testCaseId: testCase.id,
        }),
      ).resolves.toEqual({
        canResume: false,
        reason: 'Trajectory is not resumable',
      });
    });

    it('should require threadId for pass@k resume', async () => {
      const { run, testCase, topic } = await setupEvalChain({ totalCases: 1 });

      await new AgentEvalRunModel(serverDB, userId).update(run.id, {
        config: { k: 2 },
        status: 'failed',
      });
      await markTopicTimeout({ runId: run.id, testCaseId: testCase.id, topicId: topic.id });

      await expect(
        new AgentEvalRunService(serverDB, userId).canResumeTrajectory({
          runId: run.id,
          testCaseId: testCase.id,
        }),
      ).resolves.toEqual({
        canResume: false,
        reason: 'Invalid resume target',
      });
    });

    it('should reject threads outside the target eval trajectory', async () => {
      const { run, testCase, topic } = await setupEvalChain({ totalCases: 1 });

      await new AgentEvalRunModel(serverDB, userId).update(run.id, {
        config: { k: 2 },
        status: 'failed',
      });
      await markTopicTimeout({ runId: run.id, testCaseId: testCase.id, topicId: topic.id });

      const [{ id: otherTopicId }] = await serverDB
        .insert(topics)
        .values({ mode: 'test', title: 'Other Eval Topic', trigger: 'eval', userId })
        .returning({ id: topics.id });
      const otherThread = await new ThreadModel(serverDB, userId).create({
        topicId: otherTopicId,
        type: 'eval',
      });

      await expect(
        new AgentEvalRunService(serverDB, userId).canResumeTrajectory({
          runId: run.id,
          testCaseId: testCase.id,
          threadId: otherThread!.id,
        }),
      ).resolves.toEqual({
        canResume: false,
        reason: 'Invalid resume target',
      });
    });

    it('should allow pass@k resume when the case passed but a thread errored', async () => {
      const { run, testCase, topic } = await setupEvalChain({ totalCases: 1 });

      await new AgentEvalRunModel(serverDB, userId).update(run.id, {
        config: { k: 2 },
        status: 'failed',
      });

      const threadModel = new ThreadModel(serverDB, userId);
      const errorThread = await threadModel.create({ topicId: topic.id, type: 'eval' });
      const passedThread = await threadModel.create({ topicId: topic.id, type: 'eval' });

      await new AgentEvalRunTopicModel(serverDB, userId).updateByRunAndTopic(run.id, topic.id, {
        evalResult: {
          passAllK: false,
          passAtK: true,
          threads: [
            { status: 'error', threadId: errorThread!.id },
            { passed: true, status: 'passed', threadId: passedThread!.id },
          ],
        },
        passed: true,
        score: 1,
        status: 'passed',
      });

      await expect(
        new AgentEvalRunService(serverDB, userId).canResumeTrajectory({
          runId: run.id,
          testCaseId: testCase.id,
          threadId: errorThread!.id,
        }),
      ).resolves.toEqual({ canResume: true });
    });

    it('should enforce maxSteps using the target thread history for pass@k resume', async () => {
      const { run, testCase, topic } = await setupEvalChain({ totalCases: 1 });

      await new AgentEvalRunModel(serverDB, userId).update(run.id, {
        config: { k: 2, maxSteps: 5 },
        status: 'failed',
      });

      const threadModel = new ThreadModel(serverDB, userId);
      const errorThread = await threadModel.create({ topicId: topic.id, type: 'eval' });
      const passedThread = await threadModel.create({ topicId: topic.id, type: 'eval' });

      await new AgentEvalRunTopicModel(serverDB, userId).updateByRunAndTopic(run.id, topic.id, {
        evalResult: {
          passAllK: false,
          passAtK: true,
          steps: 3,
          threads: [
            { status: 'error', threadId: errorThread!.id },
            { passed: true, status: 'passed', threadId: passedThread!.id },
          ],
        },
        passed: true,
        score: 1,
        status: 'passed',
      });

      await threadModel.update(errorThread!.id, {
        metadata: {
          completedAt: new Date('2026-03-30T00:00:00.000Z').toISOString(),
          status: 'error',
          steps: 5,
          testCaseId: testCase.id,
        },
      } as any);

      await expect(
        new AgentEvalRunService(serverDB, userId).canResumeTrajectory({
          runId: run.id,
          testCaseId: testCase.id,
          threadId: errorThread!.id,
        }),
      ).resolves.toEqual({
        canResume: false,
        reason: 'Resume limit reached',
      });
    });
  });

  describe('getResumableCases', () => {
    it('should include pass@k cases that have resumable threads', async () => {
      const { run, testCase, topic } = await setupEvalChain({ totalCases: 1 });

      await new AgentEvalRunModel(serverDB, userId).update(run.id, {
        config: { k: 2 },
        status: 'failed',
      });

      const threadModel = new ThreadModel(serverDB, userId);
      const errorThread = await threadModel.create({ topicId: topic.id, type: 'eval' });
      const passedThread = await threadModel.create({ topicId: topic.id, type: 'eval' });

      await new AgentEvalRunTopicModel(serverDB, userId).updateByRunAndTopic(run.id, topic.id, {
        evalResult: {
          passAllK: false,
          passAtK: true,
          threads: [
            { status: 'error', threadId: errorThread!.id },
            { passed: true, status: 'passed', threadId: passedThread!.id },
          ],
        },
        passed: true,
        score: 1,
        status: 'passed',
      });

      await expect(
        new AgentEvalRunService(serverDB, userId).getResumableCases(run.id),
      ).resolves.toEqual([
        {
          canResume: true,
          caseStatus: 'passed',
          input: testCase.content.input,
          reason: undefined,
          resumeStatus: 'error',
          sortOrder: testCase.sortOrder,
          testCaseId: testCase.id,
          threadId: errorThread!.id,
        },
      ]);
    });
  });

  describe('resumeTrajectory', () => {
    it('should only trigger workflow for a timed-out pass@1 trajectory without mutating state', async () => {
      const { run, testCase, topic } = await setupEvalChain({ totalCases: 1 });

      const [userMessage] = await serverDB
        .insert(messages)
        .values({
          content: 'What is 6*7?',
          role: 'user',
          topicId: topic.id,
          userId,
        })
        .returning({ id: messages.id });

      await serverDB.insert(messages).values({
        content: '...',
        parentId: userMessage.id,
        role: 'assistant',
        topicId: topic.id,
        userId,
      });

      const runModel = new AgentEvalRunModel(serverDB, userId);
      const runTopicModel = new AgentEvalRunTopicModel(serverDB, userId);

      await runModel.update(run.id, {
        metrics: {
          averageScore: 0,
          completedCases: 1,
          failedCases: 0,
          passRate: 0,
          passedCases: 0,
          timeoutCases: 1,
          totalCases: 1,
        },
        status: 'failed',
      });
      await markTopicTimeout({ runId: run.id, testCaseId: testCase.id, topicId: topic.id });

      const service = new AgentEvalRunService(serverDB, userId);
      const result = await service.resumeTrajectory({ runId: run.id, testCaseId: testCase.id });

      expect(result).toEqual({
        mode: 'single',
        runId: run.id,
        testCaseId: testCase.id,
        threadId: undefined,
        topicId: topic.id,
        triggered: true,
      });

      expect(AgentEvalRunWorkflow.triggerResumeAgentTrajectory).toHaveBeenCalledWith(
        expect.objectContaining({
          appContext: { topicId: topic.id },
          envPrompt: undefined,
          maxSteps: undefined,
          parentMessageId: userMessage.id,
          runId: run.id,
          testCaseId: testCase.id,
          topicId: topic.id,
          userId,
        }),
      );
      expect(mockExecAgent).not.toHaveBeenCalled();

      const refreshedRun = await runModel.findById(run.id);
      expect(refreshedRun?.status).toBe('failed');
      expect(refreshedRun?.metrics).toMatchObject({
        completedCases: 1,
        timeoutCases: 1,
      });

      const refreshedRunTopic = await runTopicModel.findByRunAndTestCase(run.id, testCase.id);
      expect(refreshedRunTopic?.status).toBe('timeout');
      expect(refreshedRunTopic?.evalResult).toEqual({
        completionReason: 'timeout',
        duration: 1000,
        rubricScores: [],
      });
    });

    it('should only trigger workflow for the target pass@k thread without mutating thread state', async () => {
      const { run, testCase, topic } = await setupEvalChain({ totalCases: 1 });

      await new AgentEvalRunModel(serverDB, userId).update(run.id, {
        config: { k: 2 },
        status: 'failed',
      });
      await markTopicTimeout({ runId: run.id, testCaseId: testCase.id, topicId: topic.id });

      const threadModel = new ThreadModel(serverDB, userId);
      const thread = await threadModel.create({ topicId: topic.id, type: 'eval' });
      const otherThread = await threadModel.create({ topicId: topic.id, type: 'eval' });

      await new AgentEvalRunTopicModel(serverDB, userId).updateByRunAndTopic(run.id, topic.id, {
        evalResult: {
          passAllK: false,
          passAtK: true,
          threads: [
            { status: 'timeout', threadId: thread!.id },
            { passed: true, status: 'passed', threadId: otherThread!.id },
          ],
        },
        passed: true,
        score: 1,
        status: 'passed',
      });

      await threadModel.update(thread!.id, {
        metadata: {
          completedAt: new Date('2026-03-30T00:00:00.000Z').toISOString(),
          operationId: 'op-target-old',
          passed: false,
          score: 0,
          testCaseId: testCase.id,
        },
      } as any);
      await threadModel.update(otherThread!.id, {
        metadata: {
          completedAt: new Date('2026-03-30T00:00:01.000Z').toISOString(),
          operationId: 'op-other-thread',
          passed: true,
          score: 1,
          testCaseId: testCase.id,
        },
      } as any);

      const [threadUserMessage] = await serverDB
        .insert(messages)
        .values({
          content: 'thread user prompt',
          role: 'user',
          threadId: thread!.id,
          topicId: topic.id,
          userId,
        })
        .returning({ id: messages.id });

      await serverDB.insert(messages).values({
        content: '...',
        parentId: threadUserMessage.id,
        role: 'assistant',
        threadId: thread!.id,
        topicId: topic.id,
        userId,
      });

      const service = new AgentEvalRunService(serverDB, userId);
      const result = await service.resumeTrajectory({
        runId: run.id,
        testCaseId: testCase.id,
        threadId: thread!.id,
      });

      expect(result).toEqual({
        mode: 'thread',
        runId: run.id,
        testCaseId: testCase.id,
        threadId: thread!.id,
        topicId: topic.id,
        triggered: true,
      });

      expect(AgentEvalRunWorkflow.triggerResumeThreadTrajectory).toHaveBeenCalledWith(
        expect.objectContaining({
          appContext: { threadId: thread!.id, topicId: topic.id },
          envPrompt: undefined,
          maxSteps: undefined,
          parentMessageId: threadUserMessage.id,
          runId: run.id,
          testCaseId: testCase.id,
          threadId: thread!.id,
          topicId: topic.id,
          userId,
        }),
      );
      expect(mockExecAgent).not.toHaveBeenCalled();

      expect((await threadModel.findById(thread!.id))?.metadata).toMatchObject({
        operationId: 'op-target-old',
        testCaseId: testCase.id,
      });
      expect((await threadModel.findById(otherThread!.id))?.metadata).toMatchObject({
        operationId: 'op-other-thread',
        passed: true,
        score: 1,
        testCaseId: testCase.id,
      });
    });
  });

  describe('executeResumedTrajectory', () => {
    it('should claim a timeout trajectory, switch run back to running, and store operationId', async () => {
      const { run, testCase, topic } = await setupEvalChain({ totalCases: 1 });

      await new AgentEvalRunModel(serverDB, userId).update(run.id, { status: 'failed' });
      await markTopicTimeout({ runId: run.id, testCaseId: testCase.id, topicId: topic.id });

      mockExecAgent.mockResolvedValue({ operationId: 'op-resume-1' });

      const service = new AgentEvalRunService(serverDB, userId);
      const result = await service.executeResumedTrajectory({
        appContext: { topicId: topic.id },
        parentMessageId: 'parent-message-id',
        runId: run.id,
        testCaseId: testCase.id,
        topicId: topic.id,
        userId,
      });

      expect(result).toEqual({ status: 'started', topicId: topic.id });
      expect(mockExecAgent).toHaveBeenCalledWith(
        expect.objectContaining({
          appContext: { topicId: topic.id },
          parentMessageId: 'parent-message-id',
          prompt: '',
          resume: true,
        }),
      );

      const refreshedRun = await new AgentEvalRunModel(serverDB, userId).findById(run.id);
      expect(refreshedRun?.status).toBe('running');
      expect(refreshedRun?.startedAt).toBeTruthy();

      const refreshedRunTopic = await new AgentEvalRunTopicModel(
        serverDB,
        userId,
      ).findByRunAndTestCase(run.id, testCase.id);
      expect(refreshedRunTopic?.status).toBe('running');
      expect(refreshedRunTopic?.evalResult).toEqual({
        operationId: 'op-resume-1',
        rubricScores: [],
      });
    });

    it('should cancel when the trajectory is not resumable', async () => {
      const { run, testCase, topic } = await setupEvalChain({ totalCases: 1 });

      await new AgentEvalRunModel(serverDB, userId).update(run.id, { status: 'failed' });

      const result = await new AgentEvalRunService(serverDB, userId).executeResumedTrajectory({
        appContext: { topicId: topic.id },
        parentMessageId: 'parent-message-id',
        runId: run.id,
        testCaseId: testCase.id,
        topicId: topic.id,
        userId,
      });

      expect(result).toEqual({
        reason: 'Trajectory is not resumable',
        status: 'cancelled',
        topicId: topic.id,
      });
      expect(mockExecAgent).not.toHaveBeenCalled();
    });
  });

  describe('executeResumedThreadTrajectory', () => {
    it('should claim only the target timeout thread and store operationId on that thread', async () => {
      const { run, testCase, topic } = await setupEvalChain({ totalCases: 1 });

      await new AgentEvalRunModel(serverDB, userId).update(run.id, {
        config: { k: 2 },
        status: 'failed',
      });
      await markTopicTimeout({ runId: run.id, testCaseId: testCase.id, topicId: topic.id });

      const threadModel = new ThreadModel(serverDB, userId);
      const thread = await threadModel.create({ topicId: topic.id, type: 'eval' });
      const otherThread = await threadModel.create({ topicId: topic.id, type: 'eval' });

      await new AgentEvalRunTopicModel(serverDB, userId).updateByRunAndTopic(run.id, topic.id, {
        evalResult: {
          passAllK: false,
          passAtK: true,
          threads: [
            { status: 'timeout', threadId: thread!.id },
            { passed: true, status: 'passed', threadId: otherThread!.id },
          ],
        },
        passed: true,
        score: 1,
        status: 'passed',
      });

      await threadModel.update(thread!.id, {
        metadata: {
          completedAt: new Date('2026-03-30T00:00:00.000Z').toISOString(),
          cost: 1.2,
          llmCalls: 3,
          operationId: 'op-old-target',
          passed: false,
          score: 0,
          status: 'timeout',
          steps: 7,
          testCaseId: testCase.id,
          tokens: 123,
          toolCalls: 2,
        },
      } as any);
      await threadModel.update(otherThread!.id, {
        metadata: {
          completedAt: new Date('2026-03-30T00:00:01.000Z').toISOString(),
          operationId: 'op-other-thread',
          passed: true,
          score: 1,
          testCaseId: testCase.id,
        },
      } as any);

      mockExecAgent.mockResolvedValue({ operationId: 'op-thread-resume-1' });

      const result = await new AgentEvalRunService(serverDB, userId).executeResumedThreadTrajectory(
        {
          appContext: { threadId: thread!.id, topicId: topic.id },
          parentMessageId: 'parent-message-id',
          runId: run.id,
          testCaseId: testCase.id,
          threadId: thread!.id,
          topicId: topic.id,
          userId,
        },
      );

      expect(result).toEqual({ status: 'started', threadId: thread!.id, topicId: topic.id });
      expect(mockExecAgent).toHaveBeenCalledWith(
        expect.objectContaining({
          appContext: { threadId: thread!.id, topicId: topic.id },
          initialStepCount: 7,
          parentMessageId: 'parent-message-id',
          prompt: '',
          resume: true,
        }),
      );

      const updatedThread = await threadModel.findById(thread!.id);
      expect(updatedThread?.metadata).toEqual({
        operationId: 'op-thread-resume-1',
        testCaseId: testCase.id,
      });

      const untouchedThread = await threadModel.findById(otherThread!.id);
      expect(untouchedThread?.metadata).toMatchObject({
        operationId: 'op-other-thread',
        passed: true,
        score: 1,
        testCaseId: testCase.id,
      });

      const refreshedRunTopic = await new AgentEvalRunTopicModel(
        serverDB,
        userId,
      ).findByRunAndTestCase(run.id, testCase.id);
      expect(refreshedRunTopic?.status).toBe('running');
      expect(refreshedRunTopic?.evalResult).toEqual({
        threads: [
          { status: 'running', threadId: thread!.id },
          { passed: true, status: 'passed', threadId: otherThread!.id },
        ],
      });
    });
  });
});
