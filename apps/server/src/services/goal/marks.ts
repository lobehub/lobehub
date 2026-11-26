import type { TaskRunPromptGoalMarks } from '@lobechat/prompts';
import type { GoalGraphSnapshot, GoalMarkKind } from '@lobechat/types';
import { isMarkKind } from '@lobechat/utils/goalGraph';

import { GoalGraphModel } from '@/database/models/goalGraph';
import { GoalMarkModel, type GoalMarkRunNode } from '@/database/models/goalMark';
import type { LobeChatDatabase } from '@/database/type';

/** A mark as its readers see it: the node plus the runs that judged it. */
export interface GoalMarkView {
  confidence: number;
  confirms: number;
  createdAt: Date;
  createdByAgentId: string | null;
  description: string | null;
  id: string;
  kind: GoalMarkKind;
  refutes: number;
  status: string;
  title: string;
}

/** How many marks a run's prompt lists before pointing at `lh goal mark list`. */
export const MARKS_IN_PROMPT = 12;

/**
 * Below this a mark has been refuted more than it held, and it leaves the
 * prompt. It stays on the graph and in `lh goal mark list`: a refutation can
 * itself be wrong, and the next run that finds the mark holds can confirm it.
 */
export const MARK_TRUST_FLOOR = 0.3;

export const MARK_TITLE_MAX = 200;
export const MARK_DESCRIPTION_MAX = 4000;

/**
 * Laplace-smoothed share of runs the mark held for: an unjudged mark is 0.5,
 * each confirmation pulls it toward 1 and each refutation toward 0, and no
 * count of either ever pins it.
 */
export const markConfidence = (confirms: number, refutes: number) =>
  (1 + confirms) / (2 + confirms + refutes);

/** Every mark in the graph with its judgements, newest first. */
export const goalMarks = (graph: Pick<GoalGraphSnapshot, 'edges' | 'nodes'>): GoalMarkView[] => {
  const judged = (id: string, kind: 'confirms' | 'refutes') =>
    graph.edges.filter((edge) => edge.targetNodeId === id && edge.kind === kind).length;
  return graph.nodes
    .filter((node) => isMarkKind(node.kind))
    .map((node) => {
      const confirms = judged(node.id, 'confirms');
      const refutes = judged(node.id, 'refutes');
      return {
        confidence: markConfidence(confirms, refutes),
        confirms,
        createdAt: new Date(node.createdAt),
        createdByAgentId: node.createdByAgentId ?? null,
        description: node.description ?? null,
        id: node.id,
        kind: node.kind as GoalMarkKind,
        refutes,
        status: node.status,
        title: node.title,
      };
    })
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
};

/**
 * The marks a run is handed: not retired or rejected, trusted at least
 * {@link MARK_TRUST_FLOOR}. Hazards lead — they say what not to do — then the
 * most trusted, newest first among equals.
 */
export const activeMarks = (graph: Pick<GoalGraphSnapshot, 'edges' | 'nodes'>) =>
  goalMarks(graph)
    .filter(
      (mark) =>
        mark.status !== 'retired' &&
        mark.status !== 'rejected' &&
        mark.confidence >= MARK_TRUST_FLOOR,
    )
    .sort(
      (a, b) =>
        Number(b.kind === 'hazard') - Number(a.kind === 'hazard') ||
        b.confidence - a.confidence ||
        b.createdAt.getTime() - a.createdAt.getTime(),
    );

/** The `goalMarks` input of a Task run's prompt. */
export const marksForPrompt = (
  graph: Pick<GoalGraphSnapshot, 'edges' | 'nodes'>,
): TaskRunPromptGoalMarks => {
  const marks = activeMarks(graph);
  return {
    marks: marks.slice(0, MARKS_IN_PROMPT).map((mark) => ({
      confidence: mark.confidence,
      confirms: mark.confirms,
      description: mark.description,
      id: mark.id,
      kind: mark.kind,
      refutes: mark.refutes,
      title: mark.title,
    })),
    omitted: Math.max(0, marks.length - MARKS_IN_PROMPT) || undefined,
  };
};

export class GoalMarkError extends Error {
  constructor(
    message: string,
    readonly code: 'BAD_REQUEST' | 'NOT_FOUND',
  ) {
    super(message);
    this.name = 'GoalMarkError';
  }
}

