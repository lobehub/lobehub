import type { KeyboardEvent } from 'react';

/**
 * What a non-native button needs to work from the keyboard: it takes focus, and
 * Enter or Space activates it the way a click does.
 */
export const activateProps = (onActivate: () => void) => ({
  onKeyDown: (event: Pick<KeyboardEvent, 'key' | 'preventDefault'>) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    onActivate();
  },
  role: 'button' as const,
  tabIndex: 0,
});
