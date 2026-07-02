'use client';

import type { VerifyRunContext } from '@lobechat/types';
import {
  Block,
  Center,
  Drawer,
  Empty,
  Flexbox,
  Highlighter,
  Icon,
  Image,
  Markdown,
  Tag,
  Text,
} from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { createStaticStyles, cx } from 'antd-style';
import { AlertTriangle, Check, CircleHelp, Clock3, FileText, RefreshCw, X } from 'lucide-react';
import { memo, type ReactNode, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';

import Loading from '@/components/Loading/BrandTextLoading';
import { useTextFileLoader } from '@/features/FileViewer/hooks/useTextFileLoader';
import { useIsMobile } from '@/hooks/useIsMobile';
import type { VerifyEvidenceWithUrl, VerifyResultWithEvidence } from '@/services/verify';
import { getLanguageFromFilename } from '@/utils/fileLanguage';

import { useVerifyReportBundle } from './hooks';

/** Best-effort filename from a (possibly signed) file URL, for syntax highlighting. */
const filenameFromUrl = (url: string): string => {
  try {
    return new URL(url).pathname.split('/').pop() || 'document';
  } catch {
    return 'document';
  }
};

const styles = createStaticStyles(({ css, cssVar }) => ({
  container: css`
    width: 100%;
    max-width: 880px;
    margin-block: 0;
    margin-inline: auto;
    padding: 24px;
  `,
  containerMobile: css`
    width: 100%;
    max-width: 100%;
    margin-block: 0;
    margin-inline: auto;
    padding: 16px;
  `,
  docTrigger: css`
    cursor: pointer;

    display: inline-flex;
    gap: 6px;
    align-items: center;

    width: fit-content;
    max-width: 100%;
    padding-block: 6px;
    padding-inline: 10px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadius};

    font-size: 13px;
    color: ${cssVar.colorText};
    text-align: start;

    background: ${cssVar.colorFillQuaternary};

    &:hover {
      border-color: ${cssVar.colorLink};
      color: ${cssVar.colorLink};
    }

    span {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
  `,
  docViewer: css`
    overflow: auto;
    height: 100%;
    padding-block: 12px;
    padding-inline: 16px;
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
    height: auto;
    max-height: 360px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};

    object-fit: contain;
  `,
  resultCard: css`
    padding-block: 10px;
    padding-inline: 14px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};

    background: ${cssVar.colorBgContainer};
  `,
  stateBanner: css`
    padding-block: 10px;
    padding-inline: 14px;
    border: 1px solid ${cssVar.colorInfoBorder};
    border-radius: ${cssVar.borderRadiusLG};

    color: ${cssVar.colorInfoText};
    background: ${cssVar.colorInfoBg};
  `,
  scopeBlock: css`
    padding-block: 10px;
    padding-inline: 14px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};

    background: ${cssVar.colorFillQuaternary};
  `,
  scopeKey: css`
    flex-shrink: 0;

    width: 56px;

    font-size: 12px;
    line-height: 20px;
    color: ${cssVar.colorTextTertiary};
  `,
  scopeValue: css`
    font-family: ${cssVar.fontFamilyCode};
    font-size: 12px;
    line-height: 20px;
    color: ${cssVar.colorTextSecondary};
    word-break: break-word;
  `,
  stat: css`
    font-size: 20px;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  `,
}));

const VERDICT_META = {
  failed: { color: 'error', icon: X, labelKey: 'report.verdict.failed' },
  passed: { color: 'success', icon: Check, labelKey: 'report.verdict.passed' },
  uncertain: { color: 'warning', icon: CircleHelp, labelKey: 'report.verdict.uncertain' },
} as const;

const imageEvidenceTypes = new Set(['gif', 'screenshot']);
const terminalRunStatuses = new Set(['delivered', 'failed', 'passed']);
const liveStatusLabelKey = {
  planned: 'report.status.planned',
  repairing: 'report.status.repairing',
  unverified: 'report.status.unverified',
  verifying: 'report.status.verifying',
} as const;

const VerdictTag = memo<{ verdict?: string | null }>(({ verdict }) => {
  const { t } = useTranslation('verify');
  if (!verdict) return null;

  const meta = VERDICT_META[verdict as keyof typeof VERDICT_META];
  if (!meta) return null;
  return (
    <Tag color={meta.color} icon={<Icon icon={meta.icon} />}>
      {t(meta.labelKey)}
    </Tag>
  );
});

/** A single labelled row in the scope header (e.g. "Branch  docs/foo"). */
const ScopeRow = memo<{ label: string; value?: string | null }>(({ label, value }) => {
  if (!value) return null;
  return (
    <Flexbox horizontal gap={8}>
      <span className={styles.scopeKey}>{label}</span>
      <span className={styles.scopeValue}>{value}</span>
    </Flexbox>
  );
});

/**
 * Scope header — the report's "范围" block. Rendered per `scenario`; today only
 * `coding` (branch / commit / surfaces / …). Returns null when there's nothing
 * to show so the page stays clean for runs without context.
 */
const ScopeBlock = memo<{ context?: VerifyRunContext | null; scenario?: string | null }>(
  ({ context, scenario }) => {
    const { t } = useTranslation('verify');
    if (scenario !== 'coding' || !context) return null;

    const { branch, commit, surfaces, entry, focus, testedAt } = context;
    const date = testedAt ? new Date(testedAt).toLocaleString() : undefined;
    const surface = surfaces && surfaces.length > 0 ? surfaces.join(' / ') : undefined;
    if (!branch && !commit && !surface && !entry && !focus && !date) return null;

    return (
      <Block className={styles.scopeBlock} gap={2}>
        <ScopeRow label={t('report.scope.focus')} value={focus} />
        <ScopeRow label={t('report.scope.branch')} value={branch} />
        <ScopeRow label={t('report.scope.surface')} value={surface} />
        <ScopeRow label={t('report.scope.date')} value={date} />
        <ScopeRow label={t('report.scope.commit')} value={commit} />
        <ScopeRow label={t('report.scope.entry')} value={entry} />
      </Block>
    );
  },
);

/** Fetches a file-backed text evidence and renders it decoded (avoids the raw
 *  download's mojibake) with syntax highlighting. */
const DocumentViewer = memo<{ url: string }>(({ url }) => {
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
        language={getLanguageFromFilename(filenameFromUrl(url))}
        showLanguage={false}
        variant={'borderless'}
      >
        {fileData}
      </Highlighter>
    </Flexbox>
  );
});

