import { useState } from 'react';

/**
 * Whether a canvas should develop its image out of the generating aura.
 *
 * Decided once at mount: only a canvas that saw the generation happen (no image
 * yet, or a generation clock started in this session) plays the motion. A
 * history card mounts with its image already known; replaying the motion on
 * every reload reads as the image being generated again.
 */
export const useDevelopsOnMount = (url?: string, startedAt?: number) => {
  const [develops] = useState(() => !url || !!startedAt);
  return develops;
};
