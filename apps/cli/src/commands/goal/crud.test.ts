import { createLobeHub, LobeHubAPIError } from '@lobehub/sdk';
import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as FormatModule from '../../utils/format';
import { confirm } from '../../utils/format';
import { log } from '../../utils/logger';
import { registerGoalCommand } from '.';

const { mockSdk, mockTrpc } = vi.hoisted(() => ({
  mockSdk: {
    goals: {
      delete: vi.fn(),
      list: vi.fn(),
      pause: vi.fn(),
      restart: vi.fn(),
      resume: vi.fn(),
    },
  },
  mockTrpc: {
    goal: {
      delete: { mutate: vi.fn() },
      list: { query: vi.fn() },
      pause: { mutate: vi.fn() },
      restart: { mutate: vi.fn() },
      resume: { mutate: vi.fn() },
    },
  },
}));

vi.mock('../../api/sdk', () => ({ getSdkClient: vi.fn().mockResolvedValue(mockSdk) }));

// The SDK's real `paginate`, walking the mocked list method page by page.
const sdkPager = createLobeHub({ apiKey: 'sk-lh-test' });
Object.assign(mockSdk, { paginate: sdkPager.paginate.bind(sdkPager) });
vi.mock('../../api/client', () => ({ getTrpcClient: vi.fn().mockResolvedValue(mockTrpc) }));
vi.mock('../../utils/format', async (importOriginal) => ({
  ...(await importOriginal<typeof FormatModule>()),
  confirm: vi.fn(),
}));
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

const envelope = <T>(data: T) => ({ data: { data, success: true } });

const item = (id: string, overrides: Record<string, unknown> = {}) => ({
  findingCount: 2,
  goal: { id, status: 'active', title: `Goal ${id}` },
  pendingDecisions: 1,
  signedOff: false,
  taskDone: 3,
  taskTotal: 5,
  totalRunCost: 1.5,
  totalRunDuration: 10,
  ...overrides,
});

const page = (goals: unknown[], nextCursor: string | null = null) =>
  envelope({ goals, hasMore: !!nextCursor, nextCursor, total: goals.length });

const output = () =>
  vi
    .mocked(console.log)
    .mock.calls.map(([value]) => String(value))
    .join('\n');

