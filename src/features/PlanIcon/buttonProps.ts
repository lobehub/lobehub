import { type KeyboardEvent } from 'react';

/**
 * Props that make a non-button element (a tag pill) operable as a button. Without a handler
 * the element stays plain text: no role, no tab stop.
 */
export const getPlanTagButtonProps = (onClick?: () => void) => {
  if (!onClick) return {};

  return {
    onClick,
    onKeyDown: (e: KeyboardEvent) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      // Space would otherwise scroll the page.
      e.preventDefault();
      onClick();
    },
    role: 'button' as const,
    tabIndex: 0,
  };
};
