'use client';

import type { VerifyTerminalEvidenceMetadata } from '@lobechat/types';
import { formatSize } from '@lobechat/utils/format';
import { Alert, CopyButton, Tag } from '@lobehub/ui';
import dayjs from 'dayjs';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { formatTerminalDuration, terminalOutcomeLabel, terminalOutcomeTone } from './model';
import { styles } from './styles';

const TONE_COLOR = { error: 'error', neutral: undefined, success: 'success', warning: 'warning' };

/** How the execution ended — the first fact a reader looks for. */
export const TerminalOutcomeBadge = memo<{
  execution: VerifyTerminalEvidenceMetadata['execution'];
}>(({ execution }) => {
  const { t } = useTranslation('verify');
  const label = terminalOutcomeLabel(execution);
  return (
    <Tag color={TONE_COLOR[terminalOutcomeTone(execution)]} size={'small'}>
      {t(label.key as 'report.terminal.outcome.unknown', label.values)}
    </Tag>
  );
});

TerminalOutcomeBadge.displayName = 'TerminalOutcomeBadge';

/**
 * Where the observation came from. A declaration, never an attestation — the
 * tooltip says what the label means, not that it was verified. `authored`
 * reads as an example in warning tone so it cannot pass for a real run.
 */
export const TerminalSourceBadge = memo<{ source: VerifyTerminalEvidenceMetadata['source'] }>(
  ({ source }) => {
    const { t } = useTranslation('verify');
    return (
      <Tag
        color={source.kind === 'authored' ? 'warning' : undefined}
        size={'small'}
        title={t(`report.terminal.source.${source.kind}Hint`)}
      >
        {t(`report.terminal.source.${source.kind}`)}
      </Tag>
    );
  },
);

TerminalSourceBadge.displayName = 'TerminalSourceBadge';

const EnvironmentSummary = memo<{ env: Record<string, string> }>(({ env }) => {
  const { t } = useTranslation('verify');
  const [open, setOpen] = useState(false);
  const entries = Object.entries(env);
  return (
    <div className={styles.inlineList}>
      {open &&
        entries.map(([key, value]) => (
          <span className={styles.mono} key={key}>
            {key}={value}
          </span>
        ))}
      <button
        aria-expanded={open}
        className={styles.linkButton}
        type={'button'}
        onClick={() => setOpen(!open)}
      >
        {open
          ? t('report.terminal.env.hide')
          : t('report.terminal.env.show', { count: entries.length })}
      </button>
    </div>
  );
});

EnvironmentSummary.displayName = 'EnvironmentSummary';

/**
 * The result row: the outcome badge is the readable summary ("failed to
 * start", "capture failed"); the capturer's raw error stays one click away
 * instead of being dumped beside it.
 */
const ExecutionResult = memo<{ execution: VerifyTerminalEvidenceMetadata['execution'] }>(
  ({ execution }) => {
    const { t } = useTranslation('verify');
    const [open, setOpen] = useState(false);
    return (
      <>
        <div className={styles.inlineList}>
          <TerminalOutcomeBadge execution={execution} />
          {execution.error && (
            <button
              aria-expanded={open}
              className={styles.linkButton}
              type={'button'}
              onClick={() => setOpen(!open)}
            >
              {t(open ? 'report.terminal.error.hide' : 'report.terminal.error.show')}
            </button>
          )}
        </div>
        {open && execution.error && <div className={styles.mono}>{execution.error}</div>}
      </>
    );
  },
);

ExecutionResult.displayName = 'ExecutionResult';

/**
 * The execution record: the command (copyable, never runnable), where and when
 * it ran, how it ended, how it was observed, and everything processing did to
 * the output — redactions, truncation, unknown fields — so a reader judges the
 * output knowing what is not in it.
 */
