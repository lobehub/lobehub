'use client';

import { Alert, cx, Icon, Segmented, type SegmentedOption, Spin } from '@lobehub/ui';
import { ChevronRight, SquareTerminal } from 'lucide-react';
import { lazy, memo, Suspense, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  formatTerminalDuration,
  resolveTerminalViews,
  type TerminalEvidenceInput,
  terminalFoldTitle,
  type TerminalTextViewKey,
} from './model';
import { styles } from './styles';
import { TerminalFacts, TerminalOutcomeBadge, TerminalSourceBadge } from './TerminalFacts';
import { TerminalOutput } from './TerminalOutput';

// xterm is only needed once a reader opens Replay — keep it out of the page bundle.
const TerminalPlayer = lazy(() => import('./TerminalPlayer'));

type BodyView = TerminalTextViewKey | 'replay';

const downloadNameFor = (key: TerminalTextViewKey, fileName?: string | null) =>
  key === 'transcript' && fileName ? fileName : `terminal-${key}.txt`;

/**
 * One command execution, folded to a single titled row like other text
 * evidence. The row already answers the reader's first questions — which
 * command, how it ended, and (when it is not a live capture) where the
 * observation came from — so the list stays scannable.
 *
 * Expanded, the execution record comes before the output: command, directory,
 * time, source, capture mode and every processing step that changed what the
 * output shows. The body opens on static text — stdout / stderr apart for a
 * pipe capture, one merged output for a pty — with Replay offered only when a
 * real recording exists, and the stored transcript always one click away so
 * the record is reviewable without the player.
 */
export const TerminalEvidenceCard = memo<{
  /** Open on mount — a before/after pair is read side by side, not one fold at a time. */
  defaultExpanded?: boolean;
  evidence: TerminalEvidenceInput;
}>(({ defaultExpanded = false, evidence }) => {
  const { t } = useTranslation('verify');
  const [expanded, setExpanded] = useState(defaultExpanded);
  const plan = useMemo(
    () => resolveTerminalViews(evidence),
    // The row object is rebuilt on every bundle refresh; its parts are what matter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [evidence.content, evidence.fileUrl, evidence.metadata, evidence.terminalArtifacts],
  );
  const [selected, setSelected] = useState<BodyView>(plan.defaultView);
  const { terminal } = plan;

  // A refreshed bundle can drop a view (e.g. an expired link); fall back rather than blank.
  const available = new Set<BodyView>([
    ...plan.views.map((view) => view.key),
    ...(plan.replayUrl ? (['replay'] as const) : []),
  ]);
  const current: BodyView = available.has(selected) ? selected : plan.defaultView;
  const textView = plan.views.find((view) => view.key === current);

  const command = terminal?.execution.command?.trim();
  const title = terminalFoldTitle(terminal, evidence) || t('report.terminal.title');
  const description = evidence.description?.trim();
  const showDescription = Boolean(description) && description !== title;
  const duration =
    terminal?.execution.durationMs === null || terminal?.execution.durationMs === undefined
      ? undefined
      : formatTerminalDuration(terminal.execution.durationMs);

  const badges = terminal && (
    <>
      <TerminalOutcomeBadge execution={terminal.execution} />
      {/* A live capture is the expected case; only the exceptions earn row space. */}
      {terminal.source.kind !== 'captured' && <TerminalSourceBadge source={terminal.source} />}
    </>
  );

  const options: SegmentedOption<BodyView>[] = [
    ...plan.views
      .filter((view) => view.key !== 'transcript')
      .map((view) => {
        const empty = view.source.kind === 'empty';
        return {
          disabled: empty && view.key !== current,
          label: t(`report.terminal.view.${view.key}`),
          title: empty ? t('report.terminal.view.streamEmpty', { stream: view.key }) : undefined,
          value: view.key as BodyView,
        };
      }),
    ...(plan.replayUrl
      ? [{ label: t('report.terminal.view.replay'), value: 'replay' as BodyView }]
      : []),
    ...(plan.views.some((view) => view.key === 'transcript')
      ? [
          {
            label: t('report.terminal.view.transcript'),
            title: t('report.terminal.view.transcriptHint'),
            value: 'transcript' as BodyView,
          },
        ]
      : []),
  ];

  return (
    <div>
      <button
        aria-expanded={expanded}
        className={styles.foldHeader}
        title={t(expanded ? 'report.evidence.collapse' : 'report.evidence.expand')}
        type={'button'}
        onClick={() => setExpanded(!expanded)}
      >
        <Icon
          className={cx(styles.foldChevron, expanded && styles.foldChevronOpen)}
          icon={ChevronRight}
          size={14}
        />
        <span className={styles.foldIcon}>
          <Icon icon={SquareTerminal} size={13} />
        </span>
        <span data-fold-title className={styles.foldTitle}>
          {command ? `$ ${title}` : title}
        </span>
        <span className={styles.foldMeta}>
          {badges}
          {duration && <span>{duration}</span>}
        </span>
      </button>
      {terminal && <div className={styles.foldMetaMobile}>{badges}</div>}
      {showDescription && <div className={styles.description}>{description}</div>}
      {expanded && (
        <div className={styles.body}>
          {terminal ? (
            <TerminalFacts terminal={terminal} />
          ) : (
            <Alert showIcon title={t('report.terminal.invalidRecord')} type={'info'} />
          )}
          {options.length > 1 && (
            <Segmented
              options={options}
              size={'small'}
              style={{ alignSelf: 'flex-start', maxWidth: '100%' }}
              value={current}
              onChange={(value) => setSelected(value)}
            />
          )}
          {current === 'replay' && plan.replayUrl ? (
            <Suspense
              fallback={
                <div className={styles.outputState}>
                  <Spin size={'large'} />
                </div>
              }
            >
              <TerminalPlayer url={plan.replayUrl} />
            </Suspense>
          ) : textView ? (
            <TerminalOutput
              downloadName={downloadNameFor(textView.key, evidence.fileName)}
              key={textView.key}
              view={textView}
            />
          ) : (
            <div className={styles.outputState}>{t('report.terminal.output.unavailable')}</div>
          )}
        </div>
      )}
    </div>
  );
});

TerminalEvidenceCard.displayName = 'TerminalEvidenceCard';
