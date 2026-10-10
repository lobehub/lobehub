import { Buffer } from 'node:buffer';

import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as FormatModule from '../utils/format';
import { confirm } from '../utils/format';
import { log } from '../utils/logger';
import { registerGoalCommand } from './goal';

const { mockClient } = vi.hoisted(() => ({
  mockClient: {
    goal: {
      wake: { mutate: vi.fn() },
      bindTopic: { mutate: vi.fn() },
      bindOperationTopic: { mutate: vi.fn() },
      create: { mutate: vi.fn() },
      delete: { mutate: vi.fn() },
      events: { query: vi.fn() },
      eventsOperation: { query: vi.fn() },
      graphOperation: { query: vi.fn() },
      planContext: { query: vi.fn() },
      planContextOperation: { query: vi.fn() },
      submitPlan: { mutate: vi.fn() },
      submitOperationPlan: { mutate: vi.fn() },
      submitOperationReport: { mutate: vi.fn() },
      submitReport: { mutate: vi.fn() },
      graph: { query: vi.fn() },
      resume: { mutate: vi.fn() },
      retireNodes: { mutate: vi.fn() },
      setBudget: { mutate: vi.fn() },
      supervision: { query: vi.fn() },
      tick: { mutate: vi.fn() },
    },
  },
}));

vi.mock('node:fs/promises', () => ({
  readFile: async () => JSON.stringify({ action: 'verify', reason: 'Ready' }),
}));

vi.mock('../utils/format', async (importOriginal) => ({
  ...(await importOriginal<typeof FormatModule>()),
  confirm: vi.fn(),
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

describe('goal plan authentication', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.mocked(console.log).mockRestore();
  });

  it.each(['hetero-operation', 'cli-sandbox', undefined])(
    'routes %s credentials to the appropriate plan endpoint',
    async (purpose) => {
      vi.clearAllMocks();
      vi.stubEnv(
        'LOBEHUB_JWT',
        purpose
          ? `header.${Buffer.from(JSON.stringify({ purpose })).toString('base64url')}.signature`
          : undefined,
      );
      vi.spyOn(console, 'log').mockImplementation(() => {});
      mockClient.goal.submitPlan.mutate.mockResolvedValue({ data: {} });
      mockClient.goal.submitOperationPlan.mutate.mockResolvedValue({ data: {} });
      await createProgram().parseAsync([
        'node',
        'test',
        'goal',
        'plan',
        'goal-1',
        '--file',
        'plan.json',
        '--token',
        'turn-1',
        '--operation',
        'op-1',
      ]);
      const selected =
        purpose === 'hetero-operation'
          ? mockClient.goal.submitOperationPlan
          : mockClient.goal.submitPlan;
      const other =
        purpose === 'hetero-operation'
          ? mockClient.goal.submitPlan
          : mockClient.goal.submitOperationPlan;
      expect(selected.mutate).toHaveBeenCalledWith({
        id: 'goal-1',
        operationId: 'op-1',
        token: 'turn-1',
        plan: { action: 'verify', reason: 'Ready' },
      });
      expect(other.mutate).not.toHaveBeenCalled();
    },
  );
});