describe('goal commands over the REST SDK', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(log, 'info').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('list', () => {
    it('maps the filters onto GET /goals and keeps the table', async () => {
      mockSdk.goals.list.mockResolvedValue(page([item('goal-1')]));

      await run('list', '--agent', 'agt-1', '--project', 'prj-1', '--status', 'active', 'paused');

      expect(mockSdk.goals.list).toHaveBeenCalledWith(
        expect.objectContaining({
          query: {
            agentId: 'agt-1',
            limit: 50,
            projectId: 'prj-1',
            statuses: 'active,paused',
          },
        }),
      );
      expect(mockTrpc.goal.list.query).not.toHaveBeenCalled();
      const table = output();
      expect(table).toContain('Goal goal-1');
      expect(table).toContain('3/5');
      expect(table).toContain('$1.50');
    });

    it('follows nextCursor until --limit rows are read', async () => {
      mockSdk.goals.list
        .mockResolvedValueOnce(page([item('goal-1')], 'c1'))
        .mockResolvedValueOnce(page([item('goal-2')], 'c2'));

      await run('list', '--limit', '2', '--json');

      expect(mockSdk.goals.list).toHaveBeenCalledTimes(2);
      expect(mockSdk.goals.list.mock.calls[0][0].query).toMatchObject({ limit: 2 });
      expect(mockSdk.goals.list.mock.calls[1][0].query).toMatchObject({ cursor: 'c1', limit: 1 });
      expect(JSON.parse(output()).map((g: any) => g.goal.id)).toEqual(['goal-1', 'goal-2']);
    });

    it('caps each request at the endpoint page size', async () => {
      mockSdk.goals.list.mockResolvedValue(page([]));

      await run('list', '--limit', '250');

      expect(mockSdk.goals.list.mock.calls[0][0].query).toMatchObject({ limit: 100 });
      expect(log.info).toHaveBeenCalledWith('No goals yet.');
    });

    it('--json carries each goal page', async () => {
      const goal = item('goal-1');
      mockSdk.goals.list.mockResolvedValue(page([goal]));

      await run('list', '--json');

      expect(JSON.parse(output())).toEqual([
        { ...goal, url: 'https://app.lobehub.com/goal/goal-1' },
      ]);
    });

    it('keeps --archived on the tRPC list, which can filter archived goals', async () => {
      mockTrpc.goal.list.query.mockResolvedValue({ goals: [] });

      await run('list', '--archived');

      expect(mockTrpc.goal.list.query).toHaveBeenCalledWith(
        expect.objectContaining({ archived: true, limit: 50 }),
      );
      expect(mockSdk.goals.list).not.toHaveBeenCalled();
    });
  });

  it('pause calls POST /goals/{id}/pause', async () => {
    mockSdk.goals.pause.mockResolvedValue(envelope({ id: 'goal-1' }));

    await run('pause', 'goal-1');

    expect(mockSdk.goals.pause).toHaveBeenCalledWith({ path: { id: 'goal-1' } });
    expect(log.info).toHaveBeenCalledWith('Goal paused');
  });

  describe('resume', () => {
    it('calls POST /goals/{id}/resume', async () => {
      mockSdk.goals.resume.mockResolvedValue(envelope({ config: null, id: 'goal-1' }));

      await run('resume', 'goal-1');

      expect(mockSdk.goals.resume).toHaveBeenCalledWith({ path: { id: 'goal-1' } });
      expect(log.info).toHaveBeenCalledWith('Goal resumed');
    });

    it('warns when the main Agent has no turns left', async () => {
      mockSdk.goals.resume.mockResolvedValue(
        envelope({ config: { manager: { maxTurns: 4 }, managerState: { turns: 4 } } }),
      );

      await run('resume', 'goal-1');

      expect(log.info).toHaveBeenCalledWith(
        'Goal resumed, but its main Agent has used all 4 turns and it will pause again. Raise the cap with: lh goal set-budget goal-1 --max-manager-turns <n>',
      );
    });

    it('settles the stuck planning turn through tRPC only with --confirm-exit', async () => {
      mockTrpc.goal.resume.mutate.mockResolvedValue({ message: 'Goal resumed' });

      await run('resume', 'goal-1', '--confirm-exit');

      expect(mockTrpc.goal.resume.mutate).toHaveBeenCalledWith({ confirmExit: true, id: 'goal-1' });
      expect(mockSdk.goals.resume).not.toHaveBeenCalled();
    });
  });

  describe('delete', () => {
    it('deletes the goal without prompting when --yes is passed', async () => {
      mockSdk.goals.delete.mockResolvedValue(envelope({ deleted: true, id: 'goal-1' }));

      await run('delete', 'goal-1', '--yes');

      expect(confirm).not.toHaveBeenCalled();
      expect(mockSdk.goals.delete).toHaveBeenCalledWith({ path: { id: 'goal-1' } });
      expect(log.info).toHaveBeenCalledWith('Goal deleted');
    });

    it('keeps the goal when the confirmation is declined', async () => {
      vi.mocked(confirm).mockResolvedValue(false);

      await run('delete', 'goal-1');

      expect(confirm).toHaveBeenCalledOnce();
      expect(mockSdk.goals.delete).not.toHaveBeenCalled();
    });

    it('surfaces the API error of a goal that does not exist', async () => {
      mockSdk.goals.delete.mockRejectedValue(
        new LobeHubAPIError(404, { code: 'not_found', message: 'Goal not found' }),
      );

      await expect(run('delete', 'goal-x', '--yes')).rejects.toThrow('Goal not found');
    });
  });

  it('restart sends the agent and counts the restarted tasks', async () => {
    mockSdk.goals.restart.mockResolvedValue(
      envelope({ goal: { id: 'goal-1' }, restartedTaskIds: ['t1', 't2'] }),
    );

    await run('restart', 'goal-1', '--agent', 'agt-2');

    expect(mockSdk.goals.restart).toHaveBeenCalledWith({
      body: { agentId: 'agt-2' },
      path: { id: 'goal-1' },
    });
    expect(log.info).toHaveBeenCalledWith(
      'Restarted 2 task(s). Resume ticking with: lh goal run goal-1',
    );
  });
});
