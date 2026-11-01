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
  totalNodes: number;
  /**
   * Did this model get the job done — the question the whole replay exists to
   * answer. Judged semantically against the recorded outcome, because a
   * different model may reach the same result by a different route, and
   * demanding an identical tool sequence would fail it for succeeding
   * differently.
   */
  verdict?: { passed: boolean; reason?: string; score: number };
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
  snapshot: ExecutionSnapshot;
  target: ModelTarget;
  temperature?: number;
  /** Judge that decides pass / fail. `criteria` overrides the default rubric. */
  verdictJudge?: { criteria?: string; judgeModel: ModelTarget };
  withTools?: boolean;
}

const DEFAULT_CONCURRENCY = 4;

/**
 * Judges the outcome, not the route. A replacement model that solved the same
 * problem by calling different tools has passed; one that answered differently
 * has not.
 */
const DEFAULT_VERDICT_CRITERIA = [
  'The [Output] is another model replaying a recorded agent run and is compared',
  'against what the original run produced in [Expected]. Score 1.0 when it gets',
  'the job done: same decision, same substantive claims, same answer to the user',
  '— allowing for differences in wording, ordering, formatting, verbosity, and',
  'in which tools were used to get there. Score 0.0 when it reaches a different',
  'conclusion, omits something the original established, or asserts something the',
  'original did not.',
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
  snapshot,
  target,
  temperature,
  verdictJudge,
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
  if (!verdictJudge || !lastNode) return result;

  // A final call that never reached the model is a failed run, not an absent
  // verdict — a pass/fail tool that silently returns neither is useless.
  if (lastNode.attempt.error) {
    result.verdict = {
      passed: false,
      reason: `The final call did not reach the model: ${lastNode.attempt.error}`,
      score: 0,
    };
    return result;
  }

  result.verdict = await judgeReplay({
    actual: lastNode.attempt.content,
    connection,
    criteria: verdictJudge.criteria ?? DEFAULT_VERDICT_CRITERIA,
    expected: lastNode.recorded.content,
    judgeModel: verdictJudge.judgeModel,
  });

  return result;
};
