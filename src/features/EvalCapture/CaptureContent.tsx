'use client';

import { Divider, Flexbox, Icon, Segmented, Select, Text, TextArea, toast } from '@lobehub/ui';
import { Form, useForm } from '@lobehub/ui/form';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { ChevronRight } from 'lucide-react';
import { type FC, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { agentEvalService } from '@/services/agentEval';

import { type CaptureDraft } from './buildCaptureDraft';
import {
  buildCapturePayload,
  type CapturedOutputKind,
  type CaptureFormValues,
} from './buildCapturePayload';
import moduleStyles from './CaptureContent.module.css';

const styles = stylex.create({
  body: {
    overflow: 'hidden',
    maxHeight: 'calc(78vh - 180px)',
  },
  label: {
    fontSize: cssVar.fontSizeSM,
    fontWeight: 500,
    color: cssVar.colorTextSecondary,
  },
  left: {
    overflowY: 'auto',
    flexGrow: '0',
    flexShrink: '0',
    flexBasis: '46%',
    maxHeight: 'calc(78vh - 180px)',
    paddingInlineEnd: '8px',
  },
  msgBody: {
    overflowY: 'auto',
    // Capped so one long turn cannot push the rest out of view; the full text
    // stays reachable by scrolling inside the block.
    maxHeight: '200px',
    paddingBlock: '10px',
    paddingInline: '12px',
    borderRadius: '10px',
    fontSize: cssVar.fontSize,
    lineHeight: 1.75,
    whiteSpace: 'pre-wrap',
    backgroundColor: cssVar.colorFillQuaternary,
    backgroundImage: 'none',
  },
  msgBodyMuted: {
    overflowY: 'auto',
    maxHeight: '96px',
    paddingBlock: '8px',
    paddingInline: '12px',
    borderRadius: '10px',
    fontSize: cssVar.fontSizeSM,
    lineHeight: 1.7,
    color: cssVar.colorTextTertiary,
    whiteSpace: 'pre-wrap',
    backgroundColor: cssVar.colorFillQuaternary,
    backgroundImage: 'none',
  },
  msgHead: {
    fontSize: cssVar.fontSizeSM,
    fontWeight: 500,
    color: cssVar.colorTextTertiary,
  },
  chevron: {
    transition: 'transform 0.15s ease',
  },
  chevronOpen: {
    transform: 'rotate(90deg)',
  },
  contextToggle: {
    cursor: 'pointer',
    display: 'flex',
    gap: '6px',
    alignItems: 'center',
    alignSelf: 'flex-start',
    padding: 0,
    borderWidth: 0,
    borderStyle: 'none',
    fontSize: cssVar.fontSizeSM,
    color: { 'default': cssVar.colorTextTertiary, ':hover': cssVar.colorText },
    backgroundColor: 'transparent',
    backgroundImage: 'none',
  },
  right: {
    overflowY: 'auto',
    flex: '1',
    maxHeight: 'calc(78vh - 180px)',
    paddingInlineEnd: '8px',
  },
});

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
  const form = useForm<CaptureFormValues>({ onSubmit: (values) => handleFinish(values) });
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
    const current = form.getValue('expected');
    if (next === 'positive' && !current?.trim()) form.setValue('expected', draft.actualOutput);
    if (next === 'negative' && current === draft.actualOutput) form.setValue('expected', '');
  };

  useEffect(() => {
    // Every dataset is a valid destination, benchmark-owned or not — one list,
    // rather than fanning out per benchmark and stitching the halves together.
    void agentEvalService
      .listAllDatasets()
      .then((all) => setDatasets((all ?? []) as Array<{ id: string; name: string }>))
      .catch(() => setDatasets([]));
  }, []);

  const handleFinish = async (values: CaptureFormValues) => {
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
    <Flexbox horizontal {...stylex.props(styles.body)} gap={16}>
      {/* Left: what is being captured — read-only, just verify it. */}
      <Flexbox {...stylex.props(styles.left)} gap={12}>
        <span {...stylex.props(styles.label)}>{t('capture.captured')}</span>
        {/* Collapsed by default: it is what the turn was said into, not what is
            being judged, and expanded it buries both below the fold. */}
        {draft.context.length > 0 && (
          <button
            {...stylex.props(styles.contextToggle)}
            type="button"
            onClick={() => setContextOpen((v) => !v)}
          >
            <Icon
              {...stylex.props(styles.chevron, contextOpen && styles.chevronOpen)}
              icon={ChevronRight}
              size={14}
            />
            {t('testCaseDetail.context', { count: draft.context.length })}
          </button>
        )}
        {contextOpen &&
          draft.context.map((message, index) => (
            <Flexbox gap={4} key={index}>
              <span {...stylex.props(styles.msgHead)}>{roleLabel(message.role)}</span>
              <div {...stylex.props(styles.msgBodyMuted)}>{message.content}</div>
            </Flexbox>
          ))}
        <Flexbox gap={4}>
          <span {...stylex.props(styles.msgHead)}>{t('capture.input')}</span>
          <div {...stylex.props(styles.msgBody)}>{draft.input}</div>
        </Flexbox>
        <Flexbox gap={6}>
          <Flexbox horizontal align="center" gap={10}>
            <span {...stylex.props(styles.msgHead)}>{t('capture.actual')}</span>
            <Segmented
              className={moduleStyles.kind}
              size="small"
              value={kind}
              options={[
                { label: t('capture.kind.negative'), value: 'negative' },
                { label: t('capture.kind.positive'), value: 'positive' },
              ]}
              onChange={(value) => handleKindChange(value as CapturedOutputKind)}
            />
          </Flexbox>
          <div {...stylex.props(styles.msgBody)}>{draft.actualOutput}</div>
          <Text style={{ fontSize: 12 }} type="secondary">
            {kind === 'positive' ? t('capture.positiveHint') : t('capture.counterExampleHint')}
          </Text>
        </Flexbox>
      </Flexbox>

      {/* Right: how it will be judged, and where it lands. */}
      <Flexbox {...stylex.props(styles.right)} gap={12}>
        <Form form={form} gap={0} id={formId} layout="vertical">
          <Form.Field
            label={t('capture.criteria')}
            name="criteria"
            required={t('capture.criteriaRequired')}
          >
            <TextArea
              autoSize={{ maxRows: 10, minRows: 5 }}
              placeholder={t('capture.criteriaPlaceholder')}
            />
          </Form.Field>
          <Text style={{ fontSize: 12 }} type="secondary">
            {t('capture.criteriaHint')}
          </Text>

          <Divider style={{ marginBlock: 12 }} />

          <Form.Field label={t('capture.expected')} name="expected">
            <TextArea
              autoSize={{ maxRows: 5, minRows: 3 }}
              placeholder={t('capture.expectedPlaceholder')}
            />
          </Form.Field>

          <Form.Field
            label={t('capture.dataset')}
            name="datasetId"
            required={t('capture.datasetRequired')}
          >
            <Select
              options={datasets.map((d) => ({ label: d.name, value: d.id }))}
              placeholder={t('capture.datasetPlaceholder')}
            />
          </Form.Field>
        </Form>
      </Flexbox>
    </Flexbox>
  );
};

export default CaptureContent;
