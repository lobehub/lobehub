import { describe, expect, it, vi } from 'vitest';

import { submitNumberOnEnter } from './OrderedListNumberMenu';

describe('submitNumberOnEnter', () => {
  it('applies the number and cancels the Enter so the editor does not split the item', () => {
    const event = { preventDefault: vi.fn() };
    const onSetValue = vi.fn();

    submitNumberOnEnter(event, 5, onSetValue);

    expect(onSetValue).toHaveBeenCalledWith(5);
    expect(event.preventDefault).toHaveBeenCalled();
  });

  it.each([null, -1, 2.5])('ignores %s but still cancels the Enter', (value) => {
    const event = { preventDefault: vi.fn() };
    const onSetValue = vi.fn();

    submitNumberOnEnter(event, value, onSetValue);

    expect(onSetValue).not.toHaveBeenCalled();
    expect(event.preventDefault).toHaveBeenCalled();
  });
});
