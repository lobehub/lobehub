import { describe, expect, it } from 'vitest';

import { formatZoom, zoomCommandFromKey, zoomFactor } from './zoomCommands';

const key = (init: Partial<KeyboardEventInit> & { code?: string; key?: string }) => ({
  altKey: false,
  code: '',
  ctrlKey: false,
  key: '',
  metaKey: false,
  shiftKey: false,
  ...init,
});

describe('zoomCommandFromKey', () => {
  it('maps mod plus and minus to zoom in and out', () => {
    expect(zoomCommandFromKey(key({ code: 'Equal', key: '=', metaKey: true }))).toBe('in');
    expect(
      zoomCommandFromKey(key({ code: 'Equal', key: '+', metaKey: true, shiftKey: true })),
    ).toBe('in');
    expect(zoomCommandFromKey(key({ code: 'NumpadAdd', ctrlKey: true, key: '+' }))).toBe('in');
    expect(zoomCommandFromKey(key({ code: 'Minus', ctrlKey: true, key: '-' }))).toBe('out');
    expect(zoomCommandFromKey(key({ code: 'NumpadSubtract', key: '-', metaKey: true }))).toBe(
      'out',
    );
  });

  it('maps shift+1 to fit and shift+0 to 100% by physical key', () => {
    expect(zoomCommandFromKey(key({ code: 'Digit1', key: '!', shiftKey: true }))).toBe('fit');
    expect(zoomCommandFromKey(key({ code: 'Digit0', key: ')', shiftKey: true }))).toBe('actual');
  });

  it('ignores the same keys without the right modifiers', () => {
    expect(zoomCommandFromKey(key({ code: 'Equal', key: '=' }))).toBeUndefined();
    expect(zoomCommandFromKey(key({ code: 'Digit1', key: '1' }))).toBeUndefined();
    expect(
      zoomCommandFromKey(key({ code: 'Digit1', key: '!', metaKey: true, shiftKey: true })),
    ).toBeUndefined();
    expect(
      zoomCommandFromKey(key({ altKey: true, code: 'Equal', key: '=', metaKey: true })),
    ).toBeUndefined();
  });
});

describe('zoomFactor', () => {
  it('steps by 1.25 in both directions', () => {
    expect(zoomFactor('in', 0.5)).toBe(1.25);
    expect(zoomFactor('out', 0.5)).toBe(0.8);
  });

  it('lands on exactly 100% from any scale', () => {
    for (const k of [0.08, 0.28, 0.5, 1.7]) expect(k * zoomFactor('actual', k)).toBeCloseTo(1, 10);
  });
});

describe('formatZoom', () => {
  it('rounds the scale to a whole percent', () => {
    expect(formatZoom(0.2849)).toBe('28%');
    expect(formatZoom(1)).toBe('100%');
  });
});
