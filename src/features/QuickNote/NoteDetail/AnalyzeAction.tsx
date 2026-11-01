'use client';

import { ActionIcon, cssVar, toast } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { Sparkles } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { ANALYZE_SETTLE_DELAY, quickNoteSelectors, useQuickNoteStore } from '@/store/quickNote';

import { styles } from './style';
import { useAnalyzeCountdown } from './useAnalyzeCountdown';

const AnalyzeAction = ({ noteId }: { noteId: string }) => {
  const { t } = useTranslation('note');
  const [exists, hasContent, runStatus, runKind, analyzeDueAt] = useQuickNoteStore((s) => {
    const note = quickNoteSelectors.noteById(noteId)(s);
    return [
      Boolean(note),
      Boolean(note?.content.trim()),
      note?.run?.status,
      note?.run?.kind,
      note?.analyzeDueAt,
    ] as const;
  });
  const requesting = useQuickNoteStore(quickNoteSelectors.isAnalyzing(noteId));
  const analyzeNote = useQuickNoteStore((s) => s.analyzeNote);

  const runActive = runStatus === 'pending' || runStatus === 'running';
  const dueAt = runActive ? undefined : analyzeDueAt;

  const remaining = useAnalyzeCountdown(dueAt);

  if (!exists) return null;

  const scheduled = remaining > 0;
  const circumference = 2 * Math.PI * 12;
  const progress = Math.min(1, remaining / ANALYZE_SETTLE_DELAY);
  const status = runKind === 'analyze' ? runStatus : undefined;
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
    <span className={stylex.props(styles.analyzeAction).className}>
      <ActionIcon
        aria-label={title}
        disabled={!hasContent || runActive}
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
          className={stylex.props(styles.analyzeProgress).className}
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