describe('goal report authentication', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.mocked(console.log).mockRestore();
  });

  it.each(['hetero-operation', undefined])(
    'routes %s credentials to the appropriate report endpoint',
    async (purpose) => {
      vi.clearAllMocks();
      vi.stubEnv(
        'LOBEHUB_JWT',
        purpose
          ? `header.${Buffer.from(JSON.stringify({ purpose })).toString('base64url')}.signature`
          : undefined,
      );
      vi.stubEnv('LOBEHUB_OPERATION_ID', 'op-wrapup');
      vi.spyOn(console, 'log').mockImplementation(() => {});
      mockClient.goal.submitReport.mutate.mockResolvedValue({ data: {} });
      mockClient.goal.submitOperationReport.mutate.mockResolvedValue({ data: {} });
      await createProgram().parseAsync([
        'node',
        'test',
        'goal',
        'report',
        'goal-1',
        '--metadata-file',
        'report.json',
        '--content-file',
        'report.md',
      ]);
      const [selected, other] =
        purpose === 'hetero-operation'
          ? [mockClient.goal.submitOperationReport, mockClient.goal.submitReport]
          : [mockClient.goal.submitReport, mockClient.goal.submitOperationReport];
      // The mocked readFile returns the same text for both files.
      expect(selected.mutate).toHaveBeenCalledWith({
        id: 'goal-1',
        operationId: 'op-wrapup',
        report: {
          content: JSON.stringify({ action: 'verify', reason: 'Ready' }),
          metadata: { action: 'verify', reason: 'Ready' },
        },
      });
      expect(other.mutate).not.toHaveBeenCalled();
    },
  );
});

describe('goal resume', () => {
  it('asks the server to settle the stuck planning turn only with --confirm-exit', async () => {
    vi.clearAllMocks();
    mockClient.goal.resume.mutate.mockResolvedValue({ message: 'Goal resumed' });
    await createProgram().parseAsync(['node', 'test', 'goal', 'resume', 'goal-1']);
    expect(mockClient.goal.resume.mutate).toHaveBeenLastCalledWith({ id: 'goal-1' });

    await createProgram().parseAsync([
      'node',
      'test',
      'goal',
      'resume',
      'goal-1',
      '--confirm-exit',
    ]);
    expect(mockClient.goal.resume.mutate).toHaveBeenLastCalledWith({
      confirmExit: true,
      id: 'goal-1',
    });
  });
});

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
  afterEach(() => vi.unstubAllEnvs());

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  it.each([undefined, 'task-worker'])(
    'inherits the calling Agent with Task assignee %s',
    async (worker) => {
      vi.stubEnv('LOBEHUB_AGENT_ID', 'creating-agent');
      mockClient.goal.create.mutate.mockResolvedValue({ data: { goal: { id: 'goal-1' } } });
      await createProgram().parseAsync([
        'node',
        'test',
        'goal',
        'create',
        'Creator goal',
        '--json',
        ...(worker ? ['--agent', worker] : []),
        '--max-manager-turns',
        '5',
      ]);
      expect(mockClient.goal.create.mutate).toHaveBeenCalledWith(
        expect.objectContaining({
          agentId: worker ?? 'creating-agent',
          createdByAgentId: 'creating-agent',
          config: expect.objectContaining({ manager: { maxTurns: 5 } }),
        }),
      );
    },
  );

  it('allows a person to select an Agent without inventing Agent authorship', async () => {
    vi.stubEnv('LOBEHUB_AGENT_ID', undefined);
    mockClient.goal.create.mutate.mockResolvedValue({ data: { goal: { id: 'goal-1' } } });
    await createProgram().parseAsync([
      'node',
      'test',
      'goal',
      'create',
      'User goal',
      '--agent',
      'selected-agent',
      '--json',
    ]);
    expect(mockClient.goal.create.mutate).toHaveBeenCalledWith(
      expect.objectContaining({ agentId: 'selected-agent', createdByAgentId: undefined }),
    );
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

  it.each(['--topic', '--conversation'])(
    'creates the goal from the current topic run with %s',
    async (flag) => {
      vi.stubEnv('LOBEHUB_JWT', undefined);
      vi.stubEnv('LOBEHUB_OPERATION_ID', 'op-1');
      vi.stubEnv('LOBEHUB_TOPIC_ID', 'tpc-1');
      vi.stubEnv('LOBEHUB_AGENT_ID', 'agent-1');
      mockClient.goal.create.mutate.mockResolvedValue({ data: { goal: { id: 'goal-1' } } });

      await createProgram().parseAsync([
        'node',
        'test',
        'goal',
        'create',
        'Topic goal',
        flag,
        '--json',
      ]);

      expect(mockClient.goal.create.mutate).toHaveBeenCalledWith(
        expect.objectContaining({
          agentId: 'agent-1',
          conversationOperationId: 'op-1',
          conversationTopicId: 'tpc-1',
        }),
      );
    },
  );

  it('refuses --topic outside an agent topic run', async () => {
    vi.stubEnv('LOBEHUB_OPERATION_ID', undefined);

    await expect(
      createProgram().parseAsync(['node', 'test', 'goal', 'create', 'Topic goal', '--topic']),
    ).rejects.toThrow('--topic must run inside an agent topic');
    expect(mockClient.goal.create.mutate).not.toHaveBeenCalled();
  });

  it('sends task seeds and the per-Task attempt budget with the primary flags', async () => {
    mockClient.goal.create.mutate.mockResolvedValue({
      data: {
        decisions: [],
        edges: [],
        events: [],
        goal: { id: 'goal-1', requirement: null, status: 'planning', title: 'Fix bugs' },
        nodes: [],
        workVersions: [],
      },
    });

    await createProgram().parseAsync([
      'node',
      'test',
      'goal',
      'create',
      'Fix bugs',
      '--task',
      'Inspect',
      'Repair',
      '--max-attempts-per-task',
      '4',
      '--max-supervision-incidents',
      '6',
    ]);

    expect(mockClient.goal.create.mutate).toHaveBeenCalledWith(
      expect.objectContaining({
        config: expect.objectContaining({
          recovery: expect.objectContaining({ maxAttemptsPerTask: 4 }),
          supervision: { enabled: true, maxIncidents: 6 },
        }),
        tasks: ['Inspect', 'Repair'],
      }),
    );
  });

  it('sends supervision even when no incident cap is given', async () => {
    mockClient.goal.create.mutate.mockResolvedValue({
      data: {
        decisions: [],
        edges: [],
        events: [],
        goal: { id: 'goal-1', requirement: null, status: 'planning', title: 'Fix bugs' },
        nodes: [],
        workVersions: [],
      },
    });

    await createProgram().parseAsync(['node', 'test', 'goal', 'create', 'Fix bugs']);

    // An independently distributed CLI can be pointed at a server that predates
    // the creation invariant, so supervision must not depend on the server
    // filling it in — nor on the user remembering to pass an incident cap.
    expect(mockClient.goal.create.mutate).toHaveBeenCalledWith(
      expect.objectContaining({
        config: expect.objectContaining({ supervision: { enabled: true } }),
      }),
    );
  });
});

