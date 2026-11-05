import { INITIAL_CHARACTER_STATE } from '@lobechat/builtin-tool-mini-game';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { miniGameActions, STEP_DURATION_MS, useMiniGameStore } from './index';

const walk = async (steps: number) => {
  await vi.advanceTimersByTimeAsync(STEP_DURATION_MS * (steps + 1));
};

beforeEach(() => {
  vi.useFakeTimers();
  miniGameActions.reset();
});

afterEach(() => {
  miniGameActions.reset();
  vi.useRealTimers();
});

describe('miniGameActions.perform', () => {
  it('refuses to act while the game is closed', async () => {
    const result = await miniGameActions.perform({ action: 'sitOn', targetId: 'bench_1' });
    expect(result).toMatchObject({ error: { type: 'game_not_open' }, ok: false });
    expect(useMiniGameStore.getState().character).toEqual(INITIAL_CHARACTER_STATE);
  });

  it('walks cell by cell and resolves only once seated on the bench', async () => {
    miniGameActions.setOpen(true);
    let settled = false;
    const promise = miniGameActions
      .perform({ action: 'sitOn', targetId: 'bench_1' })
      .then((result) => {
        settled = true;
        return result;
      });

    expect(useMiniGameStore.getState().character.pose).toBe('walking');
    expect(useMiniGameStore.getState().pendingTargetId).toBe('bench_1');

    await vi.advanceTimersByTimeAsync(STEP_DURATION_MS);
    expect(useMiniGameStore.getState().character.position).not.toEqual(
      INITIAL_CHARACTER_STATE.position,
    );
    expect(settled).toBe(false);

    await walk(20);
    const result = await promise;
    expect(result.ok).toBe(true);
    expect(useMiniGameStore.getState()).toMatchObject({
      character: {
        activity: { action: 'sitOn', targetId: 'bench_1' },
        pose: 'sitting',
        position: { x: 2, y: 6 },
      },
      path: [],
      pendingTargetId: undefined,
    });
  });

  it('interrupts the walk in flight when a new action arrives', async () => {
    miniGameActions.setOpen(true);
    const first = miniGameActions.perform({ action: 'sitOn', targetId: 'bench_1' });
    await vi.advanceTimersByTimeAsync(STEP_DURATION_MS);

    const second = miniGameActions.perform({ action: 'watch', targetId: 'pond_1' });
    await expect(first).resolves.toMatchObject({ error: { type: 'interrupted' }, ok: false });

    await walk(20);
    await expect(second).resolves.toMatchObject({ ok: true });
    expect(useMiniGameStore.getState().character).toMatchObject({
      activity: { action: 'watch', targetId: 'pond_1' },
      pose: 'watching',
    });
  });

  it('interrupts the walk when the game closes', async () => {
    miniGameActions.setOpen(true);
    const pending = miniGameActions.perform({ action: 'watch', targetId: 'pond_1' });
    miniGameActions.setOpen(false);

    await expect(pending).resolves.toMatchObject({ error: { type: 'interrupted' } });
    expect(useMiniGameStore.getState().character.pose).toBe('idle');
  });

  it('returns the planning error without moving', async () => {
    miniGameActions.setOpen(true);
    const result = await miniGameActions.perform({ action: 'sitOn', targetId: 'pond_1' });
    expect(result).toMatchObject({ error: { type: 'action_not_supported' }, ok: false });
    expect(useMiniGameStore.getState().character).toEqual(INITIAL_CHARACTER_STATE);
  });
});

describe('miniGameActions.getContextSelection', () => {
  it('is only available while the game is open', () => {
    expect(miniGameActions.getContextSelection()).toBeUndefined();

    miniGameActions.setOpen(true);
    const selection = miniGameActions.getContextSelection();
    expect(selection).toMatchObject({ format: 'xml', sceneId: 'pixel-yard', source: 'game' });
    expect(selection?.content).toContain('<self x="6" y="4" pose="idle"');
    expect(selection?.content).toContain('id="bench_1"');
    expect(selection?.content).toContain('id="pond_1"');
  });
});
