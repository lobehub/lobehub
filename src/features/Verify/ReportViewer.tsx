'use client';

import { Block, Flexbox, Icon, Markdown, Tag, Text } from '@lobehub/ui';
import { createStyles } from 'antd-style';
import { Check, CircleHelp, X } from 'lucide-react';
import { memo } from 'react';
import { useParams } from 'react-router';

import Loading from '@/components/Loading/BrandTextLoading';
import type { VerifyResultWithEvidence } from '@/services/verify';

import { useVerifyReportBundle } from './hooks';

const useStyles = createStyles(({ css, token }) => ({
  container: css`
    width: 100%;
    max-width: 880px;
    margin-block: 0;
    margin-inline: auto;
    padding: 24px;
  `,
  evidenceImg: css`
    max-width: 100%;
    max-height: 360px;
    border: 1px solid ${token.colorBorderSecondary};
    border-radius: ${token.borderRadiusLG}px;
  `,
  evidenceLink: css`
    display: inline-flex;
    align-items: center;

    width: fit-content;
    max-width: 100%;
    padding-block: 6px;
    padding-inline: 10px;
    border: 1px solid ${token.colorBorderSecondary};
    border-radius: ${token.borderRadius}px;

    color: ${token.colorText};
    text-decoration: none;

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
    max-width: 100%;
    max-height: 360px;
    border: 1px solid ${token.colorBorderSecondary};
    border-radius: ${token.borderRadiusLG}px;
  `,
  resultCard: css`
    padding: 16px;
    border: 1px solid ${token.colorBorderSecondary};
    border-radius: ${token.borderRadiusLG}px;
    background: ${token.colorBgContainer};
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

const ResultItem = memo<{ result: VerifyResultWithEvidence }>(({ result }) => {
  const { styles } = useStyles();
  return (
    <Block className={styles.resultCard} gap={12}>
      <Flexbox horizontal align="center" gap={8} justify="space-between">
        <Text strong>{result.checkItemTitle || result.checkItemId}</Text>
        <Flexbox horizontal align="center" gap={8}>
          {!result.required && <Tag>soft</Tag>}
          <VerdictTag verdict={result.verdict ?? result.status} />
        </Flexbox>
      </Flexbox>
      {result.suggestion && <Text type="secondary">{result.suggestion}</Text>}
      {result.toulmin?.evidence && <Text type="secondary">{result.toulmin.evidence}</Text>}
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
                <img alt={e.description ?? e.type} className={styles.evidenceImg} src={e.fileUrl} />
              ) : e.fileUrl && e.type === 'video' ? (
                <video controls className={styles.evidenceVideo} src={e.fileUrl} />
              ) : e.fileUrl ? (
                <a
                  className={styles.evidenceLink}
                  href={e.fileUrl}
                  rel="noreferrer"
                  target="_blank"
                >
                  <span>{e.description ?? e.type}</span>
                </a>
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
      <Flexbox gap={8}>
        <Flexbox horizontal align="center" gap={12} justify="space-between">
          <Text as="h2">{run.title || report?.summary || 'Verification report'}</Text>
          <VerdictTag verdict={report?.verdict} />
        </Flexbox>
        {run.goal && <Text type="secondary">{run.goal}</Text>}
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
        </Flexbox>
      </Flexbox>

      <Flexbox gap={12}>
        <Text as="h3">Checks</Text>
        {results.map((r) => (
          <ResultItem key={r.id} result={r} />
        ))}
      </Flexbox>

      {report?.content && (
        <Flexbox gap={8}>
          <Text as="h3">Report</Text>
          <Markdown>{report.content}</Markdown>
        </Flexbox>
      )}
    </Flexbox>
  );
});

export default ReportViewer;
