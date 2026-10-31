import type { KeyboardEvent } from 'react';

/**
 * Enter / Space on the focused card opens its detail, as a click would. Keys
 * pressed on a control nested in the card (its record button) bubble here too;
 * those belong to that control, so they are left alone.
 */
export const handleCardKeyDown = (
  event: Pick<KeyboardEvent, 'currentTarget' | 'key' | 'preventDefault' | 'target'>,
  open: () => void,
) => {
  if (event.target !== event.currentTarget) return;
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    open();
  }
};
