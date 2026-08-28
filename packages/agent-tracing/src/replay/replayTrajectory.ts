import type { ExecutionSnapshot } from '../types';
import type { ModelTarget } from './payload';
import {
  judgeReplay,
  type ReplayAttempt,
  type ReplayConnection,
  replayFrozenCall,
} from './replayFrozenCall';
import {
  buildToolMessages,
  type ChainTurn,
  findChainAnchor,
  listFrozenCalls,
  recordedAssistantTurn,
  recordedOutcome,
  recordedToolResults,
  toolSignature,
} from './trajectory';

export type DivergencePolicy = 'continue' | 'stop';

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
  /** Tool calls with no recorded result to feed back (chain mode only). */
  unmatchedTools?: string[];
}

export interface TrajectoryResult {
  divergedAtNode?: number;
  /** How the payload for each node was built. */
  mode: 'anchored' | 'chain';
  nodes: TrajectoryNode[];
  /** Semantic comparison of the final output against the recorded one. */
  reproduction?: { passed: boolean; reason?: string; score: number };
  totalNodes: number;
}

export interface ReplayTrajectoryParams {
  connection: ReplayConnection;
  maxTokens?: number;
  /**
   * chain: feed each node's replayed output into the next one.
   * anchored: replay every node against its own recorded payload, so a
   * divergence at one node cannot contaminate the ones after it.
   */
  mode: 'anchored' | 'chain';
  onDivergence?: DivergencePolicy;
  /** Called after each node so a CLI can stream progress. */
  onNode?: (node: TrajectoryNode) => void;
  reproductionJudge?: { judgeModel: ModelTarget };
  snapshot: ExecutionSnapshot;
  target: ModelTarget;
  temperature?: number;
  withTools?: boolean;
}

const REPRODUCTION_CRITERIA = [
  'The [Output] is a replay of a recorded agent turn and is compared against the',
  'recorded original in [Expected]. Score 1.0 when it reaches a materially',
  'equivalent conclusion — same decision, same substantive claims, same answer to',
  'the user — allowing for differences in wording, ordering, formatting and',
  'verbosity. Score 0.0 when it reaches a different conclusion, omits something',
  'the original established, or asserts something the original did not.',
].join(' ');

/**
 * Replay every `call_llm` node of a recorded operation.
 *
 * Chain mode is bounded by what a trace can give back: tool output cannot be
 * regenerated, only reused from the recording, so the moment the model calls a
 * tool the original run did not, the trajectory has no ground truth to continue
 * on. That point is the finding, which is why it is reported rather than
 * papered over.
 */
export const replayTrajectory = async ({
  connection,
  maxTokens,
  mode,
  onDivergence = 'stop',
  onNode,
  reproductionJudge,
  snapshot,
  target,
  temperature,
  withTools = true,
}: ReplayTrajectoryParams): Promise<TrajectoryResult> => {
  const calls = listFrozenCalls(snapshot);
  const nodes: TrajectoryNode[] = [];

  // Recorded assistant turns, used to locate the model-produced tail inside a
  // later payload; accumulated replayed turns take their place.
  const recordedAssistants: ChainTurn[] = [];
  const replayedTurns: ChainTurn[] = [];

  let divergedAtNode: number | undefined;

  for (const [nodeIndex, call] of calls.entries()) {
    let messages = call.messages;

    if (mode === 'chain' && nodeIndex > 0) {
      const anchor = findChainAnchor(call.messages, recordedAssistants);
      if (!anchor) {
        break;
      }
      messages = [
        ...call.messages.slice(0, anchor.index),
        ...replayedTurns.slice(anchor.nodeOffset),
      ];
    }

    const attempt = await replayFrozenCall({
      call: { ...call, messages },
      connection,
      maxTokens,
      target,
      temperature,
      withTools,
    });

    const recorded = recordedOutcome(snapshot, call.stepIndex);
    const recordedSignature = toolSignature(recorded.toolCalls);
    const actualSignature = toolSignature(attempt.toolCalls);

    const node: TrajectoryNode = {
      attempt,
      nodeIndex,
      recorded: { content: recorded.content, toolSignature: recordedSignature },
      stepIndex: call.stepIndex,
    };

    if (!attempt.error && actualSignature !== recordedSignature) {
      node.divergence = {
        field: 'toolSignature',
        recorded: recordedSignature,
        replayed: actualSignature,
      };
      divergedAtNode ??= nodeIndex;
    }

    if (mode === 'chain') {
      const assistantTurn = recordedAssistantTurn(snapshot, call.stepIndex);
      if (assistantTurn) recordedAssistants.push(assistantTurn);

      const toolCalls = attempt.toolCalls.map((toolCall, index) => ({
        id: `replay_${nodeIndex}_${index}`,
        name: toolCall.name,
      }));

      replayedTurns.push({
        content: attempt.content,
        role: 'assistant',
        ...(toolCalls.length > 0 && {
          tool_calls: toolCalls.map((toolCall, index) => ({
            function: {
              arguments: attempt.toolCalls[index].arguments ?? '{}',
              name: toolCall.name,
            },
            id: toolCall.id,
            type: 'function',
          })),
        }),
      });

      const { messages: toolMessages, unmatched } = buildToolMessages(
        toolCalls,
        recordedToolResults(snapshot, call.stepIndex),
      );
      replayedTurns.push(...toolMessages);
      if (unmatched.length > 0) node.unmatchedTools = unmatched;
    }

    nodes.push(node);
    onNode?.(node);

    if (attempt.error) break;
    if (mode === 'chain' && node.divergence && onDivergence === 'stop') break;
  }

  const result: TrajectoryResult = { divergedAtNode, mode, nodes, totalNodes: calls.length };

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
