import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { log } from '../utils/logger';
import { registerGoalCommand } from './goal';

const { mockClient } = vi.hoisted(() => ({
  mockClient: {
    goal: {
      create: { mutate: vi.fn() },
      graph: { query: vi.fn() },
      tick: { mutate: vi.fn() },
    },
  },
}));

vi.mock('../api/client', () => ({ getTrpcClient: vi.fn().mockResolvedValue(mockClient) }));
// Building the app URL otherwise resolves a workspace and a server, which needs
// a real login; the link's shape is what this file is asserting, not its host.
vi.mock('./task/url', () => ({
  resolveAppUrlBuilder: vi
    .fn()
    .mockResolvedValue((pathname: string) => `https://app.lobehub.com${pathname}`),
}));
const createProgram = () => {
  const program = new Command();
  program.exitOverride();
  registerGoalCommand(program);
  return program;
};

const waitingResult = {
  goalId: 'goal-1',
  message: 'Task T-1 is running',
  nodeId: 'node-1',
  outcome: 'waiting_external',
  taskId: 'task-1',
};

describe('goal run command', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  it('prints a repeated waiting state only once', async () => {
    mockClient.goal.tick.mutate
      .mockResolvedValueOnce({ data: waitingResult })
      .mockResolvedValueOnce({ data: waitingResult })
      .mockResolvedValueOnce({
        data: { goalId: 'goal-1', message: 'Goal achieved', outcome: 'achieved' },
      });

    await createProgram().parseAsync(['node', 'test', 'goal', 'run', 'goal-1', '--poll-ms', '0']);

    const output = vi
      .mocked(console.log)
      .mock.calls.map(([value]) => String(value))
      .join('\n');
    expect(output.match(/Task T-1 is running/g)).toHaveLength(1);
    expect(output).toContain('Goal achieved');
  });

  it('compresses repeated waiting states in JSON output', async () => {
    mockClient.goal.tick.mutate
      .mockResolvedValueOnce({ data: waitingResult })
      .mockResolvedValueOnce({ data: waitingResult })
      .mockResolvedValueOnce({ data: waitingResult })
      .mockResolvedValueOnce({
        data: { goalId: 'goal-1', message: 'Goal achieved', outcome: 'achieved' },
      });

    await createProgram().parseAsync([
      'node',
      'test',
      'goal',
      'run',
      'goal-1',
      '--poll-ms',
      '10',
      '--json',
    ]);

    const result = JSON.parse(String(vi.mocked(console.log).mock.calls.at(-1)?.[0]));
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ pollCount: 3, waitedMs: 30 });
    expect(result[1]).toMatchObject({ outcome: 'achieved' });
  });
});

describe('goal run resilience', () => {
  let previousExitCode: number | string | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    previousExitCode = process.exitCode;
  });

  afterEach(() => {
    process.exitCode = previousExitCode;
  });

  const achieved = { goalId: 'goal-1', message: 'Goal achieved', outcome: 'achieved' };
  // A tRPC rejection carries its verdict on `error.data.code`; a transport
  // failure (`fetch failed`) has no such envelope at all.
  const trpcError = (code: string) =>
    Object.assign(new Error(`${code} from server`), { data: { code } });

  const run = (...args: string[]) =>
    createProgram().parseAsync(['node', 'test', 'goal', 'run', 'goal-1', ...args]);

  const loggedOutput = () =>
    vi
      .mocked(console.log)
      .mock.calls.map(([value]) => String(value))
      .join('\n');

  it('rides out a transient tick failure instead of ending the run', async () => {
    // A single `fetch failed` used to abort the whole loop and leave the goal
    // stranded mid-flight, which is what forced an external supervisor script.
    mockClient.goal.tick.mutate
      .mockRejectedValueOnce(new Error('fetch failed'))
      .mockResolvedValueOnce({ data: achieved });

    await run('--poll-ms', '0', '--retry-window-ms', '20');

    expect(mockClient.goal.tick.mutate).toHaveBeenCalledTimes(2);
    expect(loggedOutput()).toContain('Goal achieved');
    expect(process.exitCode).toBeUndefined();
  });

  it('does not retry a verdict about the request itself', async () => {
    mockClient.goal.tick.mutate.mockRejectedValue(trpcError('NOT_FOUND'));

    await expect(run('--poll-ms', '0', '--retry-window-ms', '5000')).rejects.toThrow('NOT_FOUND');

    expect(mockClient.goal.tick.mutate).toHaveBeenCalledTimes(1);
  });

  it('gives up once the retry window is spent', async () => {
    mockClient.goal.tick.mutate.mockRejectedValue(new Error('fetch failed'));

    await expect(run('--poll-ms', '0', '--retry-window-ms', '20')).rejects.toThrow('fetch failed');

    expect(mockClient.goal.tick.mutate.mock.calls.length).toBeGreaterThan(1);
  });

  it('spends the tick budget on progress, not on idle polls', async () => {
    // Three unchanged `waiting_external` polls sit between two advancing ticks.
    // The budget of 2 must cover only the advancing pair — counting the polls
    // stopped healthy goals whose Work simply took a while to finish.
    mockClient.goal.tick.mutate
      .mockResolvedValueOnce({ data: waitingResult })
      .mockResolvedValueOnce({ data: waitingResult })
      .mockResolvedValueOnce({ data: waitingResult })
      .mockResolvedValueOnce({ data: waitingResult })
      .mockResolvedValueOnce({ data: achieved });

    await run('--poll-ms', '0', '--max-ticks', '2');

    expect(mockClient.goal.tick.mutate).toHaveBeenCalledTimes(5);
    expect(loggedOutput()).toContain('Goal achieved');
    expect(process.exitCode).toBeUndefined();
  });

  it('reports an unfinished goal with a non-zero exit code', async () => {
    // Each tick advances to a different task, so every one spends budget.
    mockClient.goal.tick.mutate.mockImplementation(async () => ({
      data: { ...waitingResult, taskId: `task-${mockClient.goal.tick.mutate.mock.calls.length}` },
    }));

    await run('--poll-ms', '0', '--max-ticks', '2');

    expect(mockClient.goal.tick.mutate).toHaveBeenCalledTimes(2);
    expect(process.exitCode).toBe(1);
    expect(vi.mocked(log.warn)).toHaveBeenCalledWith(expect.stringContaining('unfinished'));
  });
});

