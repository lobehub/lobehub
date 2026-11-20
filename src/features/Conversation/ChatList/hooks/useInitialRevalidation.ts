import { useEffect, useRef, useState } from 'react';

interface UseInitialRevalidationOptions {
  identity: string;
  /**
   * Whether this conversation's cached list is still inside its server
   * verification window, i.e. opening it starts no fetch. Read once per opening.
   */
  isServerVerified: () => boolean;
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
  isServerVerified,
  isValidating,
}: UseInitialRevalidationOptions) => {
  const [settledIdentity, setSettledIdentity] = useState<string>();
  const previousRef = useRef<{ identity: string; isValidating: boolean } | undefined>(undefined);
  const isServerVerifiedRef = useRef(isServerVerified);
  isServerVerifiedRef.current = isServerVerified;

  useEffect(() => {
    const previous = previousRef.current;
    if (previous?.identity !== identity) {
      // A new opening. The hook and its provider outlive context switches, so a
      // settlement never carries over. An opening served from a still-verified
      // cache starts no first fetch, so it is settled right away and a later
      // focus or polling refresh is not mistaken for one. `isValidating` cannot
      // decide this: SWR has not reported the switch-time revalidation yet.
      setSettledIdentity(isServerVerifiedRef.current() ? identity : undefined);
    } else if (previous.isValidating && !isValidating) {
      setSettledIdentity(identity);
    }
    previousRef.current = { identity, isValidating };
  }, [identity, isValidating]);

  return isValidating && settledIdentity !== identity;
};
