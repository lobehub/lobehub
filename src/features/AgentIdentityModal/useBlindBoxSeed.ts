import { useEffect, useState } from 'react';

export const BLIND_BOX_INTERVAL = 2000;

const randomSeed = () => Math.random().toString(36).slice(2, 10);

/**
 * A seed for the generated agent character that changes every
 * {@link BLIND_BOX_INTERVAL} ms while `active`.
 *
 * Before the agent exists it has no id, and the character it finally wears is
 * seeded by that id — so no single preview can be the real one. Cycling makes
 * the preview read as a blind box instead of a promise.
 */
export const useBlindBoxSeed = (active: boolean) => {
  const [seed, setSeed] = useState(randomSeed);

  useEffect(() => {
    if (!active) return;

    const timer = setInterval(() => setSeed(randomSeed()), BLIND_BOX_INTERVAL);
    return () => clearInterval(timer);
  }, [active]);

  return seed;
};
