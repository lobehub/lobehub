'use client';

import { Flexbox, TextArea } from '@lobehub/ui';
import { Select, Tag, Text, toast } from '@lobehub/ui/base-ui';
import { Divider, Form } from 'antd';
import { createStaticStyles, cssVar } from 'antd-style';
import { type FC, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { agentEvalService } from '@/services/agentEval';

import { type CaptureDraft } from './buildCaptureDraft';

const styles = createStaticStyles(({ css }) => ({
  body: css`
    overflow: hidden;
    max-height: calc(78vh - 180px);
  `,
  label: css`
    font-size: ${cssVar.fontSizeSM};
    font-weight: 500;
    color: ${cssVar.colorTextSecondary};
  `,
  left: css`
    overflow-y: auto;
    flex: 0 0 46%;
    max-height: calc(78vh - 180px);
    padding-inline-end: 8px;
  `,
  msgBody: css`
    overflow-y: auto;

    /* Capped so one long turn cannot push the rest out of view; the full text
       stays reachable by scrolling inside the block. */
    max-height: 200px;
    padding-block: 10px;
    padding-inline: 12px;
    border-radius: 10px;

    font-size: ${cssVar.fontSize};
    line-height: 1.75;
    white-space: pre-wrap;

    background: ${cssVar.colorFillQuaternary};
  `,
  msgBodyMuted: css`
    overflow-y: auto;

    max-height: 96px;
    padding-block: 8px;
    padding-inline: 12px;
    border-radius: 10px;

    font-size: ${cssVar.fontSizeSM};
    line-height: 1.7;
    color: ${cssVar.colorTextTertiary};
    white-space: pre-wrap;

    background: ${cssVar.colorFillQuaternary};
  `,
  msgHead: css`
    font-size: ${cssVar.fontSizeSM};
    font-weight: 500;
    color: ${cssVar.colorTextTertiary};
  `,
  right: css`
    overflow-y: auto;
    flex: 1;
    max-height: calc(78vh - 180px);
    padding-inline-end: 8px;
  `,
}));

export interface CaptureContentProps {
  draft: CaptureDraft;
  formId: string;
  onLoadingChange?: (loading: boolean) => void;
  onSaved: (testCaseId: string, datasetName: string) => void;
}

const CaptureContent: FC<CaptureContentProps> = ({ draft, formId, onLoadingChange, onSaved }) => {
  const { t } = useTranslation('eval');
  const [form] = Form.useForm();
  const [datasets, setDatasets] = useState<Array<{ id: string; name: string }>>([]);

  useEffect(() => {
    // Both benchmark-owned and unlinked datasets are valid destinations.
    void Promise.all([agentEvalService.listUnlinkedDatasets(), agentEvalService.listBenchmarks()])
      .then(async ([unlinked, benchmarks]) => {
        const owned = await Promise.all(
          (benchmarks ?? []).map((b: { id: string }) => agentEvalService.listDatasets(b.id)),
        );
        setDatasets([...(unlinked ?? []), ...owned.flat()] as Array<{ id: string; name: string }>);
      })
      .catch(() => setDatasets([]));
  }, []);

  const handleFinish = async (values: any) => {
    onLoadingChange?.(true);
    try {
      const created = await agentEvalService.createTestCase({
        content: {
          expected: values.expected || undefined,
          input: draft.input,
          messages: draft.context.map((message, index) => ({
            content: message.content,
            id: `capture-${index}`,
            role: message.role as 'assistant' | 'user',
          })),
        },
        datasetId: values.datasetId,
        evalConfig: { criteria: values.criteria },
        evalMode: 'llm-rubric',
        metadata: {
          // The captured answer is the counter-example, not the expectation:
          // writing it to `expected` would make a wrong answer the target.
          capturedOutput: draft.actualOutput,
          source: 'conversation-capture',
        },
      });

      const dataset = datasets.find((d) => d.id === values.datasetId);
      onSaved(created.id, dataset?.name ?? '');
    } catch {
      toast.error(t('capture.error'));
    } finally {
      onLoadingChange?.(false);
    }
  };

  return (
    <Flexbox horizontal className={styles.body} gap={16}>
      {/* Left: what is being captured — read-only, just verify it. */}
      <Flexbox className={styles.left} gap={12}>
        <span className={styles.label}>{t('capture.captured')}</span>
        {draft.context.map((message, index) => (
          <Flexbox gap={4} key={index}>
            <span className={styles.msgHead}>{message.role}</span>
            <div className={styles.msgBodyMuted}>{message.content}</div>
          </Flexbox>
        ))}
        <Flexbox gap={4}>
          <span className={styles.msgHead}>{t('capture.input')}</span>
          <div className={styles.msgBody}>{draft.input}</div>
        </Flexbox>
        <Flexbox gap={4}>
          <Flexbox horizontal align="center" gap={6}>
            <span className={styles.msgHead}>{t('capture.actual')}</span>
            <Tag color="error" size="small">
              {t('capture.counterExample')}
            </Tag>
          </Flexbox>
          <div className={styles.msgBody}>{draft.actualOutput}</div>
          <Text style={{ fontSize: 12 }} type="secondary">
            {t('capture.counterExampleHint')}
          </Text>
        </Flexbox>
      </Flexbox>

      {/* Right: how it will be judged, and where it lands. */}
      <Flexbox className={styles.right} gap={12}>
        <Form form={form} id={formId} layout="vertical" onFinish={handleFinish}>
          <Form.Item
            label={t('capture.criteria')}
            name="criteria"
            rules={[{ message: t('capture.criteriaRequired'), required: true }]}
          >
            <TextArea
              autoSize={{ maxRows: 10, minRows: 5 }}
              placeholder={t('capture.criteriaPlaceholder')}
            />
          </Form.Item>
          <Text style={{ fontSize: 12 }} type="secondary">
            {t('capture.criteriaHint')}
          </Text>

          <Divider style={{ marginBlock: 12 }} />

          <Form.Item label={t('capture.expected')} name="expected">
            <TextArea
              autoSize={{ maxRows: 5, minRows: 3 }}
              placeholder={t('capture.expectedPlaceholder')}
            />
          </Form.Item>

          <Form.Item
            label={t('capture.dataset')}
            name="datasetId"
            rules={[{ message: t('capture.datasetRequired'), required: true }]}
          >
            <Select
              options={datasets.map((d) => ({ label: d.name, value: d.id }))}
              placeholder={t('capture.datasetPlaceholder')}
            />
          </Form.Item>
        </Form>
      </Flexbox>
    </Flexbox>
  );
};

export default CaptureContent;
