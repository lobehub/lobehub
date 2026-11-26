import { describe, expect, it } from 'vitest';

import { toGatewayToolState } from './toGatewayToolState';

describe('toGatewayToolState', () => {
  it('sends a screenshot as the dataUrl the server and MCP path read', () => {
    const url = 'data:image/jpeg;base64,abc';

    expect(
      toGatewayToolState('screenshot', {
        height: 600,
        images: [{ mediaType: 'image/jpeg', url }],
        width: 800,
      }),
    ).toEqual({ dataUrl: url, height: 600, width: 800 });
  });

  it('leaves other tools and an empty capture alone', () => {
    const state = { title: 'T' };

    expect(toGatewayToolState('readPage', state)).toBe(state);
    expect(toGatewayToolState('screenshot', state)).toBe(state);
    expect(toGatewayToolState('screenshot', undefined)).toBeUndefined();
  });
});