/** A file-backed (non-media) evidence — opens its decoded content in a right-side
 *  detail drawer instead of navigating to the raw file. */
const DocumentEvidence = memo<{ evidence: VerifyEvidenceWithUrl }>(({ evidence }) => {
  const { t } = useTranslation('verify');
  const [open, setOpen] = useState(false);
  const title = evidence.description || filenameFromUrl(evidence.fileUrl!);

  return (
    <>
      <button className={styles.docTrigger} type={'button'} onClick={() => setOpen(true)}>
        <Icon icon={FileText} />
        <span>{t('report.document.view')}</span>
      </button>
      <Drawer
        open={open}
        styles={{ body: { padding: 0 } }}
        title={title}
        width={'min(720px, 80vw)'}
        onClose={() => setOpen(false)}
      >
        {open && <DocumentViewer url={evidence.fileUrl!} />}
      </Drawer>
    </>
  );
});

/**
 * Renders a check's evidence artifacts (screenshots / video / documents / inline
 * text). Screenshots are capped at `imageMaxHeight` and constrained to the
 * container width so a wide capture never overflows on a narrow viewport.
 */
const EvidenceList = memo<{
  evidence: VerifyResultWithEvidence['evidence'];
  imageMaxHeight?: number;
}>(({ evidence, imageMaxHeight = 360 }) => {
  if (evidence.length === 0) return null;
  return (
    <Flexbox gap={8}>
      {evidence.map((e) => (
        <Flexbox gap={4} key={e.id}>
          {e.description && (
            <Text fontSize={12} type="secondary">
              {e.description}
            </Text>
          )}
          {e.fileUrl && imageEvidenceTypes.has(e.type) ? (
            <Flexbox align={'flex-start'} style={{ maxWidth: '100%' }}>
              <Image
                alt={e.description ?? e.type}
                maxHeight={imageMaxHeight}
                objectFit={'contain'}
                src={e.fileUrl}
                style={{ maxWidth: '100%' }}
                variant={'outlined'}
              />
            </Flexbox>
          ) : e.fileUrl && e.type === 'video' ? (
            <video controls className={styles.evidenceVideo} src={e.fileUrl} />
          ) : e.fileUrl ? (
            <DocumentEvidence evidence={e} />
          ) : e.content ? (
            <div className={styles.evidenceText}>{e.content}</div>
          ) : (
            <Tag>{e.type}</Tag>
          )}
        </Flexbox>
      ))}
    </Flexbox>
  );
});

/** A single check — a stacked card with its title, verdict, reasoning and evidence. */
const ResultCard = memo<{ result: VerifyResultWithEvidence }>(({ result }) => {
  const { t } = useTranslation('verify');
  return (
    <Block className={styles.resultCard} gap={6}>
      <Flexbox horizontal align="center" gap={8} justify="space-between">
        <Text strong>{result.checkItemTitle || result.checkItemId}</Text>
        <Flexbox horizontal align="center" gap={8}>
          {!result.required && <Tag>{t('report.check.optional')}</Tag>}
          <VerdictTag verdict={result.verdict ?? result.status} />
        </Flexbox>
      </Flexbox>
      {result.toulmin?.evidence && (
        <Text fontSize={13} type="secondary">
          {result.toulmin.evidence}
        </Text>
      )}
      {result.suggestion && (
        <Text fontSize={13} type="secondary">
          {result.suggestion}
        </Text>
      )}
      <EvidenceList evidence={result.evidence} />
    </Block>
  );
});

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

