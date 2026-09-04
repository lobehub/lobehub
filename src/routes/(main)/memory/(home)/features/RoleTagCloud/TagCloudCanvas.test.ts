import { Vector3 } from 'three';
import { describe, expect, it, vi } from 'vitest';

import { updateConnections } from './TagCloudCanvas';

describe('updateConnections', () => {
  it('keeps the state reference when no connection expires or spawns', () => {
    const previous = [
      {
        birthTime: 0,
        duration: 10,
        end: new Vector3(1, 1, 1),
        id: 'connection-1',
        start: new Vector3(),
      },
    ];

    const next = updateConnections(previous, 1, 1, vi.fn(), vi.fn());

    expect(next).toBe(previous);
  });
});
