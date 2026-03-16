import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockTrpcClient } = vi.hoisted(() => ({
  mockTrpcClient: {
    agentEval: {
      abortRun: { mutate: vi.fn() },
      createBenchmark: { mutate: vi.fn() },
      createDataset: { mutate: vi.fn() },
      createRun: { mutate: vi.fn() },
      createTestCase: { mutate: vi.fn() },
      deleteBenchmark: { mutate: vi.fn() },
      deleteDataset: { mutate: vi.fn() },
      deleteRun: { mutate: vi.fn() },
      deleteTestCase: { mutate: vi.fn() },
      getBenchmark: { query: vi.fn() },
      getDataset: { query: vi.fn() },
      getRunDetails: { query: vi.fn() },
      getRunProgress: { query: vi.fn() },
      getRunResults: { query: vi.fn() },
      getTestCase: { query: vi.fn() },
      listBenchmarks: { query: vi.fn() },
      listDatasets: { query: vi.fn() },
      listRuns: { query: vi.fn() },
      listTestCases: { query: vi.fn() },
      retryRunErrors: { mutate: vi.fn() },
      startRun: { mutate: vi.fn() },
      updateBenchmark: { mutate: vi.fn() },
      updateDataset: { mutate: vi.fn() },
      updateTestCase: { mutate: vi.fn() },
    },
    agentEvalExternal: {
      datasetGet: { query: vi.fn() },
      messagesList: { query: vi.fn() },
      runGet: { query: vi.fn() },
      runSetStatus: { mutate: vi.fn() },
      runTopicReportResult: { mutate: vi.fn() },
      runTopicsList: { query: vi.fn() },
      testCasesCount: { query: vi.fn() },
      threadsList: { query: vi.fn() },
    },
  },
}));

const { getTrpcClientMock } = vi.hoisted(() => ({
  getTrpcClientMock: vi.fn(),
}));

vi.mock('../api/client', () => ({
  getTrpcClient: getTrpcClientMock,
}));

