import { type GoalTrajectory, loadGoalTrajectory } from '@lobechat/agent-tracing';
import { TRPCClientError } from '@trpc/client';

import { getTrpcClient } from '../../../api/client';
import { log } from '../../../utils/logger';

/**
 * Resolve the trajectory a `lh trace goal` subcommand was pointed at, or exit
 * with a message that says what to do about it.
 *
 * Unlike an operation snapshot there is no `TRACING_BASE_URL` fallback: a goal
 * trajectory's key lives on `goal_traces` and cannot be derived from the goal
 * id, so the server is the only way in. That is a feature — inspecting a
 * production goal needs a LobeHub login and nothing else.
 */
export const resolveTrajectoryOrExit = async (target: string): Promise<GoalTrajectory> => {
  // Why the server declined, kept so the final message can say "no trajectory
  // recorded" rather than "not found locally".
  let serverReason: string | undefined;

  const resolveDownloadUrl = async (goalId: string): Promise<string | null> => {
    const client = await getTrpcClient();

    try {
      const { data } = await client.agentTrace.getGoalTrajectoryUrl.query({ goalId });
      return data.url;
    } catch (error) {
      // NOT_FOUND means the goal is absent, outside the caller's scope, or
      // recorded nothing — all "nothing to download". Anything else (auth,
      // network, a signing failure) is real and must not be swallowed.
      if (error instanceof TRPCClientError && error.data?.code === 'NOT_FOUND') {
        serverReason = error.message;
        return null;
      }
      throw error;
    }
  };

  try {
    const trajectory = await loadGoalTrajectory(target, {
      allowDownload: true,
      resolveDownloadUrl,
    });
    if (trajectory) return trajectory;

    log.error(
      serverReason ??
        `No trajectory found for "${target}". Run \`lh trace goal list\` to see which goals have one.`,
    );
  } catch (error) {
    log.error(error instanceof Error ? error.message : String(error));
  }
  process.exit(1);
};
