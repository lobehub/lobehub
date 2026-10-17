import { Buffer } from 'node:buffer';

import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as LoggerModule from '../../utils/logger';
import { log } from '../../utils/logger';
import { registerGoalCommand } from '.';

const { files, mockClient } = vi.hoisted(() => ({
  files: { tasks: '' },
  mockClient: {
    goal: {
      addEdge: { mutate: vi.fn() },
      create: { mutate: vi.fn() },
      createConversationGoal: { mutate: vi.fn() },
      graph: { query: vi.fn() },
      list: { query: vi.fn() },
    },
  },
}));

const taskFile = JSON.stringify([
  'Signal',
  { description: 'rules', dependsOn: ['Signal'], title: 'Policy' },
]);
vi.mock('node:fs/promises', () => ({ readFile: async () => files.tasks }));
vi.mock('../../utils/logger', async (importOriginal) => {
  const actual = await importOriginal<typeof LoggerModule>();
  return { log: { ...actual.log, warn: vi.fn() } };
});
vi.mock('../../api/client', () => ({ getTrpcClient: vi.fn().mockResolvedValue(mockClient) }));
vi.mock('../task/url', () => ({
  resolveAppUrlBuilder: vi
    .fn()
    .mockResolvedValue((pathname: string) => `https://app.lobehub.com${pathname}`),
}));

const run = (...args: string[]) => {
  const program = new Command();
  program.exitOverride();
  registerGoalCommand(program);
  return program.parseAsync(['node', 'test', 'goal', ...args]);
};

const output = () =>
  vi
    .mocked(console.log)
    .mock.calls.map(([value]) => (value === undefined ? '' : String(value)))
    .join('\n');

const snapshot = () => ({
  decisions: [],
  edges: [] as unknown[],
  events: [],
  goal: { id: 'goal-1', requirement: null, status: 'draft', title: 'Wake' },
  nodes: [
    { id: 'signal-id', kind: 'task', status: 'proposed', taskId: null, title: 'Signal' },
    { id: 'policy-id', kind: 'task', status: 'proposed', taskId: null, title: 'Policy' },
  ],
  workVersions: [],
});

beforeEach(() => {
  vi.clearAllMocks();
  // An operation token switches reads to their operation twins; these tests use the plain ones.
  vi.stubEnv('LOBEHUB_JWT', undefined);
  vi.spyOn(console, 'log').mockImplementation(() => {});
  files.tasks = taskFile;
});

afterEach(() => vi.unstubAllEnvs());

describe('goal links', () => {
  it('show prints the goal page and puts it in --json', async () => {
    mockClient.goal.graph.query.mockResolvedValue({ data: snapshot() });

    await run('show', 'goal-1');
    expect(output()).toContain('https://app.lobehub.com/goal/goal-1');

    vi.mocked(console.log).mockClear();
    await run('show', 'goal-1', '--json');
    expect(JSON.parse(output())).toMatchObject({ url: 'https://app.lobehub.com/goal/goal-1' });
  });

  it('list --json carries each goal page', async () => {
    mockClient.goal.list.query.mockResolvedValue({ goals: [{ goal: { id: 'goal-1' } }] });

    await run('list', '--json');

    expect(JSON.parse(output())).toEqual([
      { goal: { id: 'goal-1' }, url: 'https://app.lobehub.com/goal/goal-1' },
    ]);
  });
});

describe('goal create --task-file dependsOn', () => {
  const drawn = () => ({
    ...snapshot(),
    edges: [{ kind: 'depends_on', sourceNodeId: 'policy-id', targetNodeId: 'signal-id' }],
  });
  const operationJwt = `x.${Buffer.from(JSON.stringify({ purpose: 'hetero-operation' })).toString('base64url')}.y`;

  it('sends dependsOn with the seeds so the server draws the edges', async () => {
    vi.stubEnv('LOBEHUB_OPERATION_ID', 'op-1');
    mockClient.goal.create.mutate.mockResolvedValue({ data: drawn() });

    await run('create', 'Wake', '--topic', '--task-file', 'tasks.json');

    expect(mockClient.goal.create.mutate).toHaveBeenCalledWith(
      expect.objectContaining({
        tasks: ['Signal', { dependsOn: ['Signal'], description: 'rules', title: 'Policy' }],
      }),
    );
    expect(mockClient.goal.addEdge.mutate).not.toHaveBeenCalled();
    expect(log.warn).not.toHaveBeenCalled();
    // The printed graph shows the edge: Signal blocks Policy.
    expect(output()).toContain('blocks policy-i');
  });

  it('needs no ordinary-route write from a run holding an operation token', async () => {
    // Device and gateway runs may only call operation endpoints; a follow-up
    // `addEdge` would be refused after the draft already exists.
    vi.stubEnv('LOBEHUB_JWT', operationJwt);
    vi.stubEnv('LOBEHUB_OPERATION_ID', 'op-1');
    mockClient.goal.createConversationGoal.mutate.mockResolvedValue({ data: drawn() });

    await run('create', 'Wake', '--topic', '--task-file', 'tasks.json');

    expect(mockClient.goal.createConversationGoal.mutate).toHaveBeenCalledWith(
      expect.objectContaining({
        operationId: 'op-1',
        tasks: ['Signal', { dependsOn: ['Signal'], description: 'rules', title: 'Policy' }],
      }),
    );
    expect(mockClient.goal.addEdge.mutate).not.toHaveBeenCalled();
  });

  it('warns when the server dropped dependsOn', async () => {
    mockClient.goal.create.mutate.mockResolvedValue({ data: snapshot() });

    await run('create', 'Wake', '--task-file', 'tasks.json');

    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('"Policy" depends on "Signal"'));
  });

  it('refuses a dependency cycle before creating anything', async () => {
    files.tasks = JSON.stringify([
      { dependsOn: ['B'], title: 'A' },
      { dependsOn: ['A'], title: 'B' },
    ]);

    await expect(run('create', 'Wake', '--task-file', 'tasks.json')).rejects.toThrow(
      '--task-file: dependsOn forms a cycle: "A" → "B" → "A"',
    );
    expect(mockClient.goal.create.mutate).not.toHaveBeenCalled();
  });
});
