// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';

import { ownsEscape } from './escapeScope';

const key = (target: EventTarget, init: KeyboardEventInit = {}) => {
  const event = new KeyboardEvent('keydown', { key: 'Escape', ...init });
  Object.defineProperty(event, 'target', { value: target });
  return event;
};

describe('ownsEscape', () => {
  const root = document.createElement('div');
  const inside = root.appendChild(document.createElement('textarea'));
  const outside = document.createElement('input');

  it('takes Escape pressed inside the board or with nothing focused', () => {
    expect(ownsEscape(key(inside), root)).toBe(true);
    expect(ownsEscape(key(document.body), root)).toBe(true);
  });

  it('leaves Escape to whatever else has the focus', () => {
    expect(ownsEscape(key(outside), root)).toBe(false);
  });

  it('leaves Escape to an input method that is composing, and ignores other keys', () => {
    expect(ownsEscape(key(inside, { isComposing: true }), root)).toBe(false);
    expect(ownsEscape(key(inside, { key: 'Enter' }), root)).toBe(false);
  });
});
