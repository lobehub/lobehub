import { useState } from 'react';

/**
 * Remembers that *this* url failed to load, and forgets it the moment the url
 * changes.
 *
 * The memory has to be scoped to the url rather than to the component: an
 * avatar that is repaired (re-uploaded, or an edit reverted) can come back on
 * the exact same url, and a mounted tab or sidebar row would otherwise keep
 * showing initials for the rest of its life. The state is adjusted during
 * render rather than in an effect, so a changed url never paints the stale
 * fallback first.
 */
export const useBrokenSrc = (src?: string): [boolean, () => void] => {
  const [state, setState] = useState<{ broken: boolean; src?: string }>({ broken: false, src });

  const current = state.src === src ? state : { broken: false, src };
  if (current !== state) setState(current);

  return [!!src && current.broken, () => setState({ broken: true, src })];
};
