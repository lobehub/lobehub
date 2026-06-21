'use client';

import type { VerifyRunContext } from '@lobechat/types';
import {
  Block,
  Center,
  Drawer,
  Flexbox,
  Highlighter,
  Icon,
  Image,
  Markdown,
  Tag,
  Text,
} from '@lobehub/ui';
import { createStyles } from 'antd-style';
import { Check, CircleHelp, FileText, X } from 'lucide-react';
import { memo, useState } from 'react';
import { useParams } from 'react-router';

import Loading from '@/components/Loading/BrandTextLoading';
import { useTextFileLoader } from '@/features/FileViewer/hooks/useTextFileLoader';
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

const useStyles = createStyles(({ css, token }) => ({
  container: css`
    width: 100%;
    max-width: 880px;
    margin-block: 0;
    margin-inline: auto;
    padding: 24px;
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
    border: 1px solid ${token.colorBorderSecondary};
    border-radius: ${token.borderRadius}px;

    font-size: 13px;
    color: ${token.colorText};
    text-align: start;

    background: ${token.colorFillQuaternary};

    &:hover {
      border-color: ${token.colorLink};
      color: ${token.colorLink};
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
    border-radius: ${token.borderRadius}px;

    font-family: ${token.fontFamilyCode};
    font-size: 12px;
    white-space: pre-wrap;

    background: ${token.colorFillQuaternary};
  `,
  evidenceVideo: css`
    align-self: flex-start;

    width: auto;
    max-width: 100%;
    height: auto;
    max-height: 360px;
    border: 1px solid ${token.colorBorderSecondary};
    border-radius: ${token.borderRadiusLG}px;

    object-fit: contain;
  `,
  resultCard: css`
    padding-block: 10px;
    padding-inline: 14px;
    border: 1px solid ${token.colorBorderSecondary};
    border-radius: ${token.borderRadiusLG}px;

    background: ${token.colorBgContainer};
  `,
  scopeBlock: css`
    padding-block: 10px;
    padding-inline: 14px;
    border: 1px solid ${token.colorBorderSecondary};
    border-radius: ${token.borderRadiusLG}px;

    background: ${token.colorFillQuaternary};
  `,
  scopeKey: css`
    flex-shrink: 0;

    width: 56px;

    font-size: 12px;
    line-height: 20px;
    color: ${token.colorTextTertiary};
  `,
  scopeValue: css`
    font-family: ${token.fontFamilyCode};
    font-size: 12px;
    line-height: 20px;
    color: ${token.colorTextSecondary};
    word-break: break-word;
  `,
  stat: css`
    font-size: 20px;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  `,
}));

const VERDICT_META = {
  failed: { color: 'error', icon: X, label: 'Failed' },
  passed: { color: 'success', icon: Check, label: 'Passed' },
  uncertain: { color: 'warning', icon: CircleHelp, label: 'Uncertain' },
} as const;

const imageEvidenceTypes = new Set(['gif', 'screenshot']);

const VerdictTag = memo<{ verdict?: string | null }>(({ verdict }) => {
  const meta = VERDICT_META[(verdict ?? 'uncertain') as keyof typeof VERDICT_META];
  if (!meta) return null;
  return (
    <Tag color={meta.color} icon={<Icon icon={meta.icon} />}>
      {meta.label}
    </Tag>
  );
});

/** A single labelled row in the scope header (e.g. "Branch  docs/foo"). */
const ScopeRow = memo<{ label: string; value?: string | null }>(({ label, value }) => {
  const { styles } = useStyles();
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
    const { styles } = useStyles();
    if (scenario !== 'coding' || !context) return null;

    const { branch, commit, surfaces, entry, focus, testedAt } = context;
    const date = testedAt ? new Date(testedAt).toLocaleString() : undefined;
    const surface = surfaces && surfaces.length > 0 ? surfaces.join(' / ') : undefined;
    if (!branch && !commit && !surface && !entry && !focus && !date) return null;

    return (
      <Block className={styles.scopeBlock} gap={2}>
        <ScopeRow label="Branch" value={branch} />
        <ScopeRow label="Commit" value={commit} />
        <ScopeRow label="Date" value={date} />
        <ScopeRow label="Surface" value={surface} />
        <ScopeRow label="Entry" value={entry} />
        <ScopeRow label="Focus" value={focus} />
      </Block>
    );
  },
);

/** Fetches a file-backed text evidence and renders it decoded (avoids the raw
 *  download's mojibake) with syntax highlighting. */
