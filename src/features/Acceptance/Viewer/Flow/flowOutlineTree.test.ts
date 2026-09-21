import type { Edge, Node } from '@xyflow/react';
import { describe, expect, it } from 'vitest';

import type { FlowGraphData } from './flowGraph';
import { buildOutlineTree } from './flowOutlineTree';

const node = (id: string, extra: Partial<Node<FlowGraphData>> = {}): Node<FlowGraphData> => ({
  data: { title: id },
  id,
  position: { x: 0, y: 0 },
  type: 'state',
  ...extra,
});
const edge = (source: string, target: string): Edge => ({
  id: `${source}-${target}`,
  label: `${source}→${target}`,
  source,
  target,
});
const titles = (steps: ReturnType<typeof buildOutlineTree>): unknown =>
  steps.map((step) => [
    step.node.id,
    step.branches.map((b) => (b.step ? titles([b.step]) : `ref:${b.target.id}`)),
  ]);

describe('buildOutlineTree', () => {
  it('starts at the entry and hangs dependent steps under their branches', () => {
    const steps = buildOutlineTree(
      [node('c'), node('a'), node('b')],
      [edge('a', 'b'), edge('b', 'c')],
    );
    expect(titles(steps)).toEqual([['a', [[['b', [[['c', []]]]]]]]]);
  });

  it('lists a merged step once and turns the other path into a reference', () => {
    const steps = buildOutlineTree(
      [node('a'), node('b'), node('c'), node('d')],
      [edge('a', 'b'), edge('a', 'c'), edge('b', 'd'), edge('c', 'd')],
    );
    expect(titles(steps)).toEqual([['a', [[['b', [[['d', []]]]]], [['c', ['ref:d']]]]]]);
  });

  it('keeps cycles finite and still lists every step, including detached ones', () => {
    const steps = buildOutlineTree(
      [node('a'), node('b'), node('lone')],
      [edge('a', 'b'), edge('b', 'a')],
    );
    // Steps nobody depends on are entries and come first; the cycle is listed after them.
    expect(titles(steps)).toEqual([
      ['lone', []],
      ['a', [[['b', ['ref:a']]]]],
    ]);
  });

  it('nests group members under their group and keeps sibling edges inside the group', () => {
    const steps = buildOutlineTree(
      [
        node('g', { type: 'flowGroup' }),
        node('g/a', { parentId: 'g' }),
        node('g/b', { parentId: 'g' }),
      ],
      [edge('g/a', 'g/b')],
    );
    expect(steps).toHaveLength(1);
    expect(titles(steps[0].members)).toEqual([['g/a', [[['g/b', []]]]]]);
  });
});
