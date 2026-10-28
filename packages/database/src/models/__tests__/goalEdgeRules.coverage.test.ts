// @vitest-environment node
import type { GoalEdgeKind, GoalGraphSnapshot } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { assertContainerEdge } from '../goalEdgeRules';

type Graph = Pick<GoalGraphSnapshot, 'edges' | 'nodes'>;

const graphOf = (
  nodes: [id: string, kind: string][],
  edges: [source: string, target: string, kind: GoalEdgeKind][] = [],
): Graph =>
  ({
    edges: edges.map(([sourceNodeId, targetNodeId, kind], index) => ({
      id: `e${index}`,
      kind,
      sourceNodeId,
      targetNodeId,
    })),
    nodes: nodes.map(([id, kind]) => ({ id, kind, status: 'proposed', title: id })),
  }) as unknown as Graph;

describe('assertContainerEdge', () => {
  it('leaves non-container edge kinds unconstrained', () => {
    const graph = graphOf([]);

    expect(assertContainerEdge(graph, 'missing-a', 'missing-b', 'leads_to')).toBeUndefined();
  });

  it('rejects a missing endpoint or a self edge', () => {
    const graph = graphOf([['exp', 'experiment']]);

    expect(() => assertContainerEdge(graph, 'exp', 'missing', 'contains')).toThrow(
      'Invalid experiment relationship',
    );
    expect(() => assertContainerEdge(graph, 'missing', 'exp', 'contains')).toThrow(
      'Invalid experiment relationship',
    );
    expect(() => assertContainerEdge(graph, 'exp', 'exp', 'contains')).toThrow(
      'Invalid experiment relationship',
    );
  });

  it('only lets a container contain nodes', () => {
    const graph = graphOf([
      ['task-a', 'task'],
      ['task-b', 'task'],
    ]);

    expect(() => assertContainerEdge(graph, 'task-a', 'task-b', 'contains')).toThrow(
      'Only a container can contain nodes or answer a question',
    );
  });

  it('lets a batch contain nodes but never answer a question', () => {
    const graph = graphOf([
      ['batch', 'batch'],
      ['task', 'task'],
      ['problem', 'problem'],
    ]);

    expect(assertContainerEdge(graph, 'batch', 'task', 'contains')).toBeUndefined();
    expect(() => assertContainerEdge(graph, 'batch', 'problem', 'answers')).toThrow(
      'Only an experiment can answer a question',
    );
  });

  it('rejects a question whose answers sit outside the containing experiment', () => {
    // `problem` is answered by `answer-exp`, which `other` owns, so `scope` cannot take it.
    const graph = graphOf(
      [
        ['scope', 'experiment'],
        ['other', 'experiment'],
        ['answer-exp', 'experiment'],
        ['problem', 'problem'],
      ],
      [
        ['other', 'answer-exp', 'contains'],
        ['answer-exp', 'problem', 'answers'],
      ],
    );

    expect(() => assertContainerEdge(graph, 'scope', 'problem', 'contains')).toThrow(
      'A question must share its answer scope',
    );
  });

  it('accepts a question whose answers already sit inside the containing experiment', () => {
    const graph = graphOf(
      [
        ['scope', 'experiment'],
        ['answer-exp', 'experiment'],
        ['problem', 'problem'],
      ],
      [
        ['scope', 'answer-exp', 'contains'],
        ['answer-exp', 'problem', 'answers'],
      ],
    );

    expect(assertContainerEdge(graph, 'scope', 'problem', 'contains')).toBeUndefined();
  });

  it('rejects an answer that must move apart from its question', () => {
    const graph = graphOf(
      [
        ['scope', 'experiment'],
        ['other', 'experiment'],
        ['answer-exp', 'experiment'],
        ['problem', 'problem'],
      ],
      [
        ['other', 'problem', 'contains'],
        ['answer-exp', 'problem', 'answers'],
      ],
    );

    expect(() => assertContainerEdge(graph, 'scope', 'answer-exp', 'contains')).toThrow(
      'An answer must share its question scope',
    );
  });

  it('requires an experiment to answer a problem node', () => {
    const graph = graphOf([
      ['exp', 'experiment'],
      ['task', 'task'],
    ]);

    expect(() => assertContainerEdge(graph, 'exp', 'task', 'answers')).toThrow(
      'An experiment must answer a question',
    );
  });

  it('requires an answer to share its question scope', () => {
    const graph = graphOf(
      [
        ['scope', 'experiment'],
        ['exp', 'experiment'],
        ['problem', 'problem'],
      ],
      [['scope', 'problem', 'contains']],
    );

    expect(() => assertContainerEdge(graph, 'exp', 'problem', 'answers')).toThrow(
      'An answer must share its question scope',
    );
  });

  it('lets an experiment answer only one question', () => {
    const graph = graphOf(
      [
        ['exp', 'experiment'],
        ['problem-a', 'problem'],
        ['problem-b', 'problem'],
      ],
      [
        ['other', 'problem-b', 'leads_to'],
        ['exp', 'problem-a', 'answers'],
      ],
    );

    expect(() => assertContainerEdge(graph, 'exp', 'problem-b', 'answers')).toThrow(
      'An experiment answers one question',
    );
    // Re-asserting the question it already answers is fine.
    expect(assertContainerEdge(graph, 'exp', 'problem-a', 'answers')).toBeUndefined();
  });
});
