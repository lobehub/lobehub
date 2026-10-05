import { useEffect, useRef, useState } from 'react';

import { useSingleton } from '@/hooks/useSingleton';
import { expertiseService } from '@/services/expertise';

/** Calls per pass; a model that keeps skipping rules must not keep the page asking. */
const MAX_CALLS_PER_PASS = 10;

/**
 * Judges, in the background, the directions of rules that reached the page without one (written
 * before it existed, distilled from a run, or written by hand without picking one). Until then
 * the column shows a dash and stays a switch, so nothing waits on it.
 *
 * A pass starts whenever an unjudged rule appears that no pass has asked about yet — so a rule
 * written mid-visit gets judged too — and each rule is asked about at most once per visit, so
 * one the model keeps skipping cannot loop the page.
 */
export const useJudgeDirections = (
  enabled: boolean,
  unjudgedIds: string[],
  refresh: () => Promise<unknown>,
) => {
  const asked = useSingleton(() => new Set<string>());
  const runningRef = useRef(false);
  // Bumped when a pass ends, so rules that arrived while it ran get a pass of their own.
  const [passes, setPasses] = useState(0);
  const key = unjudgedIds.join(',');

  useEffect(() => {
    if (!enabled || runningRef.current) return;
    if (!unjudgedIds.some((id) => !asked.has(id))) return;
    for (const id of unjudgedIds) asked.add(id);
    runningRef.current = true;
    void (async () => {
      try {
        for (let call = 0; call < MAX_CALLS_PER_PASS; call++) {
          const { judged, remaining } = await expertiseService.judgeRuleDirections();
          if (judged > 0) await refresh();
          if (judged === 0 || remaining === 0) break;
        }
      } catch (error) {
        // Quiet on purpose: the reviewer did not ask for this, and every row stays settable.
        console.error('[MemoryRules] judging directions failed:', error);
      } finally {
        runningRef.current = false;
        setPasses((n) => n + 1);
      }
    })();
    // `key` stands for `unjudgedIds`, whose array identity changes every render.
  }, [enabled, key, passes, refresh]);
};
