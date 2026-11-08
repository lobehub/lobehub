import { describe, expect, it, vi } from 'vitest';

import { activateProps } from './activateProps';

const press = (key: string) => ({ key, preventDefault: vi.fn() });

describe('activateProps', () => {
  it('makes the card focusable and opens it on Enter or Space', () => {
    const onActivate = vi.fn();
    const props = activateProps(onActivate);
    expect(props).toMatchObject({ role: 'button', tabIndex: 0 });

    const enter = press('Enter');
    props.onKeyDown(enter);
    props.onKeyDown(press(' '));
    expect(onActivate).toHaveBeenCalledTimes(2);
    // Space must not also scroll the panel.
    expect(enter.preventDefault).toHaveBeenCalled();
  });

  it('ignores other keys', () => {
    const onActivate = vi.fn();
    const tab = press('Tab');
    activateProps(onActivate).onKeyDown(tab);
    expect(onActivate).not.toHaveBeenCalled();
    expect(tab.preventDefault).not.toHaveBeenCalled();
  });
});
