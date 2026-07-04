'use client';

import type { VerifyRunContext } from '@lobechat/types';
import {
  Block,
  Center,
  Empty,
  Flexbox,
  Highlighter,
  Icon,
  Image,
  Markdown,
  Text,
} from '@lobehub/ui';
import { Button, Modal } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import type { TFunction } from 'i18next';
import {
  AlertTriangle,
  Check,
  ChevronRight,
  CircleHelp,
  Clock3,
  FileText,
  Paperclip,
  RefreshCw,
  X,
} from 'lucide-react';
import { memo, type ReactNode, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';

import Loading from '@/components/Loading/BrandTextLoading';
import { useTextFileLoader } from '@/features/FileViewer/hooks/useTextFileLoader';
import type { VerifyEvidenceWithUrl, VerifyResultWithEvidence } from '@/services/verify';
import { getLanguageFromFilename } from '@/utils/fileLanguage';

import { useVerifyReportBundle } from './hooks';

type Verdict = 'passed' | 'failed' | 'uncertain';
type Filter = 'all' | Verdict;

/** Best-effort filename from a (possibly signed) file URL, for syntax highlighting. */
const filenameFromUrl = (url: string): string => {
  try {
    return new URL(url).pathname.split('/').pop() || 'document';
  } catch {
    return 'document';
  }
};

const styles = createStaticStyles(({ css }) => ({
  scroll: css`
    overflow: auto;
    width: 100%;
    height: 100%;
  `,
  page: css`
    width: 100%;
    max-width: 840px;
    margin-inline: auto;
    padding-block: 32px 64px;
    padding-inline: 32px;
  `,

  /* hero */
  heroLine: css`
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
    align-items: center;
  `,
  pill: css`
    display: inline-flex;
    gap: 6px;
    align-items: center;

    padding-block: 5px;
    padding-inline: 13px;
    border-radius: 999px;

    font-size: 13px;
    font-weight: 600;
    line-height: 1;
  `,
  summary: css`
    max-width: 64ch;
    color: ${cssVar.colorTextSecondary};
  `,
  meta: css`
    display: flex;
    flex-wrap: wrap;
    gap: 8px 16px;
    margin-block-start: 4px;
  `,
  metaItem: css`
    display: inline-flex;
    gap: 6px;
    align-items: baseline;

    font-size: 12px;
    color: ${cssVar.colorTextTertiary};

    code {
      font-family: ${cssVar.fontFamilyCode};
      font-size: 12px;
      color: ${cssVar.colorTextSecondary};
      word-break: break-word;
    }
  `,
  liveBanner: css`
    display: inline-flex;
    gap: 8px;
    align-items: center;

    width: fit-content;
    margin-block-start: 4px;
    padding-block: 6px;
    padding-inline: 12px;
    border: 1px solid ${cssVar.colorInfoBorder};
    border-radius: 999px;

    font-size: 12px;
    color: ${cssVar.colorInfoText};

    background: ${cssVar.colorInfoBg};
  `,

  /* sticky filter chips */
  stats: css`
    position: sticky;
    z-index: 10;
    inset-block-start: 0;

    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;

    margin-block: 20px 12px;
    padding-block: 12px;

    background: color-mix(in srgb, ${cssVar.colorBgLayout} 88%, transparent);
    backdrop-filter: blur(8px);
  `,
  chip: css`
    cursor: pointer;

    display: inline-flex;
    gap: 7px;
    align-items: center;

    height: 28px;
    padding-inline: 12px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: 999px;

    font-size: 12px;
    color: ${cssVar.colorTextSecondary};

    background: transparent;

    transition: background 0.12s ease;

    b {
      font-family: ${cssVar.fontFamilyCode};
      font-weight: 600;
      font-variant-numeric: tabular-nums;
      color: ${cssVar.colorText};
    }

    &:hover {
      background: ${cssVar.colorFillTertiary};
    }

    &[data-active='true'] {
      border-color: ${cssVar.colorBorder};
      color: ${cssVar.colorText};
      background: ${cssVar.colorFillTertiary};
    }
  `,
  dot: css`
    width: 7px;
    height: 7px;
    border-radius: 999px;
  `,
  score: css`
    cursor: default;
    margin-inline-start: auto;
    border-color: transparent;
    color: ${cssVar.colorTextTertiary};

    b {
      color: ${cssVar.colorTextSecondary};
    }
  `,

  /* checks */
  checks: css`
    overflow: hidden;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadius};
    background: ${cssVar.colorBgContainer};
  `,
  row: css`
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};

    &:last-child {
      border-block-end: none;
    }
  `,
  rowHead: css`
    cursor: pointer;

    display: grid;
    grid-template-columns: 20px minmax(0, 1fr) auto;
    gap: 10px;
    align-items: center;

    width: 100%;
    padding-block: 11px;
    padding-inline: 16px;
    border: none;

    text-align: start;

    background: none;

    &:hover {
      background: ${cssVar.colorFillQuaternary};
    }
  `,
  rowTitle: css`
    overflow: hidden;

    font-size: 14px;
    color: ${cssVar.colorText};
    text-overflow: ellipsis;
    white-space: nowrap;

    &[data-failed='true'] {
      font-weight: 600;
    }
  `,
  rowSide: css`
    display: flex;
    gap: 8px;
    align-items: center;
  `,
  softTag: css`
    padding-block: 1px;
    padding-inline: 7px;
    border-radius: 4px;

    font-size: 12px;
    color: ${cssVar.colorTextTertiary};

    background: ${cssVar.colorFillTertiary};
  `,
  chev: css`
    color: ${cssVar.colorTextQuaternary};
    transition: transform 0.15s ease;

    &[data-open='true'] {
      transform: rotate(90deg);
    }
  `,
  rowBody: css`
    display: flex;
    flex-direction: column;
    gap: 12px;

    padding-block: 2px 16px;
    padding-inline: 46px 16px;
  `,
  reasoning: css`
    max-width: 70ch;
    font-size: 13px;
    line-height: 1.6;
    color: ${cssVar.colorTextSecondary};
  `,
  suggestion: css`
    max-width: 70ch;
    padding-inline-start: 10px;
    border-inline-start: 2px solid ${cssVar.colorBorder};

    font-size: 13px;
    line-height: 1.6;
    color: ${cssVar.colorTextSecondary};
  `,

  /* narrative */
  narrative: css`
    margin-block-start: 24px;
  `,
  narrativeSummary: css`
    cursor: pointer;
    user-select: none;

    display: inline-flex;
    gap: 6px;
    align-items: center;

    font-size: 12px;
    color: ${cssVar.colorTextTertiary};
    list-style: none;

    &::-webkit-details-marker {
      display: none;
    }

    &:hover {
      color: ${cssVar.colorText};
    }
  `,
  narrativeBody: css`
    margin-block-start: 12px;
    padding: 16px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadius};

    background: ${cssVar.colorBgContainer};
  `,

  /* evidence */
  evidenceList: css`
    display: flex;
    flex-direction: column;
    gap: 6px;
    align-items: flex-start;

    max-width: 70ch;
  `,
  evidenceFile: css`
    cursor: pointer;

    display: grid;
    grid-template-columns: 18px minmax(0, 1fr);
    gap: 8px;
    align-items: center;

    width: min(100%, 520px);
    padding-block: 7px;
    padding-inline: 10px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadius};

    text-align: start;

    background: ${cssVar.colorFillQuaternary};

    &:hover {
      border-color: ${cssVar.colorLink};
      color: ${cssVar.colorLink};
    }
  `,
  evidenceFileIcon: css`
    display: flex;
    color: ${cssVar.colorTextTertiary};
  `,
  evidenceFileBody: css`
    display: flex;
    flex-direction: column;
    min-width: 0;
  `,
  evidenceFileName: css`
    overflow: hidden;

    font-size: 13px;
    line-height: 1.35;
    color: ${cssVar.colorText};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  evidenceFileDesc: css`
    overflow: hidden;

    margin-block-start: 2px;

    font-size: 12px;
    line-height: 1.35;
    color: ${cssVar.colorTextTertiary};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  evidenceText: css`
    overflow: auto;

    max-height: 200px;
    padding-block: 8px;
    padding-inline: 12px;
    border-radius: ${cssVar.borderRadius};

    font-family: ${cssVar.fontFamilyCode};
    font-size: 12px;
    white-space: pre-wrap;

    background: ${cssVar.colorFillQuaternary};
  `,
  evidenceVideo: css`
    align-self: flex-start;

    width: auto;
    max-width: 100%;
    max-height: 360px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};

    object-fit: contain;
  `,
  evChip: css`
    display: inline-flex;
    gap: 4px;
    align-items: center;

    padding-block: 1px;
    padding-inline: 6px;
    border-radius: 999px;

    font-family: ${cssVar.fontFamilyCode};
    font-size: 12px;
    font-variant-numeric: tabular-nums;
    color: ${cssVar.colorTextTertiary};

    background: ${cssVar.colorFillTertiary};
  `,
  evidenceDoc: css`
    overflow: hidden;

    width: 100%;
    height: 320px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadius};
  `,
  docViewer: css`
    overflow: auto;
    height: 100%;
    padding-block: 12px;
    padding-inline: 16px;
  `,
}));

const VERDICT_META: Record<
  Verdict,
  { bg: string; color: string; dot: string; icon: typeof Check; labelKey: string }
> = {
  failed: {
    bg: cssVar.colorErrorBg,
    color: cssVar.colorErrorText,
    dot: cssVar.colorError,
    icon: X,
    labelKey: 'report.verdict.failed',
  },
  passed: {
    bg: cssVar.colorSuccessBg,
    color: cssVar.colorSuccessText,
    dot: cssVar.colorSuccess,
    icon: Check,
    labelKey: 'report.verdict.passed',
  },
  uncertain: {
    bg: cssVar.colorWarningBg,
    color: cssVar.colorWarningText,
    dot: cssVar.colorWarning,
    icon: CircleHelp,
    labelKey: 'report.verdict.uncertain',
  },
};

const imageEvidenceTypes = new Set(['gif', 'screenshot']);
const isInlineImageEvidence = (evidence: VerifyEvidenceWithUrl) =>
  Boolean(evidence.fileUrl && imageEvidenceTypes.has(evidence.type));
const terminalRunStatuses = new Set(['delivered', 'failed', 'passed']);
const liveStatusLabelKey = {
  planned: 'report.status.planned',
  repairing: 'report.status.repairing',
  unverified: 'report.status.unverified',
  verifying: 'report.status.verifying',
} as const;

/** Severity-first sort: failed → uncertain → passed. */
const SEVERITY_RANK: Record<Verdict, number> = { failed: 0, passed: 2, uncertain: 1 };

const checkVerdict = (result: VerifyResultWithEvidence): Verdict => {
  const v = result.verdict ?? result.status;
  if (v === 'passed' || v === 'failed' || v === 'uncertain') return v;
  return 'uncertain';
};

const evidenceDisplayName = (
  evidence: VerifyEvidenceWithUrl,
  t: TFunction<'verify'>,
  index: number,
) =>
  evidence.fileName ||
  (evidence.fileUrl ? filenameFromUrl(evidence.fileUrl) : '') ||
  evidence.description ||
  t('report.evidence.inlineFallback', { index });

/** A file-backed text evidence, decoded + syntax highlighted (avoids mojibake). */
const DocumentViewer = memo<{ fileName?: string | null; url: string }>(({ fileName, url }) => {
  const { t } = useTranslation('verify');
  const { fileData, loading, error } = useTextFileLoader(url);

  if (loading)
    return (
      <Center flex={1} height={'100%'}>
        <Loading debugId="verify-document-viewer" />
      </Center>
    );

  if (error || fileData === null)
    return (
      <Center flex={1} gap={8} height={'100%'}>
        <Text type="secondary">{t('report.document.failed')}</Text>
        <a href={url} rel="noreferrer" target="_blank">
          {t('report.document.openOriginal')}
        </a>
      </Center>
    );

  return (
    <Flexbox className={styles.docViewer}>
      <Highlighter
        wrap
        language={getLanguageFromFilename(fileName || filenameFromUrl(url))}
        showLanguage={false}
        variant={'borderless'}
      >
        {fileData}
      </Highlighter>
    </Flexbox>
  );
});

/** One evidence artifact rendered by its type: zoomable image/gif, video, doc, text. */
const EvidenceItem = memo<{ evidence: VerifyEvidenceWithUrl; index: number }>(
  ({ evidence: e, index }) => {
    const { t } = useTranslation('verify');
    const label = evidenceDisplayName(e, t, index);
    const description = e.description && e.description !== label ? e.description : null;

    return (
      <Flexbox gap={6}>
        <Text strong fontSize={13}>
          {label}
        </Text>
        {description && (
          <Text fontSize={13} type={'secondary'}>
            {description}
          </Text>
        )}
        {e.fileUrl && imageEvidenceTypes.has(e.type) ? (
          <Flexbox align={'flex-start'} style={{ maxWidth: '100%' }}>
            <Image
              preview
              alt={e.description ?? label}
              objectFit={'contain'}
              src={e.fileUrl}
              style={{ maxHeight: 360, maxWidth: '100%' }}
              variant={'outlined'}
            />
          </Flexbox>
        ) : e.fileUrl && e.type === 'video' ? (
          <video controls className={styles.evidenceVideo} src={e.fileUrl} />
        ) : e.fileUrl ? (
          <div className={styles.evidenceDoc}>
            <DocumentViewer fileName={e.fileName} url={e.fileUrl} />
          </div>
        ) : e.content ? (
          <div className={styles.evidenceText}>{e.content}</div>
        ) : (
          <span className={styles.softTag}>{e.type}</span>
        )}
      </Flexbox>
    );
  },
);

const EvidenceFileButton = memo<{
  evidence: VerifyEvidenceWithUrl;
  index: number;
  onClick: () => void;
}>(({ evidence, index, onClick }) => {
  const { t } = useTranslation('verify');
  const name = evidenceDisplayName(evidence, t, index);
  const description =
    evidence.description && evidence.description !== name ? evidence.description : null;

  return (
    <button
      className={styles.evidenceFile}
      title={t('report.evidence.openDetail', { name })}
      type={'button'}
      onClick={onClick}
    >
      <span className={styles.evidenceFileIcon}>
        <Icon icon={Paperclip} size={13} />
      </span>
      <span className={styles.evidenceFileBody}>
        <span className={styles.evidenceFileName}>{name}</span>
        {description && <span className={styles.evidenceFileDesc}>{description}</span>}
      </span>
    </button>
  );
});

EvidenceFileButton.displayName = 'EvidenceFileButton';

/** Modal gallery of one check's evidence — one section per artifact, by type. */
const EvidenceModal = memo<{
  evidence: VerifyEvidenceWithUrl[];
  onClose: () => void;
  open: boolean;
  title: string;
}>(({ evidence, onClose, open, title }) => (
  <Modal
    footer={null}
    open={open}
    title={title}
    width={'min(760px, 92vw)'}
    onCancel={() => onClose()}
  >
    <Flexbox gap={20} style={{ maxHeight: '68vh', overflow: 'auto', paddingBlock: 4 }}>
      {evidence.map((e, index) => (
        <EvidenceItem evidence={e} index={index + 1} key={e.id} />
      ))}
    </Flexbox>
  </Modal>
));

EvidenceItem.displayName = 'EvidenceItem';

EvidenceModal.displayName = 'EvidenceModal';

/** One check — an expandable row; evidence opens one artifact at a time. */
const CheckRow = memo<{ defaultOpen: boolean; result: VerifyResultWithEvidence }>(
  ({ defaultOpen, result }) => {
    const { t } = useTranslation('verify');
    const [open, setOpen] = useState(defaultOpen);
    const [selectedEvidenceId, setSelectedEvidenceId] = useState<string | null>(null);
    const verdict = checkVerdict(result);
    const meta = VERDICT_META[verdict];
    const evidenceCount = result.evidence.length;
    const hasBody =
      Boolean(result.toulmin?.evidence) || Boolean(result.suggestion) || evidenceCount > 0;
    const selectedEvidenceIndex = selectedEvidenceId
      ? result.evidence.findIndex((e) => e.id === selectedEvidenceId)
      : -1;
    const selectedEvidence =
      selectedEvidenceIndex >= 0 ? result.evidence[selectedEvidenceIndex] : null;

    return (
      <div className={styles.row}>
        <button
          className={styles.rowHead}
          type={'button'}
          onClick={() => hasBody && setOpen((o) => !o)}
        >
          <span style={{ color: meta.dot, display: 'flex' }}>
            <Icon icon={meta.icon} size={16} />
          </span>
          <span className={styles.rowTitle} data-failed={verdict === 'failed'}>
            {result.checkItemTitle || result.checkItemId}
          </span>
          <span className={styles.rowSide}>
            {evidenceCount > 0 && (
              <span
                className={styles.evChip}
                title={t('report.evidence.count', { count: evidenceCount })}
              >
                <Icon icon={Paperclip} size={12} />
                {evidenceCount}
              </span>
            )}
            {!result.required && (
              <span className={styles.softTag}>{t('report.check.optional')}</span>
            )}
            {hasBody && (
              <Icon className={styles.chev} data-open={open} icon={ChevronRight} size={14} />
            )}
          </span>
        </button>
        {open && hasBody && (
          <div className={styles.rowBody}>
            {result.toulmin?.evidence && (
              <p className={styles.reasoning}>{result.toulmin.evidence}</p>
            )}
            {result.suggestion && <p className={styles.suggestion}>{result.suggestion}</p>}
            {evidenceCount > 0 && (
              <>
                <div className={styles.evidenceList}>
                  {result.evidence.map((e, index) =>
                    isInlineImageEvidence(e) ? (
                      <EvidenceItem evidence={e} index={index + 1} key={e.id} />
                    ) : (
                      <EvidenceFileButton
                        evidence={e}
                        index={index + 1}
                        key={e.id}
                        onClick={() => setSelectedEvidenceId(e.id)}
                      />
                    ),
                  )}
                </div>
                {selectedEvidence && (
                  <EvidenceModal
                    evidence={[selectedEvidence]}
                    open={Boolean(selectedEvidence)}
                    title={evidenceDisplayName(selectedEvidence, t, selectedEvidenceIndex + 1)}
                    onClose={() => setSelectedEvidenceId(null)}
                  />
                )}
              </>
            )}
          </div>
        )}
      </div>
    );
  },
);

CheckRow.displayName = 'CheckRow';

const ReportPageState = memo<{
  action?: ReactNode;
  description: string;
  icon: typeof AlertTriangle;
  title: string;
}>(({ action, description, icon, title }) => (
  <Center gap={16} height={'100%'} style={{ minHeight: '70vh' }} width={'100%'}>
    <Empty description={description} icon={icon} title={title} />
    {action}
  </Center>
));

/** Build the meta row (branch / commit / surface / verified) from the run scope. */
const scopeToMeta = (
  context: VerifyRunContext | null | undefined,
  scenario: string | null | undefined,
  t: TFunction<'verify'>,
): { label: string; value: string }[] => {
  if (scenario !== 'coding' || !context) return [];
  const { branch, commit, surfaces, entry, focus, testedAt } = context;
  const surface = surfaces && surfaces.length > 0 ? surfaces.join(' / ') : undefined;
  const date = testedAt ? new Date(testedAt).toLocaleString() : undefined;
  return (
    [
      { label: t('report.scope.focus'), value: focus },
      { label: t('report.scope.branch'), value: branch },
      { label: t('report.scope.surface'), value: surface },
      { label: t('report.scope.entry'), value: entry },
      { label: t('report.scope.commit'), value: commit },
      { label: t('report.scope.date'), value: date },
    ] as { label: string; value?: string | null }[]
  ).filter((m): m is { label: string; value: string } => Boolean(m.value));
};

/**
 * The report detail pane. Renders the verdict hero, a sticky verdict-filter bar,
 * every check as a severity-ordered expandable row (failed rows open by default),
 * and the full narrative behind a collapsed disclosure. Addressed by `:runId`;
 * refreshes itself while the run is non-terminal.
 */
const ReportViewer = memo(() => {
  const { t } = useTranslation('verify');
  const { runId } = useParams<{ runId: string }>();
  const verifyRunId = runId ?? null;
  const { data, error, isLoading, mutate } = useVerifyReportBundle(verifyRunId);
  const [filter, setFilter] = useState<Filter>('all');

  useEffect(() => {
    const status = data?.run.status;
    if (!status || terminalRunStatuses.has(status)) return;
    const timer = window.setInterval(() => void mutate(), 5000);
    return () => window.clearInterval(timer);
  }, [data?.run.status, mutate]);

  const ordered = useMemo(() => {
    if (!data) return [];
    return [...data.results].sort(
      (a, b) => SEVERITY_RANK[checkVerdict(a)] - SEVERITY_RANK[checkVerdict(b)],
    );
  }, [data]);

  if (!verifyRunId) {
    return (
      <ReportPageState
        description={t('report.missing.description')}
        icon={AlertTriangle}
        title={t('report.missing.title')}
      />
    );
  }
  if (isLoading) return <Loading debugId="verify-report-viewer" />;
  if (error) {
    return (
      <ReportPageState
        description={t('report.error.description')}
        icon={X}
        title={t('report.error.title')}
        action={
          <Button icon={<RefreshCw size={16} />} onClick={() => void mutate()}>
            {t('report.actions.retry')}
          </Button>
        }
      />
    );
  }
  if (!data) {
    return (
      <ReportPageState
        description={t('report.notFound.description')}
        icon={FileText}
        title={t('report.notFound.title')}
      />
    );
  }

  const { run, report } = data;
  const liveStatus =
    run.status && !terminalRunStatuses.has(run.status)
      ? (run.status as keyof typeof liveStatusLabelKey)
      : null;

  const counts = ordered.reduce(
    (acc, r) => {
      acc[checkVerdict(r)] += 1;
      return acc;
    },
    { failed: 0, passed: 0, uncertain: 0 } as Record<Verdict, number>,
  );
  const total = report?.totalChecks ?? ordered.length;
  const passed = report?.passedChecks ?? counts.passed;
  const failed = report?.failedChecks ?? counts.failed;
  const uncertain = report?.uncertainChecks ?? counts.uncertain;
  const verdict = (report?.verdict as Verdict | null) ?? null;
  const visible = filter === 'all' ? ordered : ordered.filter((r) => checkVerdict(r) === filter);
  const meta = scopeToMeta(run.context, run.scenario, t);

  const chips: { count: number; dot?: string; key: Filter; label: string }[] = [
    { count: total, key: 'all', label: t('report.filter.all') },
    { count: failed, dot: cssVar.colorError, key: 'failed', label: t('report.filter.failed') },
    {
      count: uncertain,
      dot: cssVar.colorWarning,
      key: 'uncertain',
      label: t('report.filter.uncertain'),
    },
    { count: passed, dot: cssVar.colorSuccess, key: 'passed', label: t('report.filter.passed') },
  ];

  return (
    <div className={styles.scroll}>
      <div className={styles.page}>
        <Flexbox gap={12}>
          <div className={styles.heroLine}>
            {verdict && (
              <span
                className={styles.pill}
                style={{ background: VERDICT_META[verdict].bg, color: VERDICT_META[verdict].color }}
              >
                <Icon icon={VERDICT_META[verdict].icon} size={15} />
                {t(`report.verdict.${verdict}`)}
              </span>
            )}
            <Text as={'h1'} style={{ fontSize: 24, lineHeight: 1.3, margin: 0 }}>
              {run.title || t('report.titleFallback')}
            </Text>
          </div>

          {run.scenario !== 'coding' && run.goal && (
            <Text className={styles.summary}>{run.goal}</Text>
          )}
          {report?.summary && <Text className={styles.summary}>{report.summary}</Text>}

          {meta.length > 0 && (
            <div className={styles.meta}>
              {meta.map((m) => (
                <span className={styles.metaItem} key={m.label}>
                  {m.label} <code>{m.value}</code>
                </span>
              ))}
            </div>
          )}

          {liveStatus && (
            <div className={styles.liveBanner}>
              <Icon icon={Clock3} size={14} />
              {t(liveStatusLabelKey[liveStatus])}
            </div>
          )}
        </Flexbox>

        <div className={styles.stats}>
          {chips.map((c) => (
            <button
              className={styles.chip}
              data-active={filter === c.key}
              key={c.key}
              type={'button'}
              onClick={() => setFilter(c.key)}
            >
              {c.dot && <span className={styles.dot} style={{ background: c.dot }} />}
              {c.label} <b>{c.count}</b>
            </button>
          ))}
          {typeof report?.overallConfidence === 'number' && (
            <span className={`${styles.chip} ${styles.score}`}>
              {t('report.stats.confidence')} <b>{Math.round(report.overallConfidence * 100)}%</b>
            </span>
          )}
        </div>

        {visible.length > 0 ? (
          <div className={styles.checks}>
            {visible.map((r) => (
              <CheckRow
                defaultOpen={checkVerdict(r) === 'failed' || r.evidence.some(isInlineImageEvidence)}
                key={r.id}
                result={r}
              />
            ))}
          </div>
        ) : (
          <Block align={'center'} padding={24}>
            <Text type={'secondary'}>{t('report.filterEmpty')}</Text>
          </Block>
        )}

        {report?.content && (
          <details className={styles.narrative}>
            <summary className={styles.narrativeSummary}>
              <Icon icon={ChevronRight} size={13} />
              {t('report.sections.details')}
            </summary>
            <div className={styles.narrativeBody}>
              <Markdown>{report.content}</Markdown>
            </div>
          </details>
        )}
      </div>
    </div>
  );
});

export default ReportViewer;
