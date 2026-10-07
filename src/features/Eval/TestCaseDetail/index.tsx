'use client';

import { Flexbox } from '@lobehub/ui';
import { Breadcrumb, Button, Tag, TextArea, toast } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { Pencil } from 'lucide-react';
import { memo, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import EvalPage, { EvalPageHeader } from '@/features/Eval/components/EvalPage';
import EvalSection from '@/features/Eval/components/EvalSection';
import { stripSpeakerTags } from '@/features/Eval/components/inputPreview';
import WorkspaceLink from '@/features/Workspace/WorkspaceLink';
import { useEvalStore } from '@/store/eval';

import CaseModelResults from './CaseModelResults';
import { readFrozenCall } from './frozenCall';
import FrozenCallPanel from './FrozenCallPanel';
import Transcript from './Transcript';
import { useCaseDraft } from './useCaseDraft';
import { useSourceTopic } from './useSourceTopic';

const styles = createStaticStyles(({ css }) => ({
  breadcrumb: css`
    font-size: ${cssVar.fontSizeSM};

    a {
      color: ${cssVar.colorTextTertiary};
      text-decoration: none;
      transition: color 0.15s ease;

      &:hover {
        color: ${cssVar.colorText};
      }
    }
  `,
  editor: css`
    font-size: ${cssVar.fontSize};

    textarea {
      line-height: ${cssVar.lineHeight};
    }
  `,
  hint: css`
    font-size: ${cssVar.fontSizeSM};
    color: ${cssVar.colorTextTertiary};
  `,
  label: css`
    font-size: ${cssVar.fontSizeSM};
    font-weight: 500;
    color: ${cssVar.colorTextSecondary};
  `,
  meta: css`
    font-size: ${cssVar.fontSizeSM};
    color: ${cssVar.colorTextTertiary};

    a {
      color: ${cssVar.colorTextSecondary};

      &:hover {
        color: ${cssVar.colorText};
      }
    }
  `,
  prose: css`
    padding-block: 8px;
    padding-inline: 12px;
    border-radius: ${cssVar.borderRadius};

    font-size: ${cssVar.fontSize};
    line-height: ${cssVar.lineHeight};
    word-break: break-word;
    white-space: pre-wrap;

    background: ${cssVar.colorFillQuaternary};
  `,
  title: css`
    overflow: hidden;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
  `,
}));

export interface TestCaseDetailProps {
  /** Shown in the breadcrumb; falls back to a generic label when unknown. */
  datasetName?: string;
  testCase: {
    content?: {
      input?: string;
      messages?: Array<{ content?: unknown; role?: string }>;
    } & Record<string, unknown>;
    datasetId: string;
    evalConfig?: Record<string, unknown> | null;
    evalMode?: string | null;
    frozenCall?: unknown;
    frozenStepIndex?: number | null;
    id: string;
    metadata?: Record<string, unknown> | null;
    sourceTopicId?: string | null;
  };
}

/**
 * A test case as a definition — what it asks and how it is judged — and, for
 * a frozen case, how every model it was replayed on answered it.
 */
const TestCaseDetail = memo<TestCaseDetailProps>(({ datasetName, testCase }) => {
  const { t } = useTranslation('eval');
  const updateTestCase = useEvalStore((s) => s.updateTestCase);
  const [saving, setSaving] = useState(false);
  const { data: sourceTopic } = useSourceTopic(testCase.sourceTopicId);

  const content = testCase.content ?? {};
  const expected = typeof content.expected === 'string' ? content.expected : undefined;
  const criteria =
    typeof testCase.evalConfig?.criteria === 'string' ? testCase.evalConfig.criteria : undefined;
  const caseId =
    typeof testCase.metadata?.caseId === 'string' ? testCase.metadata.caseId : undefined;
  const inputPreview = stripSpeakerTags(content.input ?? '');
  // A counter-example has to be visible or the case reads as if nothing ever
  // went wrong; a positive capture already *is* the expected output.
  const capturedOutput =
    typeof testCase.metadata?.capturedOutput === 'string'
      ? testCase.metadata.capturedOutput
      : undefined;
  const capturedIsPositive = testCase.metadata?.capturedOutputKind === 'positive';

  const frozenCall = readFrozenCall(testCase.frozenCall);
  const canCompare = !!frozenCall || typeof testCase.frozenStepIndex === 'number';
  const originalModel =
    frozenCall?.model && frozenCall.provider
      ? `${frozenCall.provider}/${frozenCall.model}`
      : undefined;

  const initial = useMemo(
    () => ({ criteria: criteria ?? '', expected: expected ?? '', input: content.input ?? '' }),
    [criteria, expected, content.input],
  );
  const { cancel, draft, editing, patch, setDraft, start, stop } = useCaseDraft(initial);

  const handleSave = async () => {
    if (!patch) return stop();
    setSaving(true);
    try {
      await updateTestCase(testCase.id, testCase.datasetId, patch);
      stop();
    } catch (error) {
      toast.error((error as Error)?.message ?? t('testCaseDetail.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const topicLabel = sourceTopic?.title || testCase.sourceTopicId;

  const header = (
    <EvalPageHeader
      description={caseId && inputPreview ? inputPreview : undefined}
      actions={
        editing ? (
          <>
            <Button disabled={saving} onClick={cancel}>
              {t('common.cancel')}
            </Button>
            <Button loading={saving} type="primary" onClick={handleSave}>
              {t('common.save')}
            </Button>
          </>
        ) : (
          <Button icon={Pencil} onClick={start}>
            {t('common.edit')}
          </Button>
        )
      }
      breadcrumb={
        <Breadcrumb
          className={styles.breadcrumb}
          items={[
            {
              title: (
                <WorkspaceLink to="/eval">{t('testCaseDetail.breadcrumb.eval')}</WorkspaceLink>
              ),
            },
            {
              title: (
                <WorkspaceLink to={`/eval/datasets/${testCase.datasetId}`}>
                  {datasetName || t('testCaseDetail.breadcrumb.dataset')}
                </WorkspaceLink>
              ),
            },
            { title: t('testCaseDetail.title') },
          ]}
        />
      }
      meta={
        <Flexbox horizontal align="center" className={styles.meta} gap={12} wrap="wrap">
          {testCase.evalMode && <Tag size="small">{testCase.evalMode}</Tag>}
          {canCompare && <Tag size="small">{t('caseDetail.header.frozen')}</Tag>}
          {testCase.sourceTopicId && (
            <span>
              {t('caseDetail.header.source')}{' '}
              {sourceTopic?.agentId ? (
                <WorkspaceLink to={`/agent/${sourceTopic.agentId}/${testCase.sourceTopicId}`}>
                  {topicLabel}
                </WorkspaceLink>
              ) : (
                topicLabel
              )}
            </span>
          )}
        </Flexbox>
      }
      title={
        <span className={styles.title}>
          {caseId ?? (inputPreview || t('testCaseDetail.title'))}
        </span>
      }
    />
  );

  return (
    <EvalPage header={header}>
      <CaseModelResults
        canCompare={canCompare}
        datasetId={testCase.datasetId}
        originalModel={originalModel}
        testCaseId={testCase.id}
      />

      <EvalSection title={t('testCaseDetail.definition')}>
        <Transcript
          input={content.input ?? ''}
          messages={content.messages}
          inputSlot={
            editing ? (
              <TextArea
                autoSize={{ maxRows: 12, minRows: 3 }}
                className={styles.editor}
                value={draft.input}
                onChange={(e) => setDraft({ input: e.target.value })}
              />
            ) : undefined
          }
        />
        {capturedOutput && !capturedIsPositive && (
          <Flexbox gap={8}>
            <Flexbox horizontal align="center" gap={8}>
              <span className={styles.label}>{t('testCaseDetail.capturedOutput')}</span>
              <Tag color="error" size="small">
                {t('testCaseDetail.counterExample')}
              </Tag>
            </Flexbox>
            <div className={styles.prose}>{capturedOutput}</div>
            <span className={styles.hint}>{t('testCaseDetail.capturedOutputHint')}</span>
          </Flexbox>
        )}
      </EvalSection>

      <EvalSection description={t('caseDetail.judging.desc')} title={t('caseDetail.judging.title')}>
        <Flexbox gap={8}>
          <span className={styles.label}>{t('testCaseDetail.criteria')}</span>
          {editing ? (
            <TextArea
              autoSize={{ maxRows: 12, minRows: 3 }}
              className={styles.editor}
              value={draft.criteria}
              onChange={(e) => setDraft({ criteria: e.target.value })}
            />
          ) : criteria ? (
            <div className={styles.prose}>{criteria}</div>
          ) : (
            <span className={styles.hint}>{t('testCaseDetail.criteria.empty')}</span>
          )}
        </Flexbox>
        <Flexbox gap={8}>
          <span className={styles.label}>{t('testCaseDetail.expected')}</span>
          {editing ? (
            <TextArea
              autoSize={{ maxRows: 12, minRows: 3 }}
              className={styles.editor}
              placeholder={t('testCaseDetail.expected.placeholder')}
              value={draft.expected}
              onChange={(e) => setDraft({ expected: e.target.value })}
            />
          ) : expected ? (
            <>
              <div className={styles.prose}>{expected}</div>
              {capturedIsPositive && (
                <span className={styles.hint}>{t('testCaseDetail.expectedFromCapture')}</span>
              )}
            </>
          ) : (
            <span className={styles.hint}>{t('testCaseDetail.expected.empty')}</span>
          )}
        </Flexbox>
      </EvalSection>

      <FrozenCallPanel
        frozenCall={testCase.frozenCall}
        frozenStepIndex={testCase.frozenStepIndex}
      />
    </EvalPage>
  );
});

TestCaseDetail.displayName = 'TestCaseDetail';

export default TestCaseDetail;
