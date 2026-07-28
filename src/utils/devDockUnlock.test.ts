/**
 * @vitest-environment happy-dom
 */
import { beforeEach, describe, expect, it } from 'vitest';

import {
  advanceDevDockClickSequence,
  INITIAL_DEV_DOCK_CLICK_SEQUENCE,
  setDevDockUnlocked,
  shouldMountDevDock,
  toggleDevDockUnlocked,
} from './devDockUnlock';

describe('DevDock unlock', () => {
  beforeEach(() => {
    setDevDockUnlocked(false);
  });

  it('completes only after five consecutive clicks', () => {
    let sequence = INITIAL_DEV_DOCK_CLICK_SEQUENCE;

    for (let index = 0; index < 4; index += 1) {
      const result = advanceDevDockClickSequence(sequence, 1000 + index * 100);
      expect(result.completed).toBe(false);
      sequence = result.sequence;
    }

    expect(advanceDevDockClickSequence(sequence, 1400).completed).toBe(true);
  });

  it('resets the sequence after the click timeout', () => {
    const first = advanceDevDockClickSequence(INITIAL_DEV_DOCK_CLICK_SEQUENCE, 1000);
    const afterTimeout = advanceDevDockClickSequence(first.sequence, 2600);

    expect(afterTimeout).toEqual({
      completed: false,
      sequence: { count: 1, lastClickAt: 2600 },
    });
  });

  it('persists an explicit unlock and supports toggling it off', () => {
    expect(toggleDevDockUnlocked()).toBe(true);
    expect(localStorage.getItem('LOBE_DEV_DOCK_UNLOCKED')).toBe('1');

    expect(toggleDevDockUnlocked()).toBe(false);
    expect(localStorage.getItem('LOBE_DEV_DOCK_UNLOCKED')).toBeNull();
  });

  it('requires both server access and an unlock in production', () => {
    expect(shouldMountDevDock({ canAccess: true, isProduction: true, unlocked: false })).toBe(
      false,
    );
    expect(shouldMountDevDock({ canAccess: true, isProduction: true, unlocked: true })).toBe(true);
    expect(shouldMountDevDock({ canAccess: false, isProduction: true, unlocked: true })).toBe(
      false,
    );
  });

  it('always mounts in dev builds regardless of server access', () => {
    expect(shouldMountDevDock({ canAccess: false, isProduction: false, unlocked: false })).toBe(
      true,
    );
    expect(shouldMountDevDock({ canAccess: true, isProduction: false, unlocked: false })).toBe(
      true,
    );
  });
});
