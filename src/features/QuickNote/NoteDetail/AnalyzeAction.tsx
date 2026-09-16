'use client';

import { ActionIcon, toast } from '@lobehub/ui/base-ui';
import { cssVar } from 'antd-style';
import { Sparkles } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ANALYZE_SETTLE_DELAY, quickNoteSelectors, useQuickNoteStore } from '@/store/quickNote';

import { styles } from './style';

const AnalyzeAction = ({ noteId }: { noteId: string }) => {
  const { t } = useTranslation('note');
  const note = useQuickNoteStore(quickNoteSelectors.noteById(noteId));
  const requesting = useQuickNoteStore(quickNoteSelectors.isAnalyzing(noteId));
  const analyzeNote = useQuickNoteStore((s) => s.analyzeNote);
  const [now, setNow] = useState(Date.now());

  const run = note?.run;
  const runActive = Boolean(run && ['pending', 'running'].includes(run.status));
  const dueAt = runActive ? undefined : note?.analyzeDueAt;

  useEffect(() => {
    if (!dueAt || dueAt <= Date.now()) return;

    setNow(Date.now());
    const interval = window.setInterval(() => setNow(Date.now()), 100);
    return () => window.clearInterval(interval);
  }, [dueAt]);

  if (!note) return null;

  const remaining = dueAt ? Math.max(0, dueAt - now) : 0;
  const scheduled = remaining > 0;
  const circumference = 2 * Math.PI * 12;
  const progress = Math.min(1, remaining / ANALYZE_SETTLE_DELAY);
  const status = run?.kind === 'analyze' ? run.status : undefined;
  const loading = requesting || status === 'pending' || status === 'running';
  const title =
    status === 'pending'
      ? t('editor.analyzePending')
      : status === 'running'
        ? t('editor.analyzeRunning')
        : status === 'failed'
          ? t('editor.analyzeFailed')
          : scheduled
            ? t('editor.analyzeScheduled', { seconds: Math.max(1, Math.ceil(remaining / 1000)) })
            : t('editor.analyze');

  return (
    <span className={styles.analyzeAction}>
      <ActionIcon
        aria-label={title}
        disabled={!note.content.trim() || runActive}
        icon={Sparkles}
        loading={loading}
        title={title}
        style={{
          color:
            status === 'failed'
              ? cssVar.colorError
              : status === 'pending'
                ? cssVar.colorWarning
                : status === 'running'
                  ? cssVar.colorInfo
                  : undefined,
        }}
        onClick={() => {
          void analyzeNote(noteId).catch(() => toast.error(t('agentic.actionFailed')));
        }}
      />
      {scheduled && (
        <svg
          aria-hidden
          className={styles.analyzeProgress}
          height={28}
          viewBox={'0 0 28 28'}
          width={28}
        >
          <circle
            cx={14}
            cy={14}
            fill={'none'}
            r={12}
            stroke={cssVar.colorPrimary}
            strokeDasharray={circumference}
            strokeDashoffset={circumference * (1 - progress)}
            strokeLinecap={'round'}
            strokeWidth={1.5}
            style={{ transition: 'stroke-dashoffset 100ms linear' }}
          />
        </svg>
      )}
    </span>
  );
};

export default AnalyzeAction;