export const TerminalFacts = memo<{ terminal: VerifyTerminalEvidenceMetadata }>(({ terminal }) => {
  const { t } = useTranslation('verify');
  const { capture, execution, processing, source } = terminal;
  // `parseTerminalEvidenceMetadata` already fills these; the defaults keep the
  // card safe for any record that reaches it some other way.
  const { environmentSummary: env = {} } = execution;
  const { missingFields = [], notes = [], redactions = [], truncation = [] } = processing;
  const capturer = capture.capturer
    ? [capture.capturer.name, capture.capturer.version].filter(Boolean).join(' ')
    : undefined;
  const origin = [source.originalTool, source.originalRecordRef].filter(Boolean).join(' · ');
  const started = execution.startedAt ? dayjs(execution.startedAt) : undefined;

  return (
    <>
      {source.kind === 'authored' && (
        <Alert showIcon title={t('report.terminal.authoredNotice')} type={'warning'} />
      )}
      <div className={styles.command}>
        <pre className={styles.commandText}>
          <span className={styles.commandPrompt}>$ </span>
          {execution.command ?? t('report.terminal.commandUnknown')}
        </pre>
        {execution.command && (
          <CopyButton
            content={execution.command}
            size={'small'}
            title={t('report.terminal.copyCommand')}
          />
        )}
      </div>
      <dl className={styles.facts}>
        <dt>{t('report.terminal.fact.result')}</dt>
        <dd>
          <ExecutionResult execution={execution} />
        </dd>
        <dt>{t('report.terminal.fact.cwd')}</dt>
        <dd className={execution.cwd ? styles.mono : undefined}>
          {execution.cwd ?? t('report.terminal.fact.unknown')}
        </dd>
        <dt>{t('report.terminal.fact.time')}</dt>
        <dd>
          {[
            started?.isValid() ? started.format('YYYY-MM-DD HH:mm:ss') : undefined,
            execution.durationMs === null
              ? undefined
              : formatTerminalDuration(execution.durationMs),
          ]
            .filter(Boolean)
            .join(' · ') || t('report.terminal.fact.unknown')}
        </dd>
        <dt>{t('report.terminal.fact.source')}</dt>
        <dd className={styles.inlineList}>
          <TerminalSourceBadge source={source} />
          {origin && <span>{origin}</span>}
        </dd>
        <dt>{t('report.terminal.fact.capture')}</dt>
        <dd className={styles.inlineList}>
          <span>{t(`report.terminal.mode.${capture.mode}`)}</span>
          {capture.timing === 'recorded' && <span>{t('report.terminal.timing.recorded')}</span>}
          {capture.terminal && (
            <span className={styles.mono}>
              {capture.terminal.cols}×{capture.terminal.rows}
              {capture.terminal.type ? ` ${capture.terminal.type}` : ''}
            </span>
          )}
          {capturer && <span>{capturer}</span>}
        </dd>
        {Object.keys(env).length > 0 && (
          <>
            <dt>{t('report.terminal.fact.environment')}</dt>
            <dd>
              <EnvironmentSummary env={env} />
            </dd>
          </>
        )}
        {redactions.length > 0 && (
          <>
            <dt>{t('report.terminal.processing.redacted')}</dt>
            <dd className={styles.inlineList}>
              {redactions.map((redaction) => (
                <span key={redaction.rule}>
                  <span className={styles.mono}>{redaction.rule}</span> ×{redaction.count}
                </span>
              ))}
            </dd>
          </>
        )}
        {truncation.length > 0 && (
          <>
            <dt>{t('report.terminal.processing.truncated')}</dt>
            <dd className={styles.inlineList}>
              {truncation.map((item) => (
                <span key={item.stream}>
                  {t('report.terminal.processing.truncatedItem', {
                    dropped: formatSize(item.droppedBytes),
                    kept: formatSize(item.keptBytes),
                    stream: item.stream,
                  })}
                </span>
              ))}
            </dd>
          </>
        )}
        {missingFields.length > 0 && (
          <>
            <dt>{t('report.terminal.processing.missing')}</dt>
            <dd className={styles.mono}>{missingFields.join(', ')}</dd>
          </>
        )}
        {notes.length > 0 && (
          <>
            <dt>{t('report.terminal.processing.notes')}</dt>
            <dd>
              {notes.map((note, index) => (
                <div key={index}>{note}</div>
              ))}
            </dd>
          </>
        )}
      </dl>
    </>
  );
});

TerminalFacts.displayName = 'TerminalFacts';
