import type { ExecutionSnapshot } from '../types';
import type { ModelTarget } from './payload';
import {
  judgeReplay,
  type ReplayAttempt,
  type ReplayConnection,
  replayFrozenCall,
} from './replayFrozenCall';
import { listFrozenCalls, recordedOutcome, toolSignature } from './trajectory';

/**
 * One field of a node that came out differently from the recording.
 *
 * `field` is what keeps the shape shared with the goal-coordinator layer, which
 * reports its own divergences the same way: a reader decides per field whether
 * it is scored or merely informational. Content, for instance, is expected to
 * differ and is judged rather than failed.
 */
export interface TrajectoryDivergence {
  field: 'toolSignature';
  recorded: string;
  replayed: string;
}

export interface TrajectoryNode {
  attempt: ReplayAttempt;
  /** Present only when the node's tool calls differ from the recorded run. */
  divergence?: TrajectoryDivergence;
  nodeIndex: number;
  recorded: { content: string; toolSignature: string };
  stepIndex: number;
}

export interface TrajectoryResult {
  divergedAtNode?: number;
  nodes: TrajectoryNode[];
  /** Semantic comparison of the final node's output against the recorded one. */
  reproduction?: { passed: boolean; reason?: string; score: number };
  totalNodes: number;
}

export interface ReplayTrajectoryParams {
  /** How many nodes to have in flight at once. */
  concurrency?: number;
  connection: ReplayConnection;
  maxTokens?: number;
  /**
   * Called as each node settles, which under concurrency is not node order —
   * every node carries its own `nodeIndex`, so a caller renders by position
   * rather than by arrival. `nodes` in the result is always ordered.
   */
  onNode?: (node: TrajectoryNode) => void;
  reproductionJudge?: { judgeModel: ModelTarget };
  snapshot: ExecutionSnapshot;
  target: ModelTarget;
  temperature?: number;
  withTools?: boolean;
}

const DEFAULT_CONCURRENCY = 4;

const REPRODUCTION_CRITERIA = [
  'The [Output] is a replay of a recorded agent turn and is compared against the',
  'recorded original in [Expected]. Score 1.0 when it reaches a materially',
  'equivalent conclusion — same decision, same substantive claims, same answer to',
  'the user — allowing for differences in wording, ordering, formatting and',
  'verbosity. Score 0.0 when it reaches a different conclusion, omits something',
  'the original established, or asserts something the original did not.',
].join(' ');

/**
 * Run `tasks` with at most `limit` in flight, resolving to their results in
 * input order.
 */
const mapWithConcurrency = async <T>(
  tasks: Array<() => Promise<T>>,
  limit: number,
): Promise<T[]> => {
  const results = Array.from({ length: tasks.length }) as T[];
  let next = 0;

  const worker = async () => {
    while (next < tasks.length) {
      const index = next++;
      results[index] = await tasks[index]();
    }
  };

  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, () => worker()));

  return results;
};

/**
 * Replay every `call_llm` node of a recorded operation, each against the
 * payload the harness actually built for it.
 *
 * The nodes are independent by construction, and that is the point: node 4 is
 * asked "given exactly this context, do you make the same decision?", so a
 * different answer at node 2 cannot contaminate it. Chaining the nodes instead
 * — feeding each replayed output into the next — was tried and removed: a trace
 * cannot regenerate tool output, only replay what was recorded, so the moment
 * the model deviates there is no ground truth left and the run silently
 * measures nothing.
 *
 * Independence also means the nodes can go out concurrently, and that a node
 * that fails to reach the provider costs only itself.
 */
export const replayTrajectory = async ({
  concurrency = DEFAULT_CONCURRENCY,
  connection,
  maxTokens,
  onNode,
  reproductionJudge,
  snapshot,
  target,
  temperature,
  withTools = true,
}: ReplayTrajectoryParams): Promise<TrajectoryResult> => {
  const calls = listFrozenCalls(snapshot);

  const nodes = await mapWithConcurrency(
    calls.map((call, nodeIndex) => async (): Promise<TrajectoryNode> => {
      const attempt = await replayFrozenCall({
        call,
        connection,
        maxTokens,
        target,
        temperature,
        withTools,
      });

      const recorded = recordedOutcome(snapshot, call.stepIndex);
      const recordedSignature = toolSignature(recorded.toolCalls);

      const node: TrajectoryNode = {
        attempt,
        nodeIndex,
        recorded: { content: recorded.content, toolSignature: recordedSignature },
        stepIndex: call.stepIndex,
      };

      const actualSignature = toolSignature(attempt.toolCalls);
      if (!attempt.error && actualSignature !== recordedSignature) {
        node.divergence = {
          field: 'toolSignature',
          recorded: recordedSignature,
          replayed: actualSignature,
        };
      }

      onNode?.(node);

      return node;
    }),
    Math.max(1, concurrency),
  );

  const result: TrajectoryResult = {
    divergedAtNode: nodes.find((node) => node.divergence)?.nodeIndex,
    nodes,
    totalNodes: calls.length,
  };

  const lastNode = nodes.at(-1);
  if (reproductionJudge && lastNode && !lastNode.attempt.error) {
    result.reproduction = await judgeReplay({
      actual: lastNode.attempt.content,
      connection,
      criteria: REPRODUCTION_CRITERIA,
      expected: lastNode.recorded.content,
      judgeModel: reproductionJudge.judgeModel,
    });
  }

  return result;
};
