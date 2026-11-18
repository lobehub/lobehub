import type { GoalListItem } from '@lobehub/sdk';
import pc from 'picocolors';

import { getTrpcClient } from '../../api/client';
import { getSdkClient } from '../../api/sdk';
import { confirm, outputJson, printTable, truncate } from '../../utils/format';
import { log } from '../../utils/logger';
import { resolveAppUrlBuilder } from '../task/url';

/** `GET /goals` takes at most this many rows per page. */
const GOAL_PAGE_SIZE = 100;

/**
 * Same default as `DEFAULT_MANAGER_MAX_TURNS` in the server's goal recovery
 * policy; only used to word the resume notice below.
 */
const DEFAULT_MANAGER_MAX_TURNS = 50;

interface ManagerConfig {
  manager?: { maxTurns?: number };
  managerState?: { turns?: number };
}

/**
 * Builds goal page links. Best-effort: a read must not fail over a link, and an
 * operation-token run may be refused the workspace lookup behind it.
 */
export const goalUrlBuilder = async () => {
  try {
    const buildUrl = await resolveAppUrlBuilder(await getTrpcClient());
    return (id: string) => buildUrl(`/goal/${encodeURIComponent(id)}`);
  } catch {
    return () => undefined;
  }
};

interface GoalListOptions {
  agent?: string;
  archived?: boolean;
  json?: boolean | string;
  limit: string;
  project?: string;
  status?: string[];
}

/**
 * `GET /goals` leaves archived goals out and has no switch for them, so
 * `--archived` still reads the tRPC list.
 */
const fetchGoals = async (options: GoalListOptions, limit: number): Promise<GoalListItem[]> => {
  if (options.archived) {
    const result = await (
      await getTrpcClient()
    ).goal.list.query({
      agentId: options.agent,
      archived: true,
      limit,
      projectId: options.project,
      statuses: options.status as any,
    });
    return result.goals as unknown as GoalListItem[];
  }

  const sdk = await getSdkClient();
  const goals: GoalListItem[] = [];
  const pages = sdk.paginate(
    sdk.goals.list,
    {
      query: {
        agentId: options.agent,
        limit: Math.min(GOAL_PAGE_SIZE, limit),
        projectId: options.project,
        statuses: options.status?.join(','),
      },
    },
    { maxItems: limit },
  );
  for await (const goal of pages) goals.push(goal);
  return goals;
};

export const listGoalsAction = async (options: GoalListOptions) => {
  const goals = await fetchGoals(options, Number.parseInt(options.limit, 10));
  if (options.json !== undefined) {
    const goalUrl = await goalUrlBuilder();
    return outputJson(
      goals.map((item) => ({ ...item, url: goalUrl(item.goal.id) })),
      options.json,
    );
  }
  if (goals.length === 0) return log.info('No goals yet.');
  printTable(
    goals.map((item) => [
      item.goal.status,
      truncate(item.goal.title, 44),
      `${item.taskDone}/${item.taskTotal}`,
      String(item.findingCount),
      item.pendingDecisions > 0 ? pc.yellow(String(item.pendingDecisions)) : '-',
      `$${item.totalRunCost.toFixed(2)}`,
      item.goal.id,
    ]),
    ['STATUS', 'TITLE', 'TASKS', 'FINDINGS', 'NEEDS YOU', 'COST', 'GOAL ID'],
  );
};

export const pauseGoalAction = async (id: string) => {
  await (await getSdkClient()).goals.pause({ path: { id } });
  log.info('Goal paused');
};

/**
 * `POST /goals/{id}/resume` cannot settle the planning turn a goal paused on,
 * so `--confirm-exit` stays on the tRPC mutation that can.
 */
export const resumeGoalAction = async (id: string, options: { confirmExit?: boolean }) => {
  if (options.confirmExit) {
    const result = await (await getTrpcClient()).goal.resume.mutate({ confirmExit: true, id });
    log.info(result.message);
    return;
  }

  const { data } = await (await getSdkClient()).goals.resume({ path: { id } });
  const config = data.data.config as ManagerConfig | null;
  const maxTurns = config?.manager?.maxTurns ?? DEFAULT_MANAGER_MAX_TURNS;
  // Resuming does not give the main Agent more turns, so a goal it paused for
  // running out would stop again on the next tick.
  log.info(
    config?.manager && (config.managerState?.turns ?? 0) >= maxTurns
      ? `Goal resumed, but its main Agent has used all ${maxTurns} turns and it will pause again. Raise the cap with: lh goal set-budget ${id} --max-manager-turns <n>`
      : 'Goal resumed',
  );
};

export const deleteGoalAction = async (id: string, options: { yes?: boolean }) => {
  if (!options.yes && !(await confirm(`Delete goal ${id}? This cannot be undone.`))) {
    console.log('Cancelled.');
    return;
  }
  await (await getSdkClient()).goals.delete({ path: { id } });
  log.info('Goal deleted');
};

export const restartGoalAction = async (id: string, options: { agent?: string }) => {
  const { data } = await (
    await getSdkClient()
  ).goals.restart({ body: { agentId: options.agent }, path: { id } });
  log.info(
    `Restarted ${data.data.restartedTaskIds.length} task(s). Resume ticking with: lh goal run ${id}`,
  );
};
