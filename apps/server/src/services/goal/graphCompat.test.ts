import type { GoalGraphSnapshot } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { graphForClient } from './graphCompat';

const graph = {
  nodes: [
    { id: 'p', kind: 'problem' },
    { id: 'b', kind: 'batch' },
    { id: 't', kind: 'task' },
  ],
} as unknown as GoalGraphSnapshot;

describe('graphForClient', () => {
  it('sends a batch as an experiment container to a client that does not declare batches', () => {
    // A cached web bundle or an installed desktop app predates the kind.
    expect(graphForClient(graph).nodes.map((node) => node.kind)).toEqual([
      'problem',
      'experiment',
      'task',
    ]);
    expect(graphForClient(graph, ['other']).nodes[1].kind).toBe('experiment');
  });

  it('keeps the real kind for a client that renders batches', () => {
    expect(graphForClient(graph, ['batch'])).toBe(graph);
  });
});
