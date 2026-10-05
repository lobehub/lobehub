import { useEffect, useRef, useState } from 'react';

import { useSingleton } from '@/hooks/useSingleton';
import { expertiseService } from '@/services/expertise';

/** Rules per call; matches the server's cap on one judging request. */
const BATCH = 40;

/**
 * Judges, in the background, the directions of rules that reached the page without one (written
 * before it existed, distilled from a run, or written by hand without picking one). Until then
 * the column shows a dash and stays a switch, so nothing waits on it.
 *
 * One call at a time, each naming the next batch of rules no call has asked about yet. When a
 * call ends the hook looks again, so every unjudged rule — including one written mid-visit — is
 * asked about exactly once per visit; a rule the model skips is not sent again, so it cannot loop
 * the page or hold up the rules behind it.
 */
export const useJudgeDirections = (
  enabled: boolean,
  unjudgedIds: string[],
  refresh: () => Promise<unknown>,
) => {
  const asked = useSingleton(() => new Set<string>());
  const runningRef = useRef(false);
  // Bumped when a call ends, so the next batch (or a rule that arrived meanwhile) gets its turn.
  const [calls, setCalls] = useState(0);
  const key = unjudgedIds.join(',');

  useEffect(() => {
    if (!enabled || runningRef.current) return;
    const batch = unjudgedIds.filter((id) => !asked.has(id)).slice(0, BATCH);
    if (batch.length === 0) return;
    for (const id of batch) asked.add(id);
    runningRef.current = true;
    void (async () => {
      try {
        const { judged } = await expertiseService.judgeRuleDirections(batch);
        if (judged > 0) await refresh();
      } catch (error) {
        // Quiet on purpose: the reviewer did not ask for this, and every row stays settable.
        console.error('[MemoryRules] judging directions failed:', error);
      } finally {
        runningRef.current = false;
        setCalls((n) => n + 1);
      }
    })();
    // `key` stands for `unjudgedIds`, whose array identity changes every render.
  }, [enabled, key, calls, refresh]);
};
