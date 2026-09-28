import { useRef, useState } from 'react';

/** Keep failed feedback editable and prevent duplicate submissions before React rerenders. */
export const useReviewSubmit = () => {
  const busy = useRef(false);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const submit = async (action: () => Promise<boolean>) => {
    if (busy.current) return false;
    busy.current = true;
    setLoading(true);
    setFailed(false);
    try {
      const saved = await action();
      setFailed(!saved);
      return saved;
    } catch (cause) {
      console.error('[acceptance:feedback]', cause);
      setFailed(true);
      return false;
    } finally {
      busy.current = false;
      setLoading(false);
    }
  };
  return { failed, loading, submit };
};
