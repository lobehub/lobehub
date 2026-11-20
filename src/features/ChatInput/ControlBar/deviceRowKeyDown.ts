import type { KeyboardEvent } from 'react';

/**
 * Enter / Space on a focused device row selects it. The detail Popover gives
 * the row wrapper `role="button"` and focus but no activation of its own, so
 * without this a keyboard user could tab to the row and have Enter do nothing.
 * Keys aimed at a control inside the row (the Reconnect button) stay with it,
 * and a disabled (offline) row ignores them like it ignores clicks.
 */
export const handleDeviceRowKeyDown = (
  event: Pick<KeyboardEvent, 'currentTarget' | 'key' | 'preventDefault' | 'target'>,
  { disabled, onSelect }: { disabled: boolean; onSelect: () => void },
) => {
  if (event.target !== event.currentTarget) return;
  if (event.key !== 'Enter' && event.key !== ' ') return;

  event.preventDefault();
  if (!disabled) onSelect();
};
