'use client';

import { Flexbox, Icon, TextArea } from '@lobehub/ui';
import { Button, Tag, Text, toast } from '@lobehub/ui/base-ui';
import { Breadcrumb } from 'antd';
import { createStaticStyles, cssVar } from 'antd-style';
import { ChevronRight, FileText, Pencil } from 'lucide-react';
import { memo, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import WorkspaceLink from '@/features/Workspace/WorkspaceLink';
import { useEvalStore } from '@/store/eval';

import Transcript from './Transcript';
import { useCaseDraft } from './useCaseDraft';

const styles = createStaticStyles(({ css }) => ({
  breadcrumb: css`
    font-size: ${cssVar.fontSize};

    a {
      color: ${cssVar.colorTextTertiary};
      text-decoration: none;
      transition: color 0.15s ease;

      &:hover {
        color: ${cssVar.colorText};
      }
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
  editor: css`
    font-size: ${cssVar.fontSize};
    line-height: 1.75;
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
  /** Shown in the breadcrumb; falls back to a generic label when unknown. */
  datasetName?: string;
  testCase: {
    datasetId: string;
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
const TestCaseDetail = memo<TestCaseDetailProps>(({ datasetName, testCase }) => {
  const { t } = useTranslation('eval');
  const updateTestCase = useEvalStore((s) => s.updateTestCase);
  const [saving, setSaving] = useState(false);

  const content = testCase.content ?? {};
  const expected = typeof content.expected === 'string' ? content.expected : undefined;
  const criteria =
    typeof testCase.evalConfig?.criteria === 'string' ? testCase.evalConfig.criteria : undefined;
  const caseId =
    typeof testCase.metadata?.caseId === 'string' ? testCase.metadata.caseId : undefined;
  // The answer this case was captured from, and whether it was kept as the
  // wrong answer or the right one. A counter-example has to be visible here or
  // the case reads as if nothing ever went wrong; a positive one already *is*
  // the expected output, so repeating it as its own block would just say the
  // same thing twice. Captures made before the distinction existed are
  // counter-examples.
  const capturedOutput =
    typeof testCase.metadata?.capturedOutput === 'string'
      ? testCase.metadata.capturedOutput
      : undefined;
  const capturedIsPositive = testCase.metadata?.capturedOutputKind === 'positive';

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

  return (
    <Flexbox
      gap={24}
      style={{
        marginInline: 'auto',
        maxWidth: 880,
        paddingBlock: 24,
        paddingInline: 32,
        width: '100%',
      }}
    >
      <Breadcrumb
        className={styles.breadcrumb}
        separator={<Icon icon={ChevronRight} size={14} />}
        items={[
          {
            title: <WorkspaceLink to="/eval">{t('testCaseDetail.breadcrumb.eval')}</WorkspaceLink>,
          },
          {
            title: (
              <WorkspaceLink to={`/eval/datasets/${testCase.datasetId}`}>
                {datasetName || t('testCaseDetail.breadcrumb.dataset')}
              </WorkspaceLink>
            ),
          },
          { title: caseId ?? t('testCaseDetail.title') },
        ]}
      />

      <Flexbox horizontal align="center" gap={12} justify="space-between">
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
        {editing ? (
          <Flexbox horizontal gap={8}>
            <Button disabled={saving} size="small" onClick={cancel}>
              {t('common.cancel')}
            </Button>
            <Button loading={saving} size="small" type="primary" onClick={handleSave}>
              {t('common.save')}
            </Button>
          </Flexbox>
        ) : (
          <Button icon={Pencil} size="small" onClick={start}>
            {t('common.edit')}
          </Button>
        )}
      </Flexbox>

      <Flexbox gap={10}>
        <span className={styles.label}>{t('testCaseDetail.definition')}</span>
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
      </Flexbox>

      {capturedOutput && !capturedIsPositive && (
        <Flexbox gap={10}>
          <Flexbox horizontal align="center" gap={8}>
            <span className={styles.label}>{t('testCaseDetail.capturedOutput')}</span>
            <Tag color="error" size="small">
              {t('testCaseDetail.counterExample')}
            </Tag>
          </Flexbox>
          <div className={styles.prose}>{capturedOutput}</div>
          <Text style={{ fontSize: 12 }} type="secondary">
            {t('testCaseDetail.capturedOutputHint')}
          </Text>
        </Flexbox>
      )}

      <Flexbox gap={10}>
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
          <Text style={{ fontSize: 12 }} type="secondary">
            {t('testCaseDetail.criteria.empty')}
          </Text>
        )}
      </Flexbox>

      <Flexbox gap={10}>
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
              <Text style={{ fontSize: 12 }} type="secondary">
                {t('testCaseDetail.expectedFromCapture')}
              </Text>
            )}
          </>
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
