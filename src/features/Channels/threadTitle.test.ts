import { describe, expect, it } from 'vitest';

import { threadTitle } from './threadTitle';

describe('threadTitle', () => {
  it('prefers the name the Agent gave the thread', () => {
    expect(
      threadTitle({ content: 'Why did the deploy fail?\nlogs…' }, { title: 'Red deploy' }),
    ).toBe('Red deploy');
  });

  it('falls back to the first line of the root message', () => {
    expect(threadTitle({ content: '  Why did the deploy fail?\nlogs…' }, {})).toBe(
      'Why did the deploy fail?',
    );
    expect(threadTitle(undefined, undefined)).toBeUndefined();
  });
});