describe('goal bind-topic command', () => {
  const operationJwt = `header.${Buffer.from(JSON.stringify({ purpose: 'hetero-operation' })).toString('base64url')}.signature`;
  const bound = (turnToken?: string) => ({
    data: { goal: { id: 'goal-1', subjectId: 'tpc-1', subjectType: 'topic' } },
    message: 'Goal bound to topic tpc-1',
    previousSubject: { id: null, type: 'standalone' },
    reassignedTaskIds: [],
    success: true,
    turnToken,
  });
  const output = () =>
    vi
      .mocked(console.log)
      .mock.calls.map(([value]) => String(value))
      .join('\n');

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(log, 'info').mockImplementation(() => {});
    vi.stubEnv('LOBEHUB_OPERATION_ID', 'op-1');
    vi.stubEnv('LOBEHUB_TOPIC_ID', 'tpc-1');
    vi.stubEnv('LOBEHUB_AGENT_ID', 'agent-1');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.mocked(console.log).mockRestore();
  });

  it('names the run, topic and agent on a desktop run signed in as the user', async () => {
    vi.stubEnv('LOBEHUB_JWT', undefined);
    mockClient.goal.bindTopic.mutate.mockResolvedValue(bound());

    await createProgram().parseAsync(['node', 'test', 'goal', 'bind-topic', 'goal-1']);

    expect(mockClient.goal.bindTopic.mutate).toHaveBeenCalledWith({
      agentId: 'agent-1',
      force: undefined,
      goalOnly: undefined,
      id: 'goal-1',
      operationId: 'op-1',
      topicId: 'tpc-1',
    });
    expect(mockClient.goal.bindOperationTopic.mutate).not.toHaveBeenCalled();
    expect(output()).not.toContain('planning turn');
  });

  it('sends only the operation on a device run, never a client-named topic', async () => {
    vi.stubEnv('LOBEHUB_JWT', operationJwt);
    mockClient.goal.bindOperationTopic.mutate.mockResolvedValue(bound('turn-1'));

    await createProgram().parseAsync([
      'node',
      'test',
      'goal',
      'bind-topic',
      'goal-1',
      '--force',
      '--goal-only',
    ]);

    expect(mockClient.goal.bindOperationTopic.mutate).toHaveBeenCalledWith({
      force: true,
      goalOnly: true,
      id: 'goal-1',
      operationId: 'op-1',
    });
    expect(mockClient.goal.bindTopic.mutate).not.toHaveBeenCalled();
    expect(output()).toContain('lh goal plan goal-1 --token turn-1 --file <plan.json>');
    expect(output()).toContain('https://app.lobehub.com/goal/goal-1');
  });

  it('prints the turn token and subject in JSON output', async () => {
    vi.stubEnv('LOBEHUB_JWT', undefined);
    mockClient.goal.bindTopic.mutate.mockResolvedValue(bound('turn-1'));

    await createProgram().parseAsync(['node', 'test', 'goal', 'bind-topic', 'goal-1', '--json']);

    const json = JSON.parse(output());
    expect(json).toMatchObject({
      goal: { subjectId: 'tpc-1', subjectType: 'topic' },
      previousSubject: { type: 'standalone' },
      turnToken: 'turn-1',
      url: 'https://app.lobehub.com/goal/goal-1',
    });
  });

  it('refuses to run outside an agent topic', async () => {
    vi.stubEnv('LOBEHUB_OPERATION_ID', undefined);

    await expect(
      createProgram().parseAsync(['node', 'test', 'goal', 'bind-topic', 'goal-1']),
    ).rejects.toThrow(/LOBEHUB_OPERATION_ID/);
    expect(mockClient.goal.bindTopic.mutate).not.toHaveBeenCalled();
    expect(mockClient.goal.bindOperationTopic.mutate).not.toHaveBeenCalled();
  });
});

