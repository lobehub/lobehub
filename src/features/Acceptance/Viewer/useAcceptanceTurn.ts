import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';

export const readAcceptanceTurn = (params: URLSearchParams) => {
  const raw = params.get('turn') ?? params.get('r');
  return raw && /^[1-9]\d*$/.test(raw) && Number.isSafeInteger(Number(raw)) ? Number(raw) : null;
};

export const useAcceptanceTurn = (embedded = false) => {
  const [params, setParams] = useSearchParams();
  const [localTurn, setLocalTurn] = useState<number | null>(null);
  const turn = embedded ? localTurn : readAcceptanceTurn(params);
  useEffect(() => {
    if (embedded || !params.has('r')) return;
    setParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        if (turn !== null) next.set('turn', String(turn));
        next.delete('r');
        return next;
      },
      { replace: true },
    );
  }, [embedded, params, setParams, turn]);
  const setTurn = (value: number | null) => {
    if (embedded) {
      setLocalTurn(value);
      return;
    }
    setParams((previous) => {
      const next = new URLSearchParams(previous);
      next.delete('r');
      next.delete('filter');
      if (value === null) next.delete('turn');
      else next.set('turn', String(value));
      return next;
    });
  };
  return { setTurn, turn };
};
