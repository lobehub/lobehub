import { debounce } from 'es-toolkit/compat';
import { startTransition, useCallback, useEffect, useState } from 'react';

import { encodeAsync } from '@/utils/tokenizer';

export const useTokenCount = (input: string = '') => {
  const [value, setNum] = useState(0);

  // The transition must wrap the setState itself — wrapping the debounce call
  // only demotes the timer scheduling while the eventual update still lands at
  // default priority.
  const debouncedEncode = useCallback(
    debounce((text: string) => {
      encodeAsync(text)
        .then((count) => startTransition(() => setNum(count)))
        .catch(() => {
          startTransition(() => setNum(text.length));
        });
    }, 300),
    [],
  );

  useEffect(() => {
    debouncedEncode(input || '');

    // Cleanup function
    return () => {
      debouncedEncode.cancel();
    };
  }, [input, debouncedEncode]);

  return value;
};