describe('goal supervision command', () => {
  it('exposes diagnostic identity and recovery metrics without advancing the Goal', async () => {
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const data = {
      enabled: true,
      state: { topicId: 'supervisor-topic' },
      summary: { effectiveRecoveries: 0 },
    };
    mockClient.goal.supervision.query.mockResolvedValue({ data });
    await createProgram().parseAsync(['node', 'test', 'goal', 'supervision', 'goal-1']);
    expect(mockClient.goal.supervision.query).toHaveBeenCalledWith({ id: 'goal-1' });
    expect(JSON.parse(String(vi.mocked(console.log).mock.calls.at(-1)?.[0]))).toEqual(data);
    expect(mockClient.goal.tick.mutate).not.toHaveBeenCalled();
  });
});

describe('goal set-budget command', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(log, 'info').mockImplementation(() => {});
  });

  it('edits the limits a goal was created with, so it can continue instead of being copied', async () => {
    mockClient.goal.setBudget.mutate.mockResolvedValue({ message: 'Goal budget updated' });

    await createProgram().parseAsync([
      'node',
      'test',
      'goal',
      'set-budget',
      'goal-1',
      '--max-manager-turns',
      '60',
      '--max-concurrent-tasks',
      '1',
      '--max-attempts-per-task',
      '5',
      '--max-steps-per-run',
      'none',
    ]);

    expect(mockClient.goal.setBudget.mutate).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'goal-1',
        maxAttemptsPerTask: 5,
        maxConcurrentTasks: 1,
        maxManagerTurns: 60,
        maxStepsPerRun: null,
      }),
    );
  });
});

