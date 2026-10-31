import { useEffect, useState } from 'react';
import { flushSync } from 'react-dom';

/**
 * Whether the browser is printing the page, from `beforeprint` to `afterprint`.
 *
 * The browser lays out the printed pages right after `beforeprint` returns, so
 * the update is flushed synchronously: anything rendered from this flag is in
 * the DOM by then, not one frame too late.
 */
export const useIsPrinting = () => {
  const [printing, setPrinting] = useState(false);

  useEffect(() => {
    const handleBeforePrint = () => flushSync(() => setPrinting(true));
    const handleAfterPrint = () => setPrinting(false);

    window.addEventListener('beforeprint', handleBeforePrint);
    window.addEventListener('afterprint', handleAfterPrint);

    return () => {
      window.removeEventListener('beforeprint', handleBeforePrint);
      window.removeEventListener('afterprint', handleAfterPrint);
    };
  }, []);

  return printing;
};
