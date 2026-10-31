import { describe, expect, it, vi } from 'vitest';

import { handleCardKeyDown } from './cardKeyboard';

const card = {} as EventTarget;
const keyEvent = (key: string, target: EventTarget = card) => ({
  currentTarget: card as any,
  key,
  preventDefault: vi.fn(),
  target: target as any,
});

describe('handleCardKeyDown', () => {
  it('opens the detail on Enter or Space on the card itself', () => {
    for (const key of ['Enter', ' ']) {
      const open = vi.fn();
      const event = keyEvent(key);
      handleCardKeyDown(event, open);
      expect(open).toHaveBeenCalledOnce();
      expect(event.preventDefault).toHaveBeenCalled();
    }
  });

  it('ignores other keys', () => {
    const open = vi.fn();
    handleCardKeyDown(keyEvent('Tab'), open);
    expect(open).not.toHaveBeenCalled();
  });

  // Regression: Enter on the nested record button bubbled to the card, which
  // prevented the button's own click and opened the detail instead.
  it('leaves keys pressed on a nested control to that control', () => {
    const open = vi.fn();
    const event = keyEvent('Enter', {} as EventTarget);
    handleCardKeyDown(event, open);
    expect(open).not.toHaveBeenCalled();
    expect(event.preventDefault).not.toHaveBeenCalled();
  });
});