describe('goal delete', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(log, 'info').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('deletes the goal without prompting when --yes is passed', async () => {
    mockClient.goal.delete.mutate.mockResolvedValue({ message: 'Goal deleted', success: true });

    await createProgram().parseAsync(['node', 'test', 'goal', 'delete', 'goal-1', '--yes']);

    expect(mockClient.goal.delete.mutate).toHaveBeenCalledWith({ id: 'goal-1' });
    expect(log.info).toHaveBeenCalledWith('Goal deleted');
  });

  it('keeps the goal when the confirmation is declined', async () => {
    vi.mocked(confirm).mockResolvedValue(false);

    await createProgram().parseAsync(['node', 'test', 'goal', 'delete', 'goal-1']);

    expect(confirm).toHaveBeenCalledOnce();
    expect(mockClient.goal.delete.mutate).not.toHaveBeenCalled();
  });
});

describe('goal retire', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(log, 'info').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('retires every listed node in one call', async () => {
    mockClient.goal.retireNodes.mutate.mockResolvedValue({
      message: 'Retired 2 node(s)',
      success: true,
    });

    await createProgram().parseAsync([
      'node',
      'test',
      'goal',
      'retire',
      'goal-1',
      'node-a',
      'node-b',
      '--reason',
      'duplicate branch',
    ]);

    expect(mockClient.goal.retireNodes.mutate).toHaveBeenCalledWith({
      id: 'goal-1',
      nodeIds: ['node-a', 'node-b'],
      reason: 'duplicate branch',
    });
    expect(log.info).toHaveBeenCalledWith('Retired 2 node(s)');
  });
});

describe('goal event delivery', () => {
  afterEach(() => vi.restoreAllMocks());
  it.each([true, false])('reports accepted=%s from the event endpoint', async (accepted) => {
    const output = vi.spyOn(console, 'log').mockImplementation(() => {});
    mockClient.goal.wake.mutate.mockResolvedValue({
      data: { accepted, ...(accepted ? {} : { reason: 'unmatched' }) },
    });
    await createProgram().parseAsync([
      'node',
      'lh',
      'goal',
      'wake',
      'goal-1',
      '--token',
      'turn-1',
      '--event',
      'event-1',
      '--type',
      'external.result',
      '--key',
      'experiment-1',
      '--json',
    ]);
    expect(mockClient.goal.wake.mutate).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'goal-1',
        waitToken: 'turn-1',
        eventId: 'event-1',
        type: 'external.result',
        key: 'experiment-1',
      }),
    );
    expect(output).toHaveBeenCalledWith(expect.stringContaining(`"accepted": ${accepted}`));
  });
});

const eventRow = {
  actorType: 'system',
  createdAt: new Date('2026-10-10T07:26:39.811Z'),
  entityId: 'node-1',
  entityType: 'node',
  eventType: 'activated',
  goalId: 'goal-1',
  id: 'e1',
  reason: 'Recovered an abandoned Task operation and started the next attempt',
};

/** A JWT-shaped string whose payload marks the caller as a device / gateway run. */
const operationJwt = () =>
  `x.${Buffer.from(JSON.stringify({ purpose: 'hetero-operation' })).toString('base64url')}.y`;

const goalStateGraph = {
  decisions: [],
  edges: [],
  events: [],
  goal: {
    agentId: 'agt-1',
    config: {},
    id: 'goal-1',
    requirement: 'Migrate every client data resource to replica',
    status: 'running',
    subjectId: 'tpc-1',
    subjectType: 'topic',
    title: 'Replica migration',
  },
  nodes: [],
  workVersions: [],
};