const DocumentViewer = memo<{ url: string }>(({ url }) => {
  const { styles } = useStyles();
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
        <Text type="secondary">Failed to load document.</Text>
        <a href={url} rel="noreferrer" target="_blank">
          Open original
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
  const { styles } = useStyles();
  const [open, setOpen] = useState(false);
  const title = evidence.description || filenameFromUrl(evidence.fileUrl!);

  return (
    <>
      <button className={styles.docTrigger} type={'button'} onClick={() => setOpen(true)}>
        <Icon icon={FileText} />
        <span>View document</span>
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

const ResultItem = memo<{ result: VerifyResultWithEvidence }>(({ result }) => {
  const { styles } = useStyles();
  return (
    <Block className={styles.resultCard} gap={6}>
      <Flexbox horizontal align="center" gap={8} justify="space-between">
        <Text strong>{result.checkItemTitle || result.checkItemId}</Text>
        <Flexbox horizontal align="center" gap={8}>
          {!result.required && <Tag>soft</Tag>}
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
      {result.evidence.length > 0 && (
        <Flexbox gap={8}>
          {result.evidence.map((e) => (
            <Flexbox gap={4} key={e.id}>
              {e.description && (
                <Text fontSize={12} type="secondary">
                  {e.description}
                </Text>
              )}
              {e.fileUrl && imageEvidenceTypes.has(e.type) ? (
                <Flexbox align={'flex-start'}>
                  <Image
                    alt={e.description ?? e.type}
                    maxHeight={360}
                    objectFit={'contain'}
                    src={e.fileUrl}
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
      )}
    </Block>
  );
});

/**
 * Standalone viewer for a verification session's report, addressed purely by
 * `?id=<verifyRunId>` — no Agent Run / chat context required. Renders the report
 * narrative plus every check result and its evidence.
 */
const ReportViewer = memo(() => {
  const { styles } = useStyles();
  const { runId } = useParams<{ runId: string }>();
  const verifyRunId = runId ?? null;
  const { data, isLoading } = useVerifyReportBundle(verifyRunId);

  if (!verifyRunId)
    return <Text type="danger">Missing report id (/verify/&lt;verifyRunId&gt;).</Text>;
  if (isLoading) return <Loading debugId="verify-report-viewer" />;
  if (!data) return <Text type="danger">Report not found.</Text>;

  const { run, report, results } = data;

  return (
    <Flexbox className={styles.container} gap={24}>
      <Flexbox gap={12}>
        <Flexbox horizontal align="center" gap={12} justify="space-between">
          <Text as="h2">{run.title || 'Verification report'}</Text>
          <VerdictTag verdict={report?.verdict} />
        </Flexbox>
        {run.scenario !== 'coding' && run.goal && <Text type="secondary">{run.goal}</Text>}
        <ScopeBlock context={run.context} scenario={run.scenario} />
        {report?.summary && <Text type="secondary">{report.summary}</Text>}
        <Flexbox horizontal gap={24}>
          <Flexbox>
            <span className={styles.stat}>{report?.totalChecks ?? results.length}</span>
            <Text fontSize={12} type="secondary">
              total
            </Text>
          </Flexbox>
          <Flexbox>
            <Text className={styles.stat} type="success">
              {report?.passedChecks ?? results.filter((r) => r.verdict === 'passed').length}
            </Text>
            <Text fontSize={12} type="secondary">
              passed
            </Text>
          </Flexbox>
          <Flexbox>
            <Text className={styles.stat} type="danger">
              {report?.failedChecks ?? results.filter((r) => r.verdict === 'failed').length}
            </Text>
            <Text fontSize={12} type="secondary">
              failed
            </Text>
          </Flexbox>
          {typeof report?.overallConfidence === 'number' && (
            <Flexbox>
              <span className={styles.stat}>{Math.round(report.overallConfidence * 100)}</span>
              <Text fontSize={12} type="secondary">
                score
              </Text>
            </Flexbox>
          )}
        </Flexbox>
      </Flexbox>

      <Flexbox gap={8}>
        <Text as="h3">Checks</Text>
        {results.map((r) => (
          <ResultItem key={r.id} result={r} />
        ))}
      </Flexbox>

      {/* Narrative detail (verification commands / score / notes). The scope and
          per-check table are already structured above, so a well-formed report
          body carries only the non-duplicate prose. */}
      {report?.content && (
        <Flexbox gap={8}>
          <Text as="h3">Details</Text>
          <Markdown>{report.content}</Markdown>
        </Flexbox>
      )}
    </Flexbox>
  );
});

export default ReportViewer;
