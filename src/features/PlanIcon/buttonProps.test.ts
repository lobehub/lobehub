import { type KeyboardEvent } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { getPlanTagButtonProps } from './buttonProps';

const keyEvent = (key: string) =>
  ({ key, preventDefault: vi.fn() }) as unknown as KeyboardEvent & {
    preventDefault: ReturnType<typeof vi.fn>;
  };

describe('getPlanTagButtonProps', () => {
  it('adds nothing without a handler, so the tag stays plain text', () => {
    expect(getPlanTagButtonProps()).toEqual({});
  });

  it('makes the tag a focusable button when a handler is given', () => {
    const onClick = vi.fn();
    const props = getPlanTagButtonProps(onClick);

    expect(props).toMatchObject({ onClick, role: 'button', tabIndex: 0 });
  });

  it.each(['Enter', ' '])('activates on %j and keeps the page from scrolling', (key) => {
    const onClick = vi.fn();
    const event = keyEvent(key);

    (getPlanTagButtonProps(onClick) as { onKeyDown: (e: KeyboardEvent) => void }).onKeyDown(event);

    expect(onClick).toHaveBeenCalledTimes(1);
    expect(event.preventDefault).toHaveBeenCalled();
  });

  it('ignores other keys, so Tab and typing keep their default behavior', () => {
    const onClick = vi.fn();
    const event = keyEvent('Tab');

    (getPlanTagButtonProps(onClick) as { onKeyDown: (e: KeyboardEvent) => void }).onKeyDown(event);

    expect(onClick).not.toHaveBeenCalled();
    expect(event.preventDefault).not.toHaveBeenCalled();
  });
});
