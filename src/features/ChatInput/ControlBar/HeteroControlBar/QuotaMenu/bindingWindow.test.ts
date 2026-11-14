import { describe, expect, it } from 'vitest';

import { getWindowLeftPercent, pickBindingWindow } from './bindingWindow';

const NOW = 1_000_000;

describe('getWindowLeftPercent', () => {
  it('returns the remaining percent of a live window', () => {
    expect(
      getWindowLeftPercent({ resetsAt: NOW + 1, usedPercent: 39, windowMinutes: 300 }, NOW),
    ).toBe(61);
  });

  it('treats a window whose reset has passed as refilled', () => {
    expect(getWindowLeftPercent({ resetsAt: NOW, usedPercent: 90, windowMinutes: 300 }, NOW)).toBe(
      100,
    );
  });
});

describe('pickBindingWindow', () => {
  it('picks the tightest window and keeps its name', () => {
    expect(
      pickBindingWindow(
        [
          {
            key: 'session',
            label: '5h',
            window: { resetsAt: null, usedPercent: 2, windowMinutes: 300 },
          },
          {
            key: 'weekly',
            label: 'Weekly',
            window: { resetsAt: null, usedPercent: 39, windowMinutes: 10_080 },
          },
        ],
        NOW,
      ),
    ).toEqual({ key: 'weekly', label: 'Weekly', leftPercent: 61, resetsAt: null });
  });

  it('keeps the earlier window on a tie and skips missing windows', () => {
    expect(
      pickBindingWindow(
        [
          { key: 'missing', label: 'Missing', window: null },
          {
            key: 'session',
            label: '5h',
            window: { resetsAt: null, usedPercent: 40, windowMinutes: 300 },
          },
          {
            key: 'weekly',
            label: 'Weekly',
            window: { resetsAt: null, usedPercent: 40, windowMinutes: 10_080 },
          },
        ],
        NOW,
      )?.key,
    ).toBe('session');
  });

  it('moves to the next tightest window once the binding one resets', () => {
    const items = [
      {
        key: 'session',
        label: '5h',
        window: { resetsAt: null, usedPercent: 2, windowMinutes: 300 },
      },
      {
        key: 'weekly',
        label: 'Weekly',
        window: { resetsAt: NOW + 60_000, usedPercent: 39, windowMinutes: 10_080 },
      },
    ];

    expect(pickBindingWindow(items, NOW)?.key).toBe('weekly');
    expect(pickBindingWindow(items, NOW + 60_000)).toEqual({
      key: 'session',
      label: '5h',
      leftPercent: 98,
      resetsAt: null,
    });
  });

  it('returns undefined without any window', () => {
    expect(pickBindingWindow([{ key: 'session', label: '5h', window: null }], NOW)).toBeUndefined();
  });
});
