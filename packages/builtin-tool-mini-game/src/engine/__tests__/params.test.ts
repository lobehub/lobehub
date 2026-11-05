import { describe, expect, it } from 'vitest';

import { MiniGameApiName } from '../../types';
import { parseActionParams } from '../params';

describe('parseActionParams', () => {
  it('reads a trimmed targetId for moveTo, sitOn and watch', () => {
    expect(parseActionParams(MiniGameApiName.sitOn, { targetId: ' bench_1 ' })).toEqual({
      ok: true,
      request: { action: 'sitOn', targetId: 'bench_1' },
    });
    expect(parseActionParams(MiniGameApiName.watch, { targetId: 'pond_1' })).toEqual({
      ok: true,
      request: { action: 'watch', targetId: 'pond_1' },
    });
    expect(parseActionParams(MiniGameApiName.moveTo, { targetId: 'well_1', x: 1, y: 1 })).toEqual({
      ok: true,
      request: { action: 'moveTo', targetId: 'well_1' },
    });
  });

  it('accepts a grid cell for moveTo, including integer strings', () => {
    expect(parseActionParams(MiniGameApiName.moveTo, { x: 4, y: '7' })).toEqual({
      ok: true,
      request: { action: 'moveTo', point: { x: 4, y: 7 } },
    });
  });

  it.each([
    [MiniGameApiName.moveTo, {}],
    [MiniGameApiName.moveTo, { x: 1.5, y: 2 }],
    [MiniGameApiName.moveTo, { x: 1 }],
    [MiniGameApiName.sitOn, {}],
    [MiniGameApiName.sitOn, { targetId: '   ' }],
    [MiniGameApiName.watch, { targetId: 42 }],
    [MiniGameApiName.watch, null],
  ])('rejects %s with %j as invalid_params', (apiName, args) => {
    const result = parseActionParams(apiName, args);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.type).toBe('invalid_params');
  });

  it('rejects getGameState, which takes no action request', () => {
    expect(parseActionParams(MiniGameApiName.getGameState, {}).ok).toBe(false);
  });
});
