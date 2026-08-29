'use client';

import { Flexbox } from '@lobehub/ui';
import { Tag, Text } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { ArrowLeft, FileText } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import WorkspaceLink from '@/features/Workspace/WorkspaceLink';

import Transcript from './Transcript';

const styles = createStaticStyles(({ css }) => ({
  backLink: css`
    display: inline-flex;
    gap: 4px;
    align-items: center;

    width: fit-content;

    font-size: ${cssVar.fontSize};
    color: ${cssVar.colorTextTertiary};
    text-decoration: none;

    transition: color 0.15s ease;

    &:hover {
      color: ${cssVar.colorText};
    }
  `,
  icon: css`
    display: flex;
    align-items: center;
    justify-content: center;

    width: 36px;
    height: 36px;
    border-radius: 10px;

    background: ${cssVar.colorFillTertiary};
  `,
  label: css`
    font-size: ${cssVar.fontSizeSM};
    font-weight: 500;
    color: ${cssVar.colorTextSecondary};
  `,
  prose: css`
    padding-block: 10px;
    padding-inline: 12px;
    border-radius: 10px;

    font-size: ${cssVar.fontSize};
    line-height: 1.75;
    white-space: pre-wrap;

    background: ${cssVar.colorFillQuaternary};
  `,
}));

export interface TestCaseDetailProps {
  benchmarkId: string;
  datasetId: string;
  testCase: {
    content?: {
      input?: string;
      messages?: Array<{ content?: unknown; role?: string }>;
    } & Record<string, unknown>;
    evalConfig?: Record<string, unknown> | null;
    evalMode?: string | null;
    id: string;
    metadata?: Record<string, unknown> | null;
  };
}

/**
 * A test case as a definition — what it asks and how it is judged — addressable
 * without a run. The `runs/:runId/cases/:caseId` page is a different surface: it
 * renders one case's *result* inside a single run.
 */
const TestCaseDetail = memo<TestCaseDetailProps>(({ benchmarkId, datasetId, testCase }) => {
  const { t } = useTranslation('eval');

  const content = testCase.content ?? {};
  const expected = typeof content.expected === 'string' ? content.expected : undefined;
  const criteria =
    typeof testCase.evalConfig?.criteria === 'string' ? testCase.evalConfig.criteria : undefined;
  const caseId =
    typeof testCase.metadata?.caseId === 'string' ? testCase.metadata.caseId : undefined;

  return (
    <Flexbox gap={24} style={{ maxWidth: 880, paddingBlock: 24, paddingInline: 32 }}>
      <WorkspaceLink
        className={styles.backLink}
        to={`/eval/bench/${benchmarkId}/datasets/${datasetId}`}
      >
        <ArrowLeft size={16} />
        {t('testCaseDetail.backToDataset')}
      </WorkspaceLink>

      <Flexbox horizontal align="center" gap={12}>
        <div className={styles.icon}>
          <FileText size={18} style={{ color: cssVar.colorTextSecondary }} />
        </div>
        <Flexbox gap={6}>
          <Text as="h4" style={{ fontSize: 20, fontWeight: 600, margin: 0 }}>
            {caseId ?? t('testCaseDetail.title')}
          </Text>
          <Flexbox horizontal gap={6}>
            {testCase.evalMode && <Tag size="small">{testCase.evalMode}</Tag>}
          </Flexbox>
        </Flexbox>
      </Flexbox>

      <Flexbox gap={10}>
        <span className={styles.label}>{t('testCaseDetail.definition')}</span>
        <Transcript input={content.input ?? ''} messages={content.messages} />
      </Flexbox>

      <Flexbox gap={10}>
        <span className={styles.label}>{t('testCaseDetail.criteria')}</span>
        {criteria ? (
          <div className={styles.prose}>{criteria}</div>
        ) : (
          <Text style={{ fontSize: 12 }} type="secondary">
            {t('testCaseDetail.criteria.empty')}
          </Text>
        )}
      </Flexbox>

      <Flexbox gap={10}>
        <span className={styles.label}>{t('testCaseDetail.expected')}</span>
        {expected ? (
          <div className={styles.prose}>{expected}</div>
        ) : (
          <Text style={{ fontSize: 12 }} type="secondary">
            {t('testCaseDetail.expected.empty')}
          </Text>
        )}
      </Flexbox>
    </Flexbox>
  );
});

TestCaseDetail.displayName = 'TestCaseDetail';

export default TestCaseDetail;
