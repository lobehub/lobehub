import { useEffect, useRef, useState } from 'react';

interface UseInitialRevalidationOptions {
  identity: string;
  isValidating: boolean;
}

/**
 * Whether the list is still waiting on the first server fetch since this
 * conversation was opened — i.e. it is painting cached rows that may be stale.
 * Later focus or polling revalidations share SWR's `isValidating` flag, but
 * the list is already fresh by then, so they are not surfaced.
 */
export const useInitialRevalidation = ({
  identity,
  isValidating,
}: UseInitialRevalidationOptions) => {
  const [settledIdentity, setSettledIdentity] = useState<string>();
  const previousRef = useRef({ identity, isValidating });

  useEffect(() => {
    const previous = previousRef.current;
    if (previous.identity !== identity) {
      // Each opening gets its own first fetch: the hook and its provider
      // outlive context switches, so a settlement must not carry over.
      setSettledIdentity(undefined);
    } else if (previous.isValidating && !isValidating) {
      setSettledIdentity(identity);
    }
    previousRef.current = { identity, isValidating };
  }, [identity, isValidating]);

  return isValidating && settledIdentity !== identity;
};
