import { DEFAULT_AVATAR } from '@lobechat/const';
import { isValidElement, type ReactElement } from 'react';
import { describe, expect, it } from 'vitest';

import { toStackAvatar } from './stackAvatar';

describe('toStackAvatar', () => {
  it('keeps a member avatar of its own', () => {
    expect(toStackAvatar({ avatar: '🤖', background: '#fff', seed: 'a' }, 0)).toEqual({
      avatar: '🤖',
      background: '#fff',
    });
  });

  it.each([undefined, '', DEFAULT_AVATAR])('draws the generated character for %s', (avatar) => {
    const item = toStackAvatar({ avatar, background: '#fff', seed: 'agent-1' }, 0);

    expect(isValidElement(item.avatar)).toBe(true);
    expect((item.avatar as ReactElement<{ seed: string }>).props.seed).toBe('agent-1');
    expect(item.background).toBeUndefined();
  });

  it('keeps members without a seed apart by their position', () => {
    const seedAt = (index: number) =>
      (toStackAvatar({}, index).avatar as ReactElement<{ seed: string }>).props.seed;

    expect(seedAt(0)).not.toBe(seedAt(1));
  });
});
