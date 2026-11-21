import { useEffect, useState } from 'react';

export const AWAY_AFTER_MS = 5 * 60 * 1000;

export const useTabAway = () => {
  const [away, setAway] = useState(false);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onVisibilityChange = () => {
      clearTimeout(timer);
      if (document.hidden) timer = setTimeout(() => setAway(true), AWAY_AFTER_MS);
      else setAway(false);
    };

    onVisibilityChange();
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, []);

  return away;
};
