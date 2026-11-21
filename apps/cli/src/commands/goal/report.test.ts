import { Buffer } from 'node:buffer';

import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerGoalReportCommand } from './report';

const { mockClient } = vi.hoisted(() => ({
  mockClient: {
    goal: {
      submitOperationReport: { mutate: vi.fn() },
      submitReport: { mutate: vi.fn() },
    },
  },
}));

const files: Record<string, string> = {
  'report.html': '<!doctype html><html><body><h1>Report</h1></body></html>',
  'report.json': JSON.stringify({ headline: 'Done' }),
  'report.md': '# Report',
};

vi.mock('node:fs/promises', () => ({ readFile: async (path: string) => files[path] }));
vi.mock('../../api/client', () => ({ getTrpcClient: vi.fn().mockResolvedValue(mockClient) }));

const run = (...args: string[]) => {
  const program = new Command();
  program.exitOverride();
  registerGoalReportCommand(program.command('goal'));
  return program.parseAsync(['node', 'test', 'goal', 'report', 'goal-1', ...args]);
};

const fileArgs = ['--metadata-file', 'report.json', '--content-file', 'report.md'];

describe('goal report', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.stubEnv('LOBEHUB_OPERATION_ID', 'op-wrapup');
    mockClient.goal.submitReport.mutate.mockResolvedValue({ data: {} });
    mockClient.goal.submitOperationReport.mutate.mockResolvedValue({ data: {} });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.mocked(console.log).mockRestore();
  });

  it.each(['hetero-operation', undefined])(
    'routes %s credentials to the appropriate report endpoint',
    async (purpose) => {
      vi.stubEnv(
        'LOBEHUB_JWT',
        purpose
          ? `header.${Buffer.from(JSON.stringify({ purpose })).toString('base64url')}.signature`
          : undefined,
      );

      await run(...fileArgs);

      const [selected, other] =
        purpose === 'hetero-operation'
          ? [mockClient.goal.submitOperationReport, mockClient.goal.submitReport]
          : [mockClient.goal.submitReport, mockClient.goal.submitOperationReport];
      expect(selected.mutate).toHaveBeenCalledWith({
        id: 'goal-1',
        operationId: 'op-wrapup',
        report: { content: '# Report', metadata: { headline: 'Done' } },
      });
      expect(other.mutate).not.toHaveBeenCalled();
    },
  );

  it('submits the HTML page alongside the markdown report', async () => {
    await run(...fileArgs, '--html-file', 'report.html');

    expect(mockClient.goal.submitReport.mutate).toHaveBeenCalledWith({
      id: 'goal-1',
      operationId: 'op-wrapup',
      report: {
        content: '# Report',
        html: files['report.html'],
        metadata: { headline: 'Done' },
      },
    });
  });
});
