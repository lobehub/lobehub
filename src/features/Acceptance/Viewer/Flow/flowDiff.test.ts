import { describe, expect, it } from 'vitest';

import { diffFlowVersions, type FlowDefinitionSnapshot } from './flowDiff';

const base: FlowDefinitionSnapshot = {
  title: 'Chat',
  entryNodeKey: 'ready',
  nodes: [{ nodeKey: 'ready', title: 'Ready', instruction: 'Open', expected: 'Composer' }],
  edges: [
    {
      edgeKey: 'retry',
      sourceNodeKey: 'ready',
      targetNodeKey: 'ready',
      trigger: 'Retry',
      condition: null,
      required: true,
    },
  ],
};
describe('flow version comparison', () => {
  it('matches stable keys despite order and database identity changes', () => {
    expect(
      diffFlowVersions(base, { ...base, nodes: base.nodes.map((n) => ({ ...n, id: 'new-id' })) }),
    ).toEqual([]);
  });
  it('reports changed expectations and branch conditions without treating a rename as replacement', () => {
    const changes = diffFlowVersions(base, {
      ...base,
      nodes: [{ ...base.nodes[0], title: 'Compose', expected: 'Editable composer' }],
      edges: [{ ...base.edges[0], required: false, condition: 'Offline' }],
    });
    expect(changes.map((c) => [c.kind, c.status])).toEqual([
      ['node', 'modified'],
      ['edge', 'modified'],
    ]);
    expect(changes[0].fields).toContainEqual({
      field: 'expected',
      before: 'Composer',
      after: 'Editable composer',
    });
  });
  it('retains removed definitions and identifies additions and entry changes', () => {
    const changes = diffFlowVersions(base, {
      ...base,
      entryNodeKey: 'done',
      nodes: [{ ...base.nodes[0], nodeKey: 'done' }],
      edges: [],
    });
    expect(changes.map((c) => [c.kind, c.key, c.status])).toEqual([
      ['flow', 'flow', 'modified'],
      ['node', 'ready', 'removed'],
      ['node', 'done', 'added'],
      ['edge', 'retry', 'removed'],
    ]);
    expect(changes[1].fields[0]).toEqual({ field: 'title', before: 'Ready', after: undefined });
  });
});
