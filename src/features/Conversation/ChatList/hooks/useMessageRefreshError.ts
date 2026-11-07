import debug from 'debug';
import { useCallback, useEffect, useRef, useState } from 'react';

const log = debug('lobe-client:message-refresh');

interface UseMessageRefreshErrorOptions {
  error?: unknown;
  identity: string;
  isValidating: boolean;
  mutate: () => Promise<unknown>;
}

interface RetainedError {
  error?: unknown;
  identity: string;
}

interface RetryRequest {
  identity: string;
  token: symbol;
}

/**
 * Keep a refresh failure visible while SWR performs automatic revalidation,
 * and track only a user-triggered Retry as button progress. SWR's shared
 * `isValidating` flag cannot distinguish those two causes.
 */
export const useMessageRefreshError = ({
  error,
  identity,
  isValidating,
  mutate,
}: UseMessageRefreshErrorOptions) => {
  const [retainedError, setRetainedError] = useState<RetainedError>({ error, identity });
  const [retryingIdentity, setRetryingIdentity] = useState<string>();
  const activeIdentityRef = useRef(identity);
  const retryInFlightRef = useRef<RetryRequest | undefined>(undefined);
  const validationRef = useRef({ identity, isValidating });
  activeIdentityRef.current = identity;

  useEffect(() => {
    const previousValidation = validationRef.current;

    if (previousValidation.identity !== identity) {
      validationRef.current = { identity, isValidating };
      setRetainedError({ error, identity });
      return;
    }

    if (error !== undefined) {
      setRetainedError({ error, identity });
    } else if (
      previousValidation.isValidating &&
      !isValidating &&
      retryInFlightRef.current?.identity !== identity
    ) {
      // An automatic revalidation just settled without an error.
      setRetainedError({ error: undefined, identity });
    }
    validationRef.current = { identity, isValidating };
  }, [error, identity, isValidating]);

  const retry = useCallback(async () => {
    if (retryInFlightRef.current?.identity === identity) return;
    const request = { identity, token: Symbol(identity) };
    retryInFlightRef.current = request;
    setRetryingIdentity(identity);

    try {
      await mutate();
      if (activeIdentityRef.current === identity) {
        setRetainedError({ error: undefined, identity });
      }
    } catch (retryError) {
      if (activeIdentityRef.current === identity) {
        setRetainedError({ error: retryError, identity });
      }
      // The persistent error surface is the user feedback; keep a diagnostic
      // for production debugging without turning the rejected click into an
      // unhandled promise.
      log('Explicit message refresh retry failed: %O', retryError);
    } finally {
      if (retryInFlightRef.current?.token === request.token) {
        retryInFlightRef.current = undefined;
        setRetryingIdentity((current) => (current === identity ? undefined : current));
      }
    }
  }, [identity, mutate]);

  const retainedErrorForIdentity =
    retainedError.identity === identity ? retainedError.error : undefined;

  return {
    error: error ?? retainedErrorForIdentity,
    isRetrying: retryingIdentity === identity,
    retry,
  };
};
