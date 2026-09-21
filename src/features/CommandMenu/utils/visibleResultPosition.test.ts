import { describe, expect, it } from 'vitest';

import { createVisibleResultPositionMap } from './visibleResultPosition';

describe('createVisibleResultPositionMap', () => {
  it('uses final visible group order instead of the server array order', () => {
    const firstServerResult = { id: 'agent-1' };
    const secondServerResult = { id: 'message-1' };

    const positions = createVisibleResultPositionMap(
      [[secondServerResult], [firstServerResult]],
      2,
    );

    expect(positions.get(secondServerResult)).toBe(3);
    expect(positions.get(firstServerResult)).toBe(4);
  });
});
