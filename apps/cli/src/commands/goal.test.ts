import { Command } from 'commander';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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