const goalStateContext = {
  admission: { code: 'stale_input', message: 'Stale planning input; no plan applied', ok: false },
  budget: {
    blocked: false,
    deadline: null,
    maxRounds: 50,
    maxTotalCost: 12,
    runs: 12,
    totalCost: 3.5,
  },
  goal: { agentId: 'agt-1', pausedBy: null, status: 'running' },
  queue: { pendingDecisions: 0, unfinishedTasks: 4 },
  review: { current: 'bbbbbbbbbbbb', recorded: 'bbbbbbbbbbbb' },
  snapshot: { current: 'cccccccccccc', recorded: 'aaaaaaaaaaaa' },
  turn: {
    adopted: false,
    consumed: false,
    dispatchNeverStarted: false,
    failedTurns: 0,
    operationId: 'op-1',
    opStatus: 'running',
    problem: 'Automatic recovery could not start the next attempt',
    problemTaskId: 'task-1',
    retryAfter: null,
    startedAt: '2026-10-09T17:47:59.776Z',
    submitted: null,
    token: 'goal-1_tok',
    turns: 13,
  },
};

describe('goal state command', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    mockClient.goal.graph.query.mockResolvedValue({ data: goalStateGraph });
    mockClient.goal.planContext.query.mockResolvedValue({ data: goalStateContext });
    mockClient.goal.events.query.mockResolvedValue({ data: { events: [], nextCursor: null } });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  const output = () =>
    vi
      .mocked(console.log)
      .mock.calls.map(([value]) => String(value))
      .join('\n');

  it('takes the verdict from the server instead of re-deriving it from the graph', async () => {
    await createProgram().parseAsync(['node', 'test', 'goal', 'state', 'goal-1']);

    expect(mockClient.goal.planContext.query).toHaveBeenCalledWith({ id: 'goal-1' });
    expect(mockClient.goal.graph.query).toHaveBeenCalledWith({ id: 'goal-1' });
  });

  it('renders the planning turn, the moved snapshot and the admission code', async () => {
    await createProgram().parseAsync(['node', 'test', 'goal', 'state', 'goal-1']);
    const text = output();

    expect(text).toContain('Planning turn #13');
    expect(text).toContain('stale_input');
    expect(text).toContain('the graph moved after this turn started');
    expect(text).toContain('moved');
    expect(text).toContain('4 unfinished task(s)');
    // The requirement language is not the CLI's place to invent: the hint must
    // come from the code, and the server's message must survive verbatim.
    expect(text).toContain('Stale planning input; no plan applied');
  });

  it('renders recent events and lets --events 0 turn them off', async () => {
    mockClient.goal.events.query.mockResolvedValue({
      data: { events: [eventRow], nextCursor: null },
    });

    await createProgram().parseAsync(['node', 'test', 'goal', 'state', 'goal-1', '--events', '5']);
    expect(mockClient.goal.events.query).toHaveBeenCalledWith({ id: 'goal-1', limit: 5 });
    expect(output()).toContain('Recovered an abandoned Task operation');

    vi.mocked(console.log).mockClear();
    mockClient.goal.events.query.mockClear();

    await createProgram().parseAsync(['node', 'test', 'goal', 'state', 'goal-1', '--events', '0']);
    expect(mockClient.goal.events.query).not.toHaveBeenCalled();
    expect(output()).not.toContain('Recent events');
  });

  it('reads through the operation endpoints when this is a planning run', async () => {
    vi.stubEnv('LOBEHUB_JWT', operationJwt());
    mockClient.goal.graphOperation.query.mockResolvedValue({ data: goalStateGraph });
    mockClient.goal.planContextOperation.query.mockResolvedValue({ data: goalStateContext });
    mockClient.goal.eventsOperation.query.mockResolvedValue({
      data: { events: [], nextCursor: null },
    });

    await createProgram().parseAsync(['node', 'test', 'goal', 'state', 'goal-1']);

    expect(mockClient.goal.graphOperation.query).toHaveBeenCalledWith({ id: 'goal-1' });
    expect(mockClient.goal.planContextOperation.query).toHaveBeenCalledWith({ id: 'goal-1' });
    // The ordinary routes refuse a hetero-operation token by design, so falling
    // back to them would 401 exactly the run whose refusal this explains.
    expect(mockClient.goal.graph.query).not.toHaveBeenCalled();
    expect(mockClient.goal.planContext.query).not.toHaveBeenCalled();
  });

  it('renders an already-recorded plan as settled, not accepted', async () => {
    mockClient.goal.planContext.query.mockResolvedValue({
      data: { ...goalStateContext, admission: { code: 'duplicate', ok: true } },
    });

    await createProgram().parseAsync(['node', 'test', 'goal', 'state', 'goal-1']);
    const text = output();

    expect(text).toContain('a plan is already recorded for this turn');
    expect(text).not.toContain('would be accepted');
  });
});

