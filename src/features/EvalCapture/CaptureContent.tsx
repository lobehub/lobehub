'use client';

import { Flexbox, Icon, TextArea } from '@lobehub/ui';
import { Segmented, Select, Text, toast } from '@lobehub/ui/base-ui';
import { Divider, Form } from 'antd';
import { createStaticStyles, cssVar } from 'antd-style';
import { ChevronRight } from 'lucide-react';
import { type FC, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { agentEvalService } from '@/services/agentEval';

import { type CaptureDraft } from './buildCaptureDraft';
import { buildCapturePayload, type CapturedOutputKind } from './buildCapturePayload';

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
  kind: css`
    /* Sized down to sit with the label it qualifies rather than compete with it. */
    font-size: ${cssVar.fontSizeSM};

    [role='tab'],
    button {
      padding-block: 1px;
      padding-inline: 8px;
    }
  `,
  msgHead: css`
    font-size: ${cssVar.fontSizeSM};
    font-weight: 500;
    color: ${cssVar.colorTextTertiary};
  `,
  chevron: css`
    transition: transform 0.15s ease;
  `,
  chevronOpen: css`
    transform: rotate(90deg);
  `,
  contextToggle: css`
    cursor: pointer;

    display: flex;
    gap: 6px;
    align-items: center;
    align-self: flex-start;

    padding: 0;
    border: none;

    font-size: ${cssVar.fontSizeSM};
    color: ${cssVar.colorTextTertiary};

    background: transparent;

    &:hover {
      color: ${cssVar.colorText};
    }
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

const ROLE_KEYS: Record<string, string> = {
  assistant: 'testCaseDetail.role.assistant',
  system: 'testCaseDetail.role.system',
  tool: 'testCaseDetail.role.tool',
  user: 'testCaseDetail.role.user',
};

const CaptureContent: FC<CaptureContentProps> = ({ draft, formId, onLoadingChange, onSaved }) => {
  const { t } = useTranslation('eval');
  const roleLabel = (role: string) => (ROLE_KEYS[role] ? t(ROLE_KEYS[role] as never) : role);
  const [form] = Form.useForm();
  const [datasets, setDatasets] = useState<Array<{ id: string; name: string }>>([]);
  const [contextOpen, setContextOpen] = useState(false);
  // A capture is usually a complaint, so the counter-example is the default —
  // but the same gesture is used to keep an answer that was right.
  const [kind, setKind] = useState<CapturedOutputKind>('negative');

  // Switching to "good example" fills the expected answer in, so what will be
  // saved is on screen rather than implied. Switching back only clears it when
  // it is still that same text — never something typed since.
  const handleKindChange = (next: CapturedOutputKind) => {
    setKind(next);
    const current = form.getFieldValue('expected');
    if (next === 'positive' && !current?.trim()) form.setFieldValue('expected', draft.actualOutput);
    if (next === 'negative' && current === draft.actualOutput) form.setFieldValue('expected', '');
  };

  useEffect(() => {
    // Every dataset is a valid destination, benchmark-owned or not — one list,
    // rather than fanning out per benchmark and stitching the halves together.
    void agentEvalService
      .listAllDatasets()
      .then((all) => setDatasets((all ?? []) as Array<{ id: string; name: string }>))
      .catch(() => setDatasets([]));
  }, []);

  const handleFinish = async (values: any) => {
    onLoadingChange?.(true);
    try {
      const created = await agentEvalService.createTestCase(
        buildCapturePayload(draft, values, kind),
      );

      const dataset = datasets.find((d) => d.id === values.datasetId);
      // Hands the modal over to its success phase. Deliberately not followed by
      // a `finally` that clears loading: that would re-render the form footer
      // over the success one the phase switch just installed.
      onSaved(created.id, dataset?.name ?? '');
    } catch {
      toast.error(t('capture.error'));
      onLoadingChange?.(false);
    }
  };

  return (
    <Flexbox horizontal className={styles.body} gap={16}>
      {/* Left: what is being captured — read-only, just verify it. */}
      <Flexbox className={styles.left} gap={12}>
        <span className={styles.label}>{t('capture.captured')}</span>
        {/* Collapsed by default: it is what the turn was said into, not what is
            being judged, and expanded it buries both below the fold. */}
        {draft.context.length > 0 && (
          <button
            className={styles.contextToggle}
            type="button"
            onClick={() => setContextOpen((v) => !v)}
          >
            <Icon
              className={contextOpen ? `${styles.chevron} ${styles.chevronOpen}` : styles.chevron}
              icon={ChevronRight}
              size={14}
            />
            {t('testCaseDetail.context', { count: draft.context.length })}
          </button>
        )}
        {contextOpen &&
          draft.context.map((message, index) => (
            <Flexbox gap={4} key={index}>
              <span className={styles.msgHead}>{roleLabel(message.role)}</span>
              <div className={styles.msgBodyMuted}>{message.content}</div>
            </Flexbox>
          ))}
        <Flexbox gap={4}>
          <span className={styles.msgHead}>{t('capture.input')}</span>
          <div className={styles.msgBody}>{draft.input}</div>
        </Flexbox>
        <Flexbox gap={6}>
          <Flexbox horizontal align="center" gap={10}>
            <span className={styles.msgHead}>{t('capture.actual')}</span>
            <Segmented
              className={styles.kind}
              size="small"
              value={kind}
              options={[
                { label: t('capture.kind.negative'), value: 'negative' },
                { label: t('capture.kind.positive'), value: 'positive' },
              ]}
              onChange={(value) => handleKindChange(value as CapturedOutputKind)}
            />
          </Flexbox>
          <div className={styles.msgBody}>{draft.actualOutput}</div>
          <Text style={{ fontSize: 12 }} type="secondary">
            {kind === 'positive' ? t('capture.positiveHint') : t('capture.counterExampleHint')}
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
