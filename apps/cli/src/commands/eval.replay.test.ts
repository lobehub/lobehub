import { rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { log } from '../utils/logger';
import { registerEvalCommand } from './eval';

const { mockTrpcClient } = vi.hoisted(() => ({
  mockTrpcClient: {
    agentEval: {
      createDataset: { mutate: vi.fn() },
      createRun: { mutate: vi.fn() },
      createSubjectRuns: { mutate: vi.fn() },
      draftTestCaseCriteria: { mutate: vi.fn() },
      freezeTestCaseFromMessage: { mutate: vi.fn() },
      getDataset: { query: vi.fn() },
      getReplayComparison: { query: vi.fn() },
      startReplayComparison: { mutate: vi.fn() },
      updateTestCase: { mutate: vi.fn() },
    },
  },
}));

vi.mock('../api/client', () => ({
  getTrpcClient: vi.fn(async () => mockTrpcClient),
}));

describe('eval command: frozen-call replay', () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    for (const method of Object.values(mockTrpcClient.agentEval)) {
      for (const fn of Object.values(method)) fn.mockReset();
    }
  });

  afterEach(() => {
    exitSpy.mockRestore();
    logSpy.mockRestore();
  });

  const createProgram = () => {
    const program = new Command();
    program.exitOverride();
    registerEvalCommand(program);
    return program;
  };

  describe('testcase freeze / compare', () => {
    it('drafts criteria for a message without saving anything', async () => {
      mockTrpcClient.agentEval.draftTestCaseCriteria.mutate.mockResolvedValue({
        criteria: 'The user is Arvin.',
        model: 'gpt-5.6-luna',
        provider: 'openai',
        summary: 'Mistook the user',
      });

      await createProgram().parseAsync(
        ['eval', 'testcase', 'draft', '--message-id', 'msg_1', '--note', 'wrong person', '--json'],
        { from: 'user' },
      );

      expect(mockTrpcClient.agentEval.draftTestCaseCriteria.mutate).toHaveBeenCalledWith({
        capturedOutputKind: 'negative',
        locale: undefined,
        messageId: 'msg_1',
        note: 'wrong person',
        stepIndex: undefined,
      });
      expect(mockTrpcClient.agentEval.freezeTestCaseFromMessage.mutate).not.toHaveBeenCalled();
    });

    it('freezes a message with criteria read from a file', async () => {
      const criteriaFile = path.join(os.tmpdir(), `criteria-${Date.now()}.md`);
      await writeFile(criteriaFile, 'The user is Arvin.');
      mockTrpcClient.agentEval.freezeTestCaseFromMessage.mutate.mockResolvedValue({
        created: true,
        testCase: { id: 'case_1' },
      });

      await createProgram().parseAsync([
        'node',
        'test',
        'eval',
        'testcase',
        'freeze',
        '--dataset-id',
        'ds_1',
        '--message-id',
        'msg_1',
        '--criteria-file',
        criteriaFile,
        '--step',
        '1',
        '--json',
      ]);
      await rm(criteriaFile);

      expect(mockTrpcClient.agentEval.freezeTestCaseFromMessage.mutate).toHaveBeenCalledWith({
        capturedOutputKind: 'negative',
        criteria: 'The user is Arvin.',
        datasetId: 'ds_1',
        expected: undefined,
        messageId: 'msg_1',
        stepIndex: 1,
      });
    });

    it('replaces a case’s judge criteria', async () => {
      mockTrpcClient.agentEval.updateTestCase.mutate.mockResolvedValue({ id: 'case_1' });

      await createProgram().parseAsync([
        'node',
        'test',
        'eval',
        'testcase',
        'update',
        '--id',
        'case_1',
        '--criteria',
        'The user is Arvin.',
        '--json',
      ]);

      expect(mockTrpcClient.agentEval.updateTestCase.mutate).toHaveBeenCalledWith({
        evalConfig: { criteria: 'The user is Arvin.' },
        evalMode: 'llm-rubric',
        id: 'case_1',
      });
    });

    it('refuses to freeze without criteria', async () => {
      const errorSpy = vi.spyOn(log, 'error').mockImplementation(() => {});

      await createProgram().parseAsync([
        'node',
        'test',
        'eval',
        'testcase',
        'freeze',
        '--dataset-id',
        'ds_1',
        '--message-id',
        'msg_1',
      ]);

      expect(mockTrpcClient.agentEval.freezeTestCaseFromMessage.mutate).not.toHaveBeenCalled();
      expect(exitSpy).toHaveBeenCalledWith(1);
      errorSpy.mockRestore();
    });

    it('starts a comparison with parsed targets and judge', async () => {
      mockTrpcClient.agentEval.startReplayComparison.mutate.mockResolvedValue({
        cellCount: 4,
        runId: 'run_1',
      });

      await createProgram().parseAsync([
        'node',
        'test',
        'eval',
        'compare',
        'start',
        '--dataset-id',
        'ds_1',
        '-m',
        'deepseek/deepseek-v4-flash, openai/gpt-6-luna',
        '--judge-model',
        'anthropic/claude-haiku-4-5',
        '--case',
        'case_1,case_2',
        '--no-tools',
        '--json',
      ]);

      expect(mockTrpcClient.agentEval.startReplayComparison.mutate).toHaveBeenCalledWith({
        datasetId: 'ds_1',
        judge: { model: 'claude-haiku-4-5', provider: 'anthropic' },
        name: undefined,
        replayOptions: { maxTokens: undefined, temperature: undefined, withTools: false },
        targets: [
          { model: 'deepseek-v4-flash', provider: 'deepseek' },
          { model: 'gpt-6-luna', provider: 'openai' },
        ],
        testCaseIds: ['case_1', 'case_2'],
      });
    });

    it('prints the model × case grid', async () => {
      mockTrpcClient.agentEval.getReplayComparison.query.mockResolvedValue({
        cases: [{ content: { input: '你不知道我是谁吗' }, id: 'case_1' }],
        cells: [
          {
            durationMs: 1200,
            judgeReason: 'calls the user 宋清扬',
            model: 'deepseek-v4-flash',
            passed: false,
            provider: 'deepseek',
            score: 0.1,
            status: 'completed',
            testCaseId: 'case_1',
          },
          {
            error: { message: 'not valid JSON', stage: 'replay' },
            model: 'gpt-6-luna',
            provider: 'openai',
            status: 'error',
            testCaseId: 'case_1',
          },
        ],
        judge: { model: 'claude-haiku-4-5', provider: 'anthropic' },
        run: { id: 'run_1', name: 'Compare', status: 'completed' },
        targets: [
          { model: 'deepseek-v4-flash', provider: 'deepseek' },
          { model: 'gpt-6-luna', provider: 'openai' },
        ],
      });

      await createProgram().parseAsync([
        'node',
        'test',
        'eval',
        'compare',
        'show',
        '--run-id',
        'run_1',
      ]);

      const output = logSpy.mock.calls.map((call) => String(call[0])).join('\n');
      expect(output).toContain('deepseek/deepseek-v4-flash');
      expect(output).toContain('0.10');
      expect(output).toContain('calls the user 宋清扬');
      expect(output).toContain('not valid JSON');
      expect(output).not.toContain('undefined');
    });
  });

  describe('run create --model', () => {
    it('runs the agent on one subject model via the run config', async () => {
      mockTrpcClient.agentEval.getDataset.query.mockResolvedValue({ benchmarkId: 'b1' });
      mockTrpcClient.agentEval.createRun.mutate.mockResolvedValue({ id: 'r1' });

      const program = createProgram();
      await program.parseAsync(
        [
          'eval',
          'run',
          'create',
          '--dataset-id',
          'd1',
          '--agent-id',
          'a1',
          '-m',
          'openai/gpt-6-luna',
        ],
        { from: 'user' },
      );

      expect(mockTrpcClient.agentEval.createRun.mutate).toHaveBeenCalledWith(
        expect.objectContaining({
          config: { model: 'gpt-6-luna', provider: 'openai' },
          targetAgentId: 'a1',
        }),
      );
    });

    it('creates one run per model when several are given', async () => {
      mockTrpcClient.agentEval.getDataset.query.mockResolvedValue({ benchmarkId: 'b1' });
      mockTrpcClient.agentEval.createSubjectRuns.mutate.mockResolvedValue([
        { id: 'r1' },
        { id: 'r2' },
      ]);

      const program = createProgram();
      await program.parseAsync(
        [
          'eval',
          'run',
          'create',
          '--dataset-id',
          'd1',
          '--agent-id',
          'a1',
          '-m',
          'openai/gpt-6-luna,deepseek/deepseek-v4-flash',
        ],
        { from: 'user' },
      );

      expect(mockTrpcClient.agentEval.createRun.mutate).not.toHaveBeenCalled();
      expect(mockTrpcClient.agentEval.createSubjectRuns.mutate).toHaveBeenCalledWith(
        expect.objectContaining({
          datasetId: 'd1',
          subjects: [
            { model: 'gpt-6-luna', provider: 'openai' },
            { model: 'deepseek-v4-flash', provider: 'deepseek' },
          ],
          targetAgentId: 'a1',
        }),
      );
    });
  });

  describe('dataset create', () => {
    it('creates a standalone dataset to freeze cases into', async () => {
      mockTrpcClient.agentEval.createDataset.mutate.mockResolvedValue({ id: 'd2' });

      await createProgram().parseAsync([
        'node',
        'test',
        'eval',
        'dataset',
        'create',
        '--identifier',
        'captured',
        '-n',
        'Captured',
        '--json',
      ]);

      expect(mockTrpcClient.agentEval.createDataset.mutate).toHaveBeenCalledWith({
        identifier: 'captured',
        name: 'Captured',
      });
      const output = JSON.parse(String(logSpy.mock.calls.at(-1)?.[0]));
      expect(output.data.url).toContain('/eval/datasets/d2');
    });
  });
});