describe('goal plan refusal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  const planArgs = ['node', 'test', 'goal', 'plan', 'goal-1', '--token', 'tok', '--file', 'p.json'];
  const output = () =>
    vi
      .mocked(console.log)
      .mock.calls.map(([value]) => String(value))
      .join('\n');

  it('explains the refusal from the server admission before the error propagates', async () => {
    vi.stubEnv('LOBEHUB_OPERATION_ID', 'op-env');
    mockClient.goal.submitPlan.mutate.mockRejectedValue(
      new Error('Stale planning input; no plan applied'),
    );
    mockClient.goal.planContext.query.mockResolvedValue({ data: goalStateContext });

    await expect(createProgram().parseAsync(planArgs)).rejects.toThrow('Stale planning input');

    expect(mockClient.goal.planContext.query).toHaveBeenCalledWith({
      id: 'goal-1',
      operationId: 'op-env',
      // The submitted token travels too: without it the verdict would name the
      // next failing precondition instead of the token mismatch the server threw.
      token: 'tok',
    });
    const text = output();
    expect(text).toContain('Refused (stale_input)');
    expect(text).toContain('snapshot');
    expect(text).toContain('lh goal state goal-1');
  });

  it('never lets a failing diagnostic replace the original error', async () => {
    vi.stubEnv('LOBEHUB_OPERATION_ID', 'op-env');
    mockClient.goal.submitPlan.mutate.mockRejectedValue(
      new Error('Stale planning input; no plan applied'),
    );
    mockClient.goal.planContext.query.mockRejectedValue(new Error('network down'));

    await expect(createProgram().parseAsync(planArgs)).rejects.toThrow('Stale planning input');
    expect(output()).not.toContain('Refused');
  });
});

describe('goal events command', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const output = () =>
    vi
      .mocked(console.log)
      .mock.calls.map(([value]) => String(value))
      .join('\n');

  it('pages the audit trail by cursor and passes every filter through', async () => {
    const cursor = '2026-10-10T08:00:00.000Z|e9';
    mockClient.goal.events.query.mockResolvedValue({
      data: { events: [eventRow], nextCursor: cursor },
    });

    await createProgram().parseAsync([
      'node',
      'test',
      'goal',
      'events',
      'goal-1',
      '--limit',
      '5',
      '--cursor',
      cursor,
      '--entity',
      'node',
      '--type',
      'activated',
      '--json',
    ]);

    expect(mockClient.goal.events.query).toHaveBeenCalledWith({
      id: 'goal-1',
      cursor,
      entityType: 'node',
      eventType: 'activated',
      limit: 5,
    });
    const printed = JSON.parse(String(vi.mocked(console.log).mock.calls.at(-1)?.[0]));
    expect(printed.events).toHaveLength(1);
    expect(printed.events[0].id).toBe('e1');
    expect(printed.nextCursor).toBe(cursor);
  });

  it('prints the continuation cursor so the next page is a copy-paste', async () => {
    const cursor = '2026-10-10T08:00:00.000Z|e9';
    mockClient.goal.events.query.mockResolvedValue({
      data: { events: [eventRow], nextCursor: cursor },
    });

    await createProgram().parseAsync(['node', 'test', 'goal', 'events', 'goal-1', '--limit', '1']);

    expect(output()).toContain(`--cursor "${cursor}"`);
  });
});
