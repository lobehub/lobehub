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
  field: 'toolArguments' | 'toolSignature';
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
  /**
   * Set when the replay stopped before covering every node for a reason that is
   * not a divergence — so a caller can never render a truncated run as a
   * complete one. `anchor_lost` means a later recorded payload no longer
   * contained any earlier assistant turn to splice against (context
   * compression drops them), leaving nowhere to attach the replayed tail.
   */
  incomplete?: { nodeIndex: number; reason: 'anchor_lost' };
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

/** `tool(args)` list, for showing which call had no recorded counterpart. */
const argumentSignature = (calls: Array<{ arguments?: string; name: string }>): string =>
  calls.map((call) => `${call.name}(${call.arguments?.trim() ?? ''})`).join(' → ');

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
  let incomplete: TrajectoryResult['incomplete'];

  for (const [nodeIndex, call] of calls.entries()) {
    let messages = call.messages;

    if (mode === 'chain' && nodeIndex > 0) {
      const anchor = findChainAnchor(call.messages, recordedAssistants);
      if (!anchor) {
        // No earlier assistant turn survives in this payload, so there is
        // nothing to splice the replayed tail onto. Record why the run is short
        // rather than exiting as if it had finished.
        incomplete = { nodeIndex, reason: 'anchor_lost' };
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
        arguments: toolCall.arguments,
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

      const recordedResults = recordedToolResults(snapshot, call.stepIndex);
      const { messages: toolMessages, unmatched } = buildToolMessages(toolCalls, recordedResults);
      replayedTurns.push(...toolMessages);

      if (unmatched.length > 0) {
        node.unmatchedTools = unmatched;

        // The tool sequence can match name-for-name while the arguments differ,
        // which `toolSignature` deliberately ignores. That still leaves the node
        // without ground truth to continue on, so it has to register as a
        // divergence rather than letting the chain run on a wrong tool result.
        node.divergence ??= {
          field: 'toolArguments',
          recorded: argumentSignature(recordedResults),
          replayed: argumentSignature(toolCalls),
        };
        divergedAtNode ??= nodeIndex;
      }
    }

    nodes.push(node);
    onNode?.(node);

    if (attempt.error) break;
    if (mode === 'chain' && node.divergence && onDivergence === 'stop') break;
  }

  const result: TrajectoryResult = {
    divergedAtNode,
    mode,
    nodes,
    totalNodes: calls.length,
    ...(incomplete && { incomplete }),
  };

  // Reproduction is a claim about the run as a whole, so a trajectory that lost
  // its anchor part-way has nothing to make that claim about — scoring its last
  // partial node would read as a passing replay.
  const lastNode = nodes.at(-1);
  if (reproductionJudge && !incomplete && lastNode && !lastNode.attempt.error) {
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
