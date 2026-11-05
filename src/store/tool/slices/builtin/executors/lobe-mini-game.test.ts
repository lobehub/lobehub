import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { miniGameActions, STEP_DURATION_MS, useMiniGameStore } from '@/store/miniGame';

import { miniGameExecutor } from './lobe-mini-game';

const ctx = { messageId: 'msg', operationId: 'op' } as any;

beforeEach(() => {
  vi.useFakeTimers();
  miniGameActions.reset();
  miniGameActions.setOpen(true);
});

afterEach(() => {
  miniGameActions.reset();
  vi.useRealTimers();
});

const run = async (apiName: string, params: unknown) => {
  const promise = miniGameExecutor.invoke(apiName, params, ctx);
  await vi.advanceTimersByTimeAsync(STEP_DURATION_MS * 40);
  return promise;
};

describe('miniGameExecutor', () => {
  it('sits on the bench and reports the new state after arriving', async () => {
    const result = await run('sitOn', { targetId: 'bench_1' });

    expect(result.success).toBe(true);
    expect(result.content).toMatch(/^Walked \d+ step\(s\) and sat down on bench_1\. Now: /);
    expect(result.content).toContain('pose=sitting');
    expect(result.content).toContain('Around you now: ');
    expect(result.content).toContain('lamp_1 right 3 step(s)');
    expect(result.state).toMatchObject({
      arrived: true,
      pose: 'sitting',
      position: { x: 2, y: 6 },
      targetId: 'bench_1',
    });
  });

  it('watches the pond', async () => {
    const result = await run('watch', { targetId: 'pond_1' });
    expect(result.success).toBe(true);
    expect(result.content).toContain('started watching pond_1');
    expect(useMiniGameStore.getState().character.pose).toBe('watching');
  });

  it('turns unknown objects and impossible actions into errors without moving', async () => {
    const unknown = await run('moveTo', { targetId: 'swimming_pool' });
    expect(unknown).toMatchObject({ error: { type: 'target_not_found' }, success: false });
    expect(unknown.content).toContain('bench_1');

    const impossible = await run('sitOn', { targetId: 'pond_1' });
    expect(impossible).toMatchObject({ error: { type: 'action_not_supported' }, success: false });

    const malformed = await run('watch', {});
    expect(malformed).toMatchObject({ error: { type: 'invalid_params' }, success: false });

    expect(useMiniGameStore.getState().character.position).toEqual({ x: 6, y: 4 });
  });

  it('reports game_not_open once the panel is closed', async () => {
    miniGameActions.setOpen(false);
    expect(await run('getGameState', {})).toMatchObject({ error: { type: 'game_not_open' } });
    expect(await run('moveTo', { targetId: 'well_1' })).toMatchObject({
      error: { type: 'game_not_open' },
    });
  });

  it('returns the full game state', async () => {
    const result = await run('getGameState', {});
    expect(result.success).toBe(true);
    expect(result.content).toContain('<game_state scene="pixel-yard"');
  });
});