/**
 * Standalone viewer for a verification session's report, addressed purely by
 * `?id=<verifyRunId>` — no Agent Run / chat context required. Renders the report
 * narrative plus every check result and its evidence. Checks render as stacked
 * cards (the screenshot is the most valuable part, so it stays full-width and
 * prominent); the layout just tightens padding and wraps the stats row on
 * mobile so a narrow viewport never overflows horizontally.
 */
const ReportViewer = memo(() => {
  const { t } = useTranslation('verify');
  const isMobile = useIsMobile();
  const { runId } = useParams<{ runId: string }>();
  const verifyRunId = runId ?? null;
  const { data, error, isLoading, mutate } = useVerifyReportBundle(verifyRunId);

  useEffect(() => {
    const status = data?.run.status;
    if (!status || terminalRunStatuses.has(status)) return;

    const timer = window.setInterval(() => void mutate(), 5000);
    return () => window.clearInterval(timer);
  }, [data?.run.status, mutate]);

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
        action={
          <Button icon={RefreshCw} onClick={() => void mutate()}>
            {t('report.actions.retry')}
          </Button>
        }
        description={t('report.error.description')}
        icon={X}
        title={t('report.error.title')}
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

  const { run, report, results } = data;
  const liveStatus =
    run.status && !terminalRunStatuses.has(run.status)
      ? (run.status as keyof typeof liveStatusLabelKey)
      : null;
  const passedChecks = report?.passedChecks ?? results.filter((r) => r.verdict === 'passed').length;
  const failedChecks = report?.failedChecks ?? results.filter((r) => r.verdict === 'failed').length;
  const totalChecks = report?.totalChecks ?? results.length;
  const uncertainChecks =
    report?.uncertainChecks ?? Math.max(totalChecks - passedChecks - failedChecks, 0);

  return (
    <Flexbox className={cx(isMobile ? styles.containerMobile : styles.container)} gap={24}>
      <Flexbox gap={12}>
        <Text as="h2">{run.title || t('report.titleFallback')}</Text>
        {run.scenario !== 'coding' && run.goal && <Text type="secondary">{run.goal}</Text>}
        <ScopeBlock context={run.context} scenario={run.scenario} />
        {liveStatus && (
          <Flexbox horizontal align={'center'} className={styles.stateBanner} gap={8}>
            <Icon icon={Clock3} size={16} />
            <Text>{t(liveStatusLabelKey[liveStatus])}</Text>
          </Flexbox>
        )}
        {report?.summary && <Text type="secondary">{report.summary}</Text>}
        <Flexbox
          horizontal
          align="center"
          gap={isMobile ? 16 : 24}
          wrap={isMobile ? 'wrap' : 'nowrap'}
        >
          <VerdictTag verdict={report?.verdict} />
          <Flexbox>
            <span className={styles.stat}>{totalChecks}</span>
            <Text fontSize={12} type="secondary">
              {t('report.stats.total')}
            </Text>
          </Flexbox>
          <Flexbox>
            <Text className={styles.stat} type="success">
              {passedChecks}
            </Text>
            <Text fontSize={12} type="secondary">
              {t('report.stats.passed')}
            </Text>
          </Flexbox>
          <Flexbox>
            <Text className={styles.stat} type="danger">
              {failedChecks}
            </Text>
            <Text fontSize={12} type="secondary">
              {t('report.stats.failed')}
            </Text>
          </Flexbox>
          <Flexbox>
            <span className={styles.stat}>{uncertainChecks}</span>
            <Text fontSize={12} type="secondary">
              {t('report.stats.uncertain')}
            </Text>
          </Flexbox>
          {typeof report?.overallConfidence === 'number' && (
            <Flexbox>
              <span className={styles.stat}>{Math.round(report.overallConfidence * 100)}</span>
              <Text fontSize={12} type="secondary">
                {t('report.stats.confidence')}
              </Text>
            </Flexbox>
          )}
        </Flexbox>
      </Flexbox>

      <Flexbox gap={8}>
        <Text as="h3">{t('report.sections.checks')}</Text>
        {results.map((r) => (
          <ResultCard key={r.id} result={r} />
        ))}
      </Flexbox>

      {/* Narrative detail (verification commands / score / notes). The scope and
          per-check cards are already structured above, so a well-formed report
          body carries only the non-duplicate prose. */}
      {report?.content && (
        <Flexbox gap={8}>
          <Text as="h3">{t('report.sections.details')}</Text>
          <Markdown>{report.content}</Markdown>
        </Flexbox>
      )}
    </Flexbox>
  );
});

export default ReportViewer;