describe('goal show command', () => {
  const node = (kind: string, title: string) => ({
    createdAt: new Date(0),
    id: `${kind}-node-id`,
    kind,
    priority: 0,
    status: 'waiting',
    taskId: kind === 'task' ? 'task_8A1DyvjIc7PL' : null,
    title,
    updatedAt: new Date(0),
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  const render = async () => {
    await createProgram().parseAsync(['node', 'test', 'goal', 'show', 'goal-1']);
    return (
      vi
        .mocked(console.log)
        .mock.calls // `printGraph` calls `console.log()` bare for a blank line; stringifying that
        // would manufacture the very word the assertion below is looking for.
        .map(([value]) => (value === undefined ? '' : String(value)))
        .join('\n')
    );
  };

  it('renders a glyph for every node kind, including task', async () => {
    // The glyph map was keyed on the old `work` kind after the rename, so every
    // task row printed `undefined task` against a real goal. Typing the map
    // proves each kind maps to *a* string; only rendering proves it maps to the
    // right one.
    mockClient.goal.graph.query.mockResolvedValue({
      data: {
        decisions: [],
        edges: [],
        events: [],
        goal: { id: 'goal-1', requirement: null, status: 'review', title: 'Three quotes' },
        nodes: [
          node('problem', 'Collect three quotes'),
          node('task', 'Ask vendor A'),
          node('finding', 'Vendor A quoted 1200'),
          node('decision', 'Retry or retire?'),
        ],
        workVersions: [],
      },
    });

    const output = await render();

    expect(output).toContain('▣ task');
    expect(output).toContain('◇ problem');
    expect(output).toContain('● finding');
    expect(output).toContain('◆ decision');
    expect(output).not.toContain('undefined');
  });

  it("states an incoming edge from the row owner's side, not the source's", async () => {
    // Edges read `source <kind> target`, so listing an INCOMING `depends_on` as
    // `depends_on:<source>` claimed the exact opposite of the graph: it made the
    // framework node look like it depended on the node that depends on IT, so a
    // correct plan read as a reversed one.
    mockClient.goal.graph.query.mockResolvedValue({
      data: {
        decisions: [],
        edges: [
          {
            goalId: 'goal-1',
            id: 'e1',
            kind: 'decomposes',
            sourceNodeId: 'problem-node-id',
            targetNodeId: 'task-node-id',
          },
          {
            goalId: 'goal-1',
            id: 'e2',
            kind: 'depends_on',
            sourceNodeId: 'finding-node-id',
            targetNodeId: 'task-node-id',
          },
        ],
        events: [],
        goal: { id: 'goal-1', requirement: null, status: 'review', title: 'Three quotes' },
        nodes: [
          node('problem', 'Collect three quotes'),
          node('task', 'Build the harness'),
          node('finding', 'Downstream work'),
        ],
        workVersions: [],
      },
    });

    const output = await render();

    expect(output).toContain('RELATIONS');
    // The task is part of the problem, and it BLOCKS the node that depends on it.
    expect(output).toContain('part of problem-');
    expect(output).toContain('blocks finding-');
    expect(output).not.toContain('depends_on');
  });

  it('still shows the responsible task id next to its node', async () => {
    mockClient.goal.graph.query.mockResolvedValue({
      data: {
        decisions: [],
        edges: [],
        events: [],
        goal: { id: 'goal-1', requirement: null, status: 'review', title: 'Three quotes' },
        nodes: [node('task', 'Ask vendor A')],
        workVersions: [],
      },
    });

    expect(await render()).toContain('task_8A1DyvjIc7PL');
  });
});

describe('goal create command', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  it('links to the created goal rather than to /goal/undefined', async () => {
    // `goal.create` returns the whole graph snapshot, so the id lives on its
    // goal. Reading `data.id` printed a link nobody could follow, and the CLI
    // cannot resolve the router's types to catch it.
    mockClient.goal.create.mutate.mockResolvedValue({
      data: {
        decisions: [],
        edges: [],
        events: [],
        goal: { id: 'goal_PrUIwfSnU9TH', requirement: null, status: 'planning', title: 'Fix bugs' },
        nodes: [],
        workVersions: [],
      },
    });

    await createProgram().parseAsync(['node', 'test', 'goal', 'create', 'Fix bugs']);

    const output = vi
      .mocked(console.log)
      .mock.calls.map(([value]) => (value === undefined ? '' : String(value)))
      .join('\n');

    expect(output).toContain('https://app.lobehub.com/goal/goal_PrUIwfSnU9TH');
    expect(output).not.toContain('/goal/undefined');
  });
});
