import { describe, expect, it } from 'vitest';

import { buildFlowGraph, type FlowGraphView } from './flowGraph';

function view(id: string, title = id): FlowGraphView {
  return {
    id,
    version: {
      id,
      flowId: id,
      version: 1,
      title,
      entryNodeKey: 'a',
      nodes: [
        {
          id: 'a',
          nodeKey: 'a',
          criterionId: undefined,
          subFlowId: undefined,
          parentNodeId: undefined,
          definition: undefined,
          resourceSnapshot: undefined,
          instruction: '',
          title: 'Input',
          isEntry: true,
          checkItemIds: ['ca'],
          requiredCheckItemIds: ['ca'],
          expected: 'Ready',
          entryRequired: true,
        },
        {
          id: 'b',
          nodeKey: 'b',
          criterionId: undefined,
          subFlowId: undefined,
          parentNodeId: undefined,
          definition: undefined,
          resourceSnapshot: undefined,
          instruction: '',
          isEntry: false,
          title: 'Sent',
          checkItemIds: ['cb'],
          requiredCheckItemIds: ['cb'],
          expected: 'Visible',
          entryRequired: true,
        },
      ],
      edges: [
        {
          id: 'ab',
          edgeKey: 'ab',
          sourceNodeId: 'a',
          targetNodeId: 'b',
          sourceNodeKey: 'a',
          targetNodeKey: 'b',
          trigger: 'Send',
          condition: undefined,
          required: true,
        },
      ],
      runs: [],
    },
  };
}
const build = (views: FlowGraphView[], collapsed = new Set<string>(), focus?: string) =>
  buildFlowGraph(
    views,
    collapsed,
    undefined,
    () => {},
    () => {},
    focus,
  );

