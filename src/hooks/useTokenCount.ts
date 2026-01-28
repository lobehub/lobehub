import { debounce } from 'es-toolkit/compat';
import { startTransition, useCallback, useEffect, useState } from 'react';

import { encodeAsync } from '@/utils/tokenizer';

export const useTokenCount = (input: string = '') => {
  const [value, setNum] = useState(0);

  const debouncedEncode = useCallback(
    debounce((text: string) => {
      encodeAsync(text)
        .then(setNum)
        .catch(() => {
          setNum(text.length);
        });
    }, 300),
    [],
  );

  useEffect(() => {
    startTransition(() => {
      debouncedEncode(input || '');
    });

    // Cleanup function
    return () => {
      debouncedEncode.cancel();
    };
  }, [input, debouncedEncode]);

  return value;
};
