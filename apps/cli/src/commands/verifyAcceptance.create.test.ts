import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getTrpcClient } from '../api/client';
import { registerAcceptanceCommands } from './verifyAcceptance';

vi.mock('../api/client', () => ({ getTrpcClient: vi.fn() }));
vi.mock('../settings', () => ({ resolveServerUrl: () => 'https://self-hosted.example/base/' }));

const acceptanceId = 'd8391b91-60bb-49be-a5b7-f14f0c52876a';
const acceptanceUrl = `https://self-hosted.example/acceptance/${acceptanceId}`;
const requirement = 'Customers can retry a declined payment';
const ensure = vi.fn();
const publishFlow = vi.fn();
const createRun = vi.fn();
const attachRun = vi.fn();
let output: ReturnType<typeof vi.spyOn>;

const run = async (args: string[]) => {
  const program = new Command().exitOverride().configureOutput({ writeErr: () => {} });
  registerAcceptanceCommands(program);
  await program.parseAsync(['node', 'lh', 'acceptance', ...args]);
};
const jsonOutput = () => JSON.parse(String(output.mock.calls.at(-1)?.[0]));

beforeEach(() => {
  vi.clearAllMocks();
  output = vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.mocked(getTrpcClient).mockResolvedValue({
    acceptance: {
      ensure: { mutate: ensure },
      publishFlow: { mutate: publishFlow },
      attachRun: { mutate: attachRun },
    },
    verify: { createRun: { mutate: createRun } },
  } as unknown as Awaited<ReturnType<typeof getTrpcClient>>);
  ensure.mockImplementation(async (input) => ({ ...input, id: acceptanceId, status: 'pending' }));
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('acceptance create', () => {
  it('creates a standalone acceptance without a report, ambient subject, or verification round', async () => {
    vi.stubEnv('LOBEHUB_TOPIC_ID', 'unrelated-topic');
    await run(['create', '--title', 'Checkout recovery', '--requirement', requirement, '--json']);

    const subject = { subjectId: expect.any(String), subjectType: 'standalone' };
    expect(ensure).toHaveBeenCalledExactlyOnceWith({
      ...subject,
      requirement,
      title: 'Checkout recovery',
    });
    expect(ensure.mock.calls[0][0].subjectId).toMatch(/^[\da-f]{8}(-[\da-f]{4}){3}-[\da-f]{12}$/);
    expect(jsonOutput()).toEqual({
      acceptanceId,
      acceptanceUrl,
      requirement,
      status: 'pending',
      subject,
    });
    expect(jsonOutput()).not.toHaveProperty('verifyRunId');
    expect(createRun).not.toHaveBeenCalled();
    expect(attachRun).not.toHaveBeenCalled();

    await run(['create', '--requirement', requirement, '--json']);
    expect(ensure.mock.calls[1][0].subjectId).not.toBe(ensure.mock.calls[0][0].subjectId);
  });

  it.each(['task:task-7', 'topic:topic-2', 'document:doc-4', 'standalone:external-delivery'])(
    'accepts explicit subject %s and returns the server’s preserved requirement and status',
    async (ref) => {
      const [subjectType, subjectId] = ref.split(':');
      ensure.mockResolvedValueOnce({
        id: acceptanceId,
        requirement: 'Original goal',
        status: 'accepted',
        subjectId,
        subjectType,
      });
      await run(['create', '--subject', ref, '--requirement', requirement, '--json']);

      expect(ensure).toHaveBeenCalledWith({ requirement, subjectId, subjectType });
      expect(jsonOutput()).toEqual({
        acceptanceId,
        acceptanceUrl,
        requirement: 'Original goal',
        status: 'accepted',
        subject: { subjectId, subjectType },
      });
    },
  );

  it('prints the acceptance ID, URL and absence of new rounds in human-readable output', async () => {
    await run(['create', '--requirement', requirement]);
    const text = output.mock.calls.map(([line]) => line).join('\n');
    expect(text).toContain(acceptanceId);
    expect(text).toContain(acceptanceUrl);
    expect(text).toContain('No verification round or results created');
  });

  it('supports JSON field selection', async () => {
    await run(['create', '--requirement', requirement, '--json', 'acceptanceId,acceptanceUrl']);
    expect(jsonOutput()).toEqual({ acceptanceId, acceptanceUrl });
  });

  it.each([
    { args: [], error: /required option.*--requirement/ },
    { args: ['--requirement', '  '], error: /--requirement must not be empty/ },
    { args: ['--requirement', requirement, '--title', '  '], error: /--title must not be empty/ },
    ...['', 'task:', 'missing-id', 'unknown:123'].map((subject) => ({
      args: ['--requirement', requirement, '--subject', subject],
      error: /--subject must be one of/,
    })),
  ])('rejects invalid options before contacting the server: $args', async ({ args, error }) => {
    await expect(run(['create', ...args])).rejects.toThrow(error);
    expect(getTrpcClient).not.toHaveBeenCalled();
    expect(ensure).not.toHaveBeenCalled();
  });

  it('propagates creation failures without printing a success or link', async () => {
    ensure.mockRejectedValueOnce(new Error('Subject not found in the current workspace'));
    await expect(
      run(['create', '--subject', 'task:missing', '--requirement', requirement]),
    ).rejects.toThrow('Subject not found');
    expect(output).not.toHaveBeenCalled();
  });

  it('publishes a flow using the returned acceptance ID, not the standalone subject ID', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'acceptance-create-'));
    try {
      await run(['create', '--requirement', requirement, '--json']);
      const created = jsonOutput();
      const nodeId = 'cb7dcb9e-4fd2-46f3-ab41-23f7c59a1727';
      const definition = {
        title: 'Checkout recovery',
        entryNodeId: nodeId,
        nodes: [{ id: nodeId, criterionId: '02f5a139-f15c-4690-82a7-8f5779d35456' }],
        edges: [],
      };
      const file = path.join(dir, 'flow.json');
      await writeFile(file, JSON.stringify({ definition }));
      publishFlow.mockResolvedValueOnce({ flowId: 'flow-1' });
      await run(['flow', 'publish', created.acceptanceId, '--file', file]);
      expect(publishFlow).toHaveBeenCalledExactlyOnceWith({ definition, id: acceptanceId });
      expect(created.subject.subjectId).not.toBe(acceptanceId);
      expect(jsonOutput()).toEqual({ flowId: 'flow-1' });
      expect(createRun).not.toHaveBeenCalled();
    } finally {
      await rm(dir, { force: true, recursive: true });
    }
  });
});