export interface AddGoalMarkInput {
  description?: string;
  kind: GoalMarkKind;
  title: string;
}

/** Who leaves or judges a mark: a run's Task node, or a person when absent. */
export interface GoalMarkAuthor {
  agentId?: string;
  /** The Task node of the run; the mark hangs off it with a `produces` edge. */
  nodeId?: string;
}

/**
 * Leave, list, judge and retire the marks of a Goal.
 *
 * Writes go through `GoalGraphModel` so every mark and judgement lands on the
 * Goal's audit trail like any other graph edit.
 */
export class GoalMarkService {
  private readonly markModel: GoalMarkModel;

  constructor(
    private readonly db: LobeChatDatabase,
    private readonly userId: string,
    private readonly workspaceId?: string,
  ) {
    this.markModel = new GoalMarkModel(db, userId, workspaceId);
  }

  private graphModel = (agentId?: string) =>
    new GoalGraphModel(
      this.db,
      this.userId,
      this.workspaceId,
      agentId ? { id: agentId, type: 'agent' } : undefined,
    );

  private requireGraph = async (goalId: string) => {
    const graph = await this.graphModel().getGraph(goalId);
    if (!graph) throw new GoalMarkError('Goal not found', 'NOT_FOUND');
    return graph;
  };

  private requireMark = (graph: GoalGraphSnapshot, markId: string) => {
    const mark = graph.nodes.find((node) => node.id === markId);
    if (!mark || !isMarkKind(mark.kind))
      throw new GoalMarkError(`No mark ${markId} in this Goal`, 'NOT_FOUND');
    return mark;
  };

  /** The Goal Task node a run works for; undefined when it works for none. */
  runNode = (operationId: string): Promise<GoalMarkRunNode | undefined> =>
    this.markModel.findRunNode(operationId);

  list = async (goalId: string) => goalMarks(await this.requireGraph(goalId));

  add = async (goalId: string, input: AddGoalMarkInput, author: GoalMarkAuthor = {}) => {
    const title = input.title.replaceAll(/\s+/g, ' ').trim();
    if (!title) throw new GoalMarkError('A mark needs a title', 'BAD_REQUEST');
    if (!isMarkKind(input.kind))
      throw new GoalMarkError(`Unknown mark kind "${input.kind}"`, 'BAD_REQUEST');
    await this.requireGraph(goalId);
    const graph = this.graphModel(author.agentId);
    const node = await graph.createNode(goalId, {
      confidence: markConfidence(0, 0),
      createdByAgentId: author.agentId,
      description: input.description?.trim().slice(0, MARK_DESCRIPTION_MAX) || undefined,
      kind: input.kind,
      status: 'active',
      title: title.slice(0, MARK_TITLE_MAX),
    });
    if (!node) throw new GoalMarkError('Goal not found', 'NOT_FOUND');
    if (author.nodeId) await graph.createEdge(goalId, author.nodeId, node.id, 'produces');
    return node;
  };

  /**
   * Record that the run on `author.nodeId` relied on a mark and it held
   * (`confirms`) or did not (`refutes`). A run judges a mark once per verdict;
   * repeating it is a no-op. Returns the mark's new standing.
   */
  judge = async (
    goalId: string,
    markId: string,
    verdict: 'confirms' | 'refutes',
    author: Required<Pick<GoalMarkAuthor, 'nodeId'>> & GoalMarkAuthor,
  ) => {
    const graph = await this.requireGraph(goalId);
    this.requireMark(graph, markId);
    if (author.nodeId === markId)
      throw new GoalMarkError('A mark cannot judge itself', 'BAD_REQUEST');
    const exists = graph.edges.some(
      (edge) =>
        edge.sourceNodeId === author.nodeId &&
        edge.targetNodeId === markId &&
        edge.kind === verdict,
    );
    if (!exists)
      await this.graphModel(author.agentId).createEdge(goalId, author.nodeId, markId, verdict);
    const view = goalMarks(await this.requireGraph(goalId)).find((mark) => mark.id === markId)!;
    await this.markModel.setConfidence(goalId, markId, view.confidence);
    return view;
  };

  /** Take a mark out of every later run's prompt. A person's call; it stays on the graph. */
  retire = async (goalId: string, markId: string, reason?: string) => {
    this.requireMark(await this.requireGraph(goalId), markId);
    await this.graphModel().updateNodeStatus(goalId, markId, 'retired', reason);
  };
}
