import { useRef, useState } from 'react';

/**
 * Input value plus a committed query that only follows the input outside IME
 * composition. Mid-composition text is raw pinyin (`yu'y`, `应用she'zhi`), not
 * what the user means — searching it flashed unrelated results and recorded the
 * pinyin as a real query in analytics.
 */
export const useImeAwareQuery = () => {
  const [inputValue, setInputValue] = useState('');
  const [query, setQuery] = useState('');
  const composingRef = useRef(false);

  return {
    inputProps: {
      onCompositionEnd: (event: { currentTarget: { value: string } }) => {
        composingRef.current = false;
        // Chrome fires the final input event before compositionend, Safari
        // after it — commit here so both orders settle on the composed text.
        setQuery(event.currentTarget.value);
      },
      onCompositionStart: () => {
        composingRef.current = true;
      },
      onInputChange: (value: string) => {
        setInputValue(value);
        if (!composingRef.current) setQuery(value);
      },
      value: inputValue,
    },
    query,
  };
};