describe('grouped acceptance canvas', () => {
  it('stacks independent business flows in one canvas and keeps their nodes inside their groups', () => {
    const graph = build([view('send'), view('switch'), view('profile')]);
    const groups = graph.nodes.filter((node) => !node.parentId);
    expect(groups).toHaveLength(3);
    for (let i = 1; i < groups.length; i++)
      expect(groups[i].position.y).toBeGreaterThan(
        groups[i - 1].position.y + groups[i - 1].height!,
      );
    for (const node of graph.nodes.filter((node) => node.parentId)) {
      const parent = graph.nodes.find((group) => group.id === node.parentId)!;
      expect(node.position.x).toBeGreaterThan(0);
      expect(node.position.x + node.width!).toBeLessThan(parent.width!);
      expect(node.position.y + node.height!).toBeLessThan(parent.height!);
    }
    expect(graph.edges.map((edge) => edge.source)).toEqual(['send/a', 'switch/a', 'profile/a']);
  });
  it('places a merged success state after the retry branch and keeps cycles finite', () => {
    const flow = view('send');
    flow.version.nodes.push({ ...flow.version.nodes[1], id: 'c', nodeKey: 'c' });
    flow.version.edges.push(
      { ...flow.version.edges[0], id: 'ac', targetNodeKey: 'c' },
      { ...flow.version.edges[0], id: 'bc', sourceNodeKey: 'b', targetNodeKey: 'c' },
    );
    const graph = build([flow]);
    expect(graph.nodes.find((node) => node.id === 'send/c')!.position.x).toBeGreaterThan(
      graph.nodes.find((node) => node.id === 'send/b')!.position.x,
    );
    flow.version.edges.push({
      ...flow.version.edges[0],
      id: 'ca',
      sourceNodeKey: 'c',
      targetNodeKey: 'a',
    });
    expect(build([flow]).nodes.every((node) => Number.isFinite(node.position.x))).toBe(true);
  });

  it('drops the group box around a business flow that holds a single state', () => {
    const solo = view('solo');
    solo.version.nodes = [solo.version.nodes[0]];
    solo.version.edges = [];
    const graph = build([solo, view('send')]);
    expect(graph.nodes.filter((node) => node.type === 'flowGroup').map((node) => node.id)).toEqual([
      'send',
    ]);
    const [bare] = graph.nodes;
    expect(bare).toMatchObject({ id: 'solo/a', parentId: undefined, type: 'state' });
    expect(bare.position).toEqual({ x: 0, y: 0 });
    expect(graph.checks.has('solo/a')).toBe(true);
    expect(graph.nodes.find((node) => node.id === 'send')!.position.y).toBeGreaterThan(
      bare.position.y + bare.height!,
    );
  });

  it('collapses groups without losing their definitions and drills into one group', () => {
    const views = [view('send'), view('switch')];
    const collapsed = build(views, new Set(['send']));
    expect(collapsed.nodes.some((node) => node.id === 'send/a')).toBe(false);
    expect(collapsed.nodes.some((node) => node.id === 'switch/a')).toBe(true);
    const focused = build(views, new Set(['send']), 'send');
    expect(focused.nodes.map((node) => node.id)).toEqual(['send/a', 'send/b']);
    expect(focused.nodes.every((node) => !node.parentId)).toBe(true);
    expect(focused.checks.has('switch/a')).toBe(false);
    expect(collapsed.checks.has('send/a')).toBe(false);
    expect(build(views).nodes).toHaveLength(6);
  });
  it('isolates entry states for nested subflow occurrences and keeps parent links on group boundaries', () => {
    const parent = view('root');
    parent.version.nodes = [
      {
        ...parent.version.nodes[0],
        id: 'g1',
        nodeKey: 'g1',
        subFlowId: 'shared',
        checkItemIds: ['first'],
        requiredCheckItemIds: ['first'],
      },
      {
        ...parent.version.nodes[0],
        id: 'g2',
        nodeKey: 'g2',
        subFlowId: 'shared',
        checkItemIds: ['second'],
        requiredCheckItemIds: ['second'],
      },
      {
        ...parent.version.nodes[0],
        id: 'one',
        nodeKey: 'one',
        parentNodeId: 'g1',
        checkItemIds: ['first'],
        requiredCheckItemIds: ['first'],
      },
      {
        ...parent.version.nodes[0],
        id: 'two',
        nodeKey: 'two',
        parentNodeId: 'g2',
        checkItemIds: ['second'],
        requiredCheckItemIds: ['second'],
      },
    ];
    parent.version.edges = [
      { ...parent.version.edges[0], sourceNodeKey: 'g1', targetNodeKey: 'g2' },
    ];
    parent.run = {
      id: 'run',
      verifyRunId: 'run',
      status: 'collecting_evidence',
      attempts: [
        {
          id: 'result',
          checkResultId: 'result',
          sequence: 1,
          observation: 'Verified',
          review: null,
          reviewComment: null,
          reviewDetail: null,
          reviewAttachments: [],
          nodeId: 'one',
          checkItemId: 'first',
          incomingEdgeId: null,
          verdict: 'passed',
          evidence: [],
        },
      ],
    };
    parent.version.nodes.reverse();
    const graph = build([parent]);
    expect(graph.nodes.find((n) => n.id === 'root/g1')!.position.y).toBeLessThan(
      graph.nodes.find((n) => n.id === 'root/g2')!.position.y,
    );
    expect(graph.nodes.find((n) => n.id === 'root/g1')?.data.state).toBe('passed');
    expect(graph.nodes.find((n) => n.id === 'root/g2')?.data.state).toBeUndefined();
    expect(graph.nodes.find((n) => n.id === 'root/two')?.data.state).toBeUndefined();
    expect(graph.edges[0]).toMatchObject({ source: 'root/g1', target: 'root/g2' });
    const drilled = build([parent], new Set(), 'root/g2');
    expect(drilled.nodes.map((n) => n.id)).toEqual(['root/two']);
    expect(drilled.nodes[0].parentId).toBeUndefined();
  });
});