vi.mock('../utils/logger', () => ({
  log: {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
  setVerbose: vi.fn(),
}));

// eslint-disable-next-line import-x/first
import { log } from '../utils/logger';
// eslint-disable-next-line import-x/first
import { registerEvalCommand } from './eval';

describe('eval command', () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    getTrpcClientMock.mockResolvedValue(mockTrpcClient);
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    for (const ns of Object.values(mockTrpcClient)) {
      for (const method of Object.values(ns as Record<string, any>)) {
        for (const fn of Object.values(method as Record<string, any>)) {
          (fn as ReturnType<typeof vi.fn>).mockReset();
        }
      }
    }
  });

  afterEach(() => {
    exitSpy.mockRestore();
    logSpy.mockRestore();
    vi.clearAllMocks();
  });

  const createProgram = () => {
    const program = new Command();
    program.exitOverride();
    registerEvalCommand(program);
    return program;
  };

  // ============================================
  // Benchmark tests
  // ============================================
  describe('benchmark', () => {
    it('should list benchmarks', async () => {
      mockTrpcClient.agentEval.listBenchmarks.query.mockResolvedValue([
        { id: 'b1', name: 'Bench 1' },
      ]);

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'eval', 'benchmark', 'list', '--json']);

      expect(mockTrpcClient.agentEval.listBenchmarks.query).toHaveBeenCalled();
    });

    it('should create a benchmark', async () => {
      mockTrpcClient.agentEval.createBenchmark.mutate.mockResolvedValue({ id: 'b1' });

      const program = createProgram();
      await program.parseAsync([
        'node',
        'test',
        'eval',
        'benchmark',
        'create',
        '--identifier',
        'test-bench',
        '-n',
        'Test Bench',
        '--json',
      ]);

      expect(mockTrpcClient.agentEval.createBenchmark.mutate).toHaveBeenCalledWith(
        expect.objectContaining({ identifier: 'test-bench', name: 'Test Bench' }),
      );
    });

    it('should delete a benchmark', async () => {
      mockTrpcClient.agentEval.deleteBenchmark.mutate.mockResolvedValue({ success: true });

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'eval', 'benchmark', 'delete', '--id', 'b1']);

      expect(mockTrpcClient.agentEval.deleteBenchmark.mutate).toHaveBeenCalledWith({ id: 'b1' });
    });
  });

  // ============================================
  // Dataset tests
  // ============================================
  describe('dataset', () => {
    it('should list datasets', async () => {
      mockTrpcClient.agentEval.listDatasets.query.mockResolvedValue([{ id: 'd1', name: 'DS 1' }]);

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'eval', 'dataset', 'list', '--json']);

      expect(mockTrpcClient.agentEval.listDatasets.query).toHaveBeenCalled();
    });

    it('should get dataset via internal API', async () => {
      mockTrpcClient.agentEval.getDataset.query.mockResolvedValue({ id: 'd1' });

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'eval', 'dataset', 'get', '--id', 'd1', '--json']);

      expect(mockTrpcClient.agentEval.getDataset.query).toHaveBeenCalledWith({ id: 'd1' });
    });

    it('should get dataset via external API with --external', async () => {
      mockTrpcClient.agentEvalExternal.datasetGet.query.mockResolvedValue({
        id: 'dataset-1',
        metadata: { preset: 'deepsearchqa' },
      });

      const program = createProgram();
      await program.parseAsync([
        'node',
        'test',
        'eval',
        'dataset',
        'get',
        '--id',
        'dataset-1',
        '--external',
        '--json',
      ]);

      expect(mockTrpcClient.agentEvalExternal.datasetGet.query).toHaveBeenCalledWith({
        datasetId: 'dataset-1',
      });
    });

    it('should create a dataset', async () => {
      mockTrpcClient.agentEval.createDataset.mutate.mockResolvedValue({ id: 'd1' });

      const program = createProgram();
      await program.parseAsync([
        'node',
        'test',
        'eval',
        'dataset',
        'create',
        '--benchmark-id',
        'b1',
        '--identifier',
        'ds1',
        '-n',
        'Dataset 1',
        '--json',
      ]);

      expect(mockTrpcClient.agentEval.createDataset.mutate).toHaveBeenCalledWith(
        expect.objectContaining({ benchmarkId: 'b1', identifier: 'ds1', name: 'Dataset 1' }),
      );
    });
  });

  // ============================================
  // TestCase tests
  // ============================================
  describe('testcase', () => {
    it('should list test cases', async () => {
      mockTrpcClient.agentEval.listTestCases.query.mockResolvedValue({ data: [], total: 0 });

      const program = createProgram();
      await program.parseAsync([
        'node',
        'test',
        'eval',
        'testcase',
        'list',
        '--dataset-id',
        'd1',
        '--json',
      ]);

      expect(mockTrpcClient.agentEval.listTestCases.query).toHaveBeenCalledWith(
        expect.objectContaining({ datasetId: 'd1' }),
      );
    });

    it('should create a test case', async () => {
      mockTrpcClient.agentEval.createTestCase.mutate.mockResolvedValue({ id: 'tc1' });

      const program = createProgram();
      await program.parseAsync([
        'node',
        'test',
        'eval',
        'testcase',
        'create',
        '--dataset-id',
        'd1',
        '--input',
        'What is 2+2?',
        '--expected',
        '4',
      ]);

      expect(mockTrpcClient.agentEval.createTestCase.mutate).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.objectContaining({ expected: '4', input: 'What is 2+2?' }),
          datasetId: 'd1',
        }),
      );
    });

    it('should delete a test case', async () => {
      mockTrpcClient.agentEval.deleteTestCase.mutate.mockResolvedValue({ success: true });

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'eval', 'testcase', 'delete', '--id', 'tc1']);

      expect(mockTrpcClient.agentEval.deleteTestCase.mutate).toHaveBeenCalledWith({ id: 'tc1' });
    });

    it('should count test cases via external API', async () => {
      mockTrpcClient.agentEvalExternal.testCasesCount.query.mockResolvedValue({ count: 12 });

      const program = createProgram();
      await program.parseAsync([
        'node',
        'test',
        'eval',
        'testcase',
        'count',
        '--dataset-id',
        'dataset-1',
        '--json',
      ]);

      expect(mockTrpcClient.agentEvalExternal.testCasesCount.query).toHaveBeenCalledWith({
        datasetId: 'dataset-1',
      });
    });
  });

  // ============================================
  // Run tests
  // ============================================
  describe('run', () => {
    it('should list runs', async () => {
      mockTrpcClient.agentEval.listRuns.query.mockResolvedValue({ data: [], total: 0 });

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'eval', 'run', 'list', '--json']);

      expect(mockTrpcClient.agentEval.listRuns.query).toHaveBeenCalled();
    });

    it('should get run via internal API', async () => {
      mockTrpcClient.agentEval.getRunDetails.query.mockResolvedValue({ id: 'r1' });

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'eval', 'run', 'get', '--id', 'r1', '--json']);

      expect(mockTrpcClient.agentEval.getRunDetails.query).toHaveBeenCalledWith({ id: 'r1' });
    });

    it('should get run via external API with --external', async () => {
      mockTrpcClient.agentEvalExternal.runGet.query.mockResolvedValue({
        config: { k: 1 },
        datasetId: 'dataset-1',
        id: 'run-1',
      });

      const program = createProgram();
      await program.parseAsync([
        'node',
        'test',
        'eval',
        'run',
        'get',
        '--id',
        'run-1',
        '--external',
        '--json',
      ]);

      expect(mockTrpcClient.agentEvalExternal.runGet.query).toHaveBeenCalledWith({
        runId: 'run-1',
      });

      const payload = JSON.parse(logSpy.mock.calls[0][0]);
      expect(payload).toEqual({
        data: { config: { k: 1 }, datasetId: 'dataset-1', id: 'run-1' },
        error: null,
        ok: true,
        version: 'v1',
      });
    });

    it('should create a run', async () => {
      mockTrpcClient.agentEval.createRun.mutate.mockResolvedValue({ id: 'r1' });

      const program = createProgram();
      await program.parseAsync([
        'node',
        'test',
        'eval',
        'run',
        'create',
        '--dataset-id',
        'd1',
        '-n',
        'Run 1',
        '--json',
      ]);

      expect(mockTrpcClient.agentEval.createRun.mutate).toHaveBeenCalledWith(
        expect.objectContaining({ datasetId: 'd1', name: 'Run 1' }),
      );
    });

    it('should start a run', async () => {
      mockTrpcClient.agentEval.startRun.mutate.mockResolvedValue({ success: true, runId: 'r1' });

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'eval', 'run', 'start', '--id', 'r1']);

      expect(mockTrpcClient.agentEval.startRun.mutate).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'r1' }),
      );
    });

    it('should abort a run', async () => {
      mockTrpcClient.agentEval.abortRun.mutate.mockResolvedValue({ success: true });

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'eval', 'run', 'abort', '--id', 'r1']);

      expect(mockTrpcClient.agentEval.abortRun.mutate).toHaveBeenCalledWith({ id: 'r1' });
    });

    it('should get run progress', async () => {
      mockTrpcClient.agentEval.getRunProgress.query.mockResolvedValue({ status: 'running' });

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'eval', 'run', 'progress', '--id', 'r1', '--json']);

      expect(mockTrpcClient.agentEval.getRunProgress.query).toHaveBeenCalledWith({ id: 'r1' });
    });

    it('should get run results', async () => {
      mockTrpcClient.agentEval.getRunResults.query.mockResolvedValue({
        results: [],
        runId: 'r1',
        total: 0,
      });

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'eval', 'run', 'results', '--id', 'r1', '--json']);

      expect(mockTrpcClient.agentEval.getRunResults.query).toHaveBeenCalledWith({ id: 'r1' });
    });

    it('should delete a run', async () => {
      mockTrpcClient.agentEval.deleteRun.mutate.mockResolvedValue({ success: true });

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'eval', 'run', 'delete', '--id', 'r1']);

      expect(mockTrpcClient.agentEval.deleteRun.mutate).toHaveBeenCalledWith({ id: 'r1' });
    });

    it('should set run status via external API', async () => {
      mockTrpcClient.agentEvalExternal.runSetStatus.mutate.mockResolvedValue({
        runId: 'run-1',
        status: 'completed',
        success: true,
      });

      const program = createProgram();
      await program.parseAsync([
        'node',
        'test',
        'eval',
        'run',
        'set-status',
        '--id',
        'run-1',
        '--status',
        'completed',
      ]);

      expect(mockTrpcClient.agentEvalExternal.runSetStatus.mutate).toHaveBeenCalledWith({
        runId: 'run-1',
        status: 'completed',
      });
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('status updated to'));
    });
  });

  // ============================================
  // Run-Topic tests (external eval API)
  // ============================================
  describe('run-topic', () => {
    it('should list run topics', async () => {
      mockTrpcClient.agentEvalExternal.runTopicsList.query.mockResolvedValue([]);

      const program = createProgram();
      await program.parseAsync([
        'node',
        'test',
        'eval',
        'run-topic',
        'list',
        '--run-id',
        'run-1',
        '--only-external',
        '--json',
      ]);

      expect(mockTrpcClient.agentEvalExternal.runTopicsList.query).toHaveBeenCalledWith({
        onlyExternal: true,
        runId: 'run-1',
      });
    });

    it('should report run-topic result', async () => {
      mockTrpcClient.agentEvalExternal.runTopicReportResult.mutate.mockResolvedValue({
        success: true,
      });

      const program = createProgram();
      await program.parseAsync([
        'node',
        'test',
        'eval',
        'run-topic',
        'report-result',
        '--run-id',
        'run-1',
        '--topic-id',
        'topic-1',
        '--thread-id',
        'thread-1',
        '--score',
        '0.91',
        '--correct',
        'true',
        '--result-json',
        '{"grade":"A"}',
        '--json',
      ]);

      expect(mockTrpcClient.agentEvalExternal.runTopicReportResult.mutate).toHaveBeenCalledWith({
        correct: true,
        result: { grade: 'A' },
        runId: 'run-1',
        score: 0.91,
        threadId: 'thread-1',
        topicId: 'topic-1',
      });
    });
  });

  // ============================================
  // Eval thread/message tests (external eval API)
  // ============================================
  describe('eval thread', () => {
    it('should list threads by topic', async () => {
      mockTrpcClient.agentEvalExternal.threadsList.query.mockResolvedValue([]);

      const program = createProgram();
      await program.parseAsync([
        'node',
        'test',
        'eval',
        'thread',
        'list',
        '--topic-id',
        'topic-1',
        '--json',
      ]);

      expect(mockTrpcClient.agentEvalExternal.threadsList.query).toHaveBeenCalledWith({
        topicId: 'topic-1',
      });
    });
  });

  describe('eval message', () => {
    it('should list messages by topic and thread', async () => {
      mockTrpcClient.agentEvalExternal.messagesList.query.mockResolvedValue([]);

      const program = createProgram();
      await program.parseAsync([
        'node',
        'test',
        'eval',
        'message',
        'list',
        '--topic-id',
        'topic-1',
        '--thread-id',
        'thread-1',
        '--json',
      ]);

      expect(mockTrpcClient.agentEvalExternal.messagesList.query).toHaveBeenCalledWith({
        threadId: 'thread-1',
        topicId: 'topic-1',
      });
    });
  });

  // ============================================
  // Error handling
  // ============================================
  describe('error handling', () => {
    it('should output json error envelope when command fails', async () => {
      const error = Object.assign(new Error('Run not found'), {
        data: { code: 'NOT_FOUND' },
      });
      mockTrpcClient.agentEval.getRunDetails.query.mockRejectedValue(error);

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'eval', 'run', 'get', '--id', 'run-404', '--json']);

      const payload = JSON.parse(logSpy.mock.calls[0][0]);
      expect(payload).toEqual({
        data: null,
        error: { code: 'NOT_FOUND', message: 'Run not found' },
        ok: false,
        version: 'v1',
      });
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it('should log plain error without --json', async () => {
      mockTrpcClient.agentEvalExternal.threadsList.query.mockRejectedValue(new Error('boom'));

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'eval', 'thread', 'list', '--topic-id', 'topic-1']);

      expect(log.error).toHaveBeenCalledWith('boom');
      expect(exitSpy).toHaveBeenCalledWith(1);
    });
  });
});
