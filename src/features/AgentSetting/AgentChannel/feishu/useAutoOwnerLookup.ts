import { useDebounceFn } from 'ahooks';
import { useEffect, useRef } from 'react';

interface AutoOwnerLookupOptions {
  appId?: string;
  disabled?: boolean;
  onLookup: () => void;
  platformId: string;
  savedValue?: unknown;
  secret?: string;
}

/** Wait for credential edits to settle, without refilling a deliberately cleared owner. */
export const useAutoOwnerLookup = ({
  appId,
  disabled,
  onLookup,
  platformId,
  savedValue,
  secret,
}: AutoOwnerLookupOptions) => {
  const attemptedKey = useRef<string | null>(null);
  const key = appId && secret ? `${platformId}\u0000${appId}\u0000${secret}` : null;
  const hasSavedValue = typeof savedValue === 'string' && !!savedValue.trim();
  const { cancel, run } = useDebounceFn(
    (credentialKey: string) => {
      attemptedKey.current = credentialKey;
      onLookup();
    },
    { wait: 600 },
  );

  useEffect(() => {
    if (disabled || hasSavedValue || !key || attemptedKey.current === key) return;
    run(key);
    return cancel;
  }, [cancel, disabled, hasSavedValue, key, run]);

  return () => {
    cancel();
    attemptedKey.current = key;
  };
};
