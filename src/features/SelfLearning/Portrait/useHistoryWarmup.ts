import { toast } from '@lobehub/ui/base-ui';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { expertiseService } from '@/services/expertise';

/** 温习结束的判定：连续这么久没有新经验进来就算完（后端不报进度）。 */
const QUIET_MS = 60_000;
/** 无论如何，超过这个时长就收尾，别让页面永远在轮询。 */
const MAX_MS = 10 * 60_000;
export const WARMUP_POLL_MS = 4000;

type WarmupPhase = 'done' | 'idle' | 'running';

interface WarmupRecord {
  baseline: number;
  candidateCount: number;
  lastChangeAt: number;
  lastCount: number;
  startedAt: number;
}

const storageKey = (agentId: string) => `self-learning:warmup:${agentId}`;

const read = (agentId: string): WarmupRecord | null => {
  try {
    const raw = sessionStorage.getItem(storageKey(agentId));
    return raw ? (JSON.parse(raw) as WarmupRecord) : null;
  } catch {
    return null;
  }
};
const write = (agentId: string, rec: WarmupRecord | null) => {
  if (rec) sessionStorage.setItem(storageKey(agentId), JSON.stringify(rec));
  else sessionStorage.removeItem(storageKey(agentId));
};

/**
 * 「让它温习历史对话」的本地状态机。
 * 后端只告诉我们启动了几个对话，不报进度；进度感来自新经验一条条流进来（靠轮询）。
 */
export const useHistoryWarmup = (agentId: string | undefined, learnedTotal: number) => {
  const { t } = useTranslation('selfLearning');
  const [rec, setRec] = useState<WarmupRecord | null>(() => (agentId ? read(agentId) : null));
  const [phase, setPhase] = useState<WarmupPhase>(() => (rec ? 'running' : 'idle'));
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    if (!agentId) return;
    const r = read(agentId);
    setRec(r);
    setPhase(r ? 'running' : 'idle');
  }, [agentId]);

  // Advance the record as lessons arrive; decide when the review is over.
  useEffect(() => {
    if (!agentId || phase !== 'running' || !rec) return;
    const now = Date.now();
    let next = rec;
    if (learnedTotal !== rec.lastCount) {
      next = { ...rec, lastChangeAt: now, lastCount: learnedTotal };
      setRec(next);
      write(agentId, next);
    }
    const quietFor = now - next.lastChangeAt;
    const total = now - next.startedAt;
    if ((quietFor > QUIET_MS && total > QUIET_MS / 2) || total > MAX_MS) {
      setPhase('done');
      write(agentId, null);
    }
  }, [agentId, learnedTotal, phase, rec]);

  // Re-check the quiet timer even when no new data arrives.
  useEffect(() => {
    if (phase !== 'running') return;
    const id = setInterval(() => setRec((r) => (r ? { ...r } : r)), WARMUP_POLL_MS);
    return () => clearInterval(id);
  }, [phase]);

  const start = useCallback(async () => {
    if (!agentId || starting) return;
    setStarting(true);
    try {
      const result = await expertiseService.ingestHistory(agentId);
      if (result.candidateCount === 0) {
        toast.info(t('warmup.idleNone'));
        return;
      }
      const now = Date.now();
      const next: WarmupRecord = {
        baseline: learnedTotal,
        candidateCount: result.candidateCount,
        lastChangeAt: now,
        lastCount: learnedTotal,
        startedAt: now,
      };
      write(agentId, next);
      setRec(next);
      setPhase('running');
    } catch {
      toast.error(t('warmup.failed'));
    } finally {
      setStarting(false);
    }
  }, [agentId, learnedTotal, starting, t]);

  const dismiss = useCallback(() => {
    setPhase('idle');
    setRec(null);
    if (agentId) write(agentId, null);
  }, [agentId]);

  return useMemo(
    () => ({
      candidateCount: rec?.candidateCount ?? 0,
      dismiss,
      learned: rec ? Math.max(0, learnedTotal - rec.baseline) : 0,
      phase,
      refreshInterval: phase === 'running' ? WARMUP_POLL_MS : undefined,
      start,
      starting,
    }),
    [dismiss, learnedTotal, phase, rec, start, starting],
  );
};
