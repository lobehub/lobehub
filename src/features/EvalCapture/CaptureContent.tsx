'use client';

import { Flexbox, Icon } from '@lobehub/ui';
import {
  Button,
  Divider,
  Input,
  Segmented,
  Select,
  Text,
  TextArea,
  toast,
} from '@lobehub/ui/base-ui';
import { Form, useForm } from '@lobehub/ui/base-ui/form';
import { createStaticStyles, cssVar } from 'antd-style';
import { ChevronRight, RotateCw, Sparkles, TriangleAlert } from 'lucide-react';
import { type FC, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { agentEvalService } from '@/services/agentEval';
import { useGlobalStore } from '@/store/global';
import { globalGeneralSelectors } from '@/store/global/selectors';

import { type CaptureDraft } from './buildCaptureDraft';
import {
  buildCapturePayload,
  type CapturedOutputKind,
  type CaptureFormValues,
} from './buildCapturePayload';

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
  draftStatus: css`
    display: flex;
    gap: 8px;
    align-items: flex-start;

    margin-block-end: 8px;
    padding-block: 8px;
    padding-inline: 12px;
    border-radius: ${cssVar.borderRadius};

    font-size: ${cssVar.fontSizeSM};
    line-height: ${cssVar.lineHeightSM};
    color: ${cssVar.colorTextSecondary};

    background: ${cssVar.colorFillTertiary};
  `,
  draftStatusError: css`
    color: ${cssVar.colorWarningText};
    background: ${cssVar.colorWarningBg};
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
  /** The assistant message being captured; its recorded LLM call is what gets frozen. */
  messageId: string;
  onLoadingChange?: (loading: boolean) => void;
  /** `existed`: the dataset already held a case for this answer, so nothing was written. */
  onSaved: (testCaseId: string, datasetName: string, existed?: boolean) => void;
}

const ROLE_KEYS: Record<string, string> = {
  assistant: 'testCaseDetail.role.assistant',
  system: 'testCaseDetail.role.system',
  tool: 'testCaseDetail.role.tool',
  user: 'testCaseDetail.role.user',
};

const CaptureContent: FC<CaptureContentProps> = ({
  draft,
  formId,
  messageId,
  onLoadingChange,
  onSaved,
}) => {
  const { t } = useTranslation('eval');
  const roleLabel = (role: string) => (ROLE_KEYS[role] ? t(ROLE_KEYS[role] as never) : role);
  const form = useForm<CaptureFormValues>({ onSubmit: (values) => handleFinish(values) });
  const [datasets, setDatasets] = useState<Array<{ id: string; name: string }>>([]);
  const [contextOpen, setContextOpen] = useState(false);
  // A capture is usually a complaint, so the counter-example is the default —
  // but the same gesture is used to keep an answer that was right.
  const [kind, setKind] = useState<CapturedOutputKind>('negative');
  const language = useGlobalStore(globalGeneralSelectors.currentLanguage);

  // The criteria starts as a model draft written from the recorded call —
  // the context the judge will never see. Nothing is saved until the user
  // reviews it and presses Save; a draft is a proposal, not a decision.
  const [drafting, setDrafting] = useState(false);
  const [draftedBy, setDraftedBy] = useState<string>();
  const [draftError, setDraftError] = useState<string>();
  // No recorded call: the answer cannot be frozen or drafted from, so the case
  // is saved the old way — as text, without cross-model replay.
  const [unfreezable, setUnfreezable] = useState(false);
  const [note, setNote] = useState('');
  const lastDraft = useRef<{ criteria?: string; expected?: string }>({});

  const requestDraft = useCallback(
    async (nextKind: CapturedOutputKind, nextNote?: string) => {
      setDrafting(true);
      setDraftError(undefined);
      try {
        const result = await agentEvalService.draftTestCaseCriteria({
          capturedOutputKind: nextKind,
          locale: language,
          messageId,
          note: nextNote?.trim() || undefined,
        });
        // Only replace what the user has not edited since the last draft.
        const currentCriteria = form.getValue('criteria');
        if (!currentCriteria?.trim() || currentCriteria === lastDraft.current.criteria) {
          form.setValue('criteria', result.criteria);
        }
        const currentExpected = form.getValue('expected');
        if (
          result.expected &&
          (!currentExpected?.trim() || currentExpected === lastDraft.current.expected)
        ) {
          form.setValue('expected', result.expected);
        }
        lastDraft.current = { criteria: result.criteria, expected: result.expected };
        setDraftedBy(result.model);
      } catch (error) {
        const code = (error as { data?: { code?: string } })?.data?.code;
        if (code === 'PRECONDITION_FAILED') setUnfreezable(true);
        else setDraftError(error instanceof Error ? error.message : String(error));
      } finally {
        setDrafting(false);
      }
    },
    [form, language, messageId],
  );

  useEffect(() => {
    void requestDraft('negative');
  }, []);

  // Switching to "good example" fills the expected answer in, so what will be
  // saved is on screen rather than implied. Switching back only clears it when
  // it is still that same text — never something typed since.
  const handleKindChange = (next: CapturedOutputKind) => {
    setKind(next);
    const current = form.getValue('expected');
    if (next === 'positive' && !current?.trim()) form.setValue('expected', draft.actualOutput);
    if (next === 'negative' && current === draft.actualOutput) form.setValue('expected', '');
    // The verdict direction flips with the kind, so an untouched draft is redrafted.
    const criteria = form.getValue('criteria');
    if (!unfreezable && (!criteria?.trim() || criteria === lastDraft.current.criteria)) {
      void requestDraft(next, note);
    }
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
      // Freezing is idempotent per dataset: a second capture of the same answer
      // returns the case already there and leaves it untouched, so the success
      // phase has to say so rather than claim the edited criteria were saved.
      const { created, testCase } = unfreezable
        ? {
            created: true,
            testCase: await agentEvalService.createTestCase(
              buildCapturePayload(draft, values, kind),
            ),
          }
        : await agentEvalService.freezeTestCaseFromMessage({
            capturedOutputKind: kind,
            criteria: values.criteria,
            datasetId: values.datasetId,
            expected: values.expected?.trim() || undefined,
            messageId,
          });

      const dataset = datasets.find((d) => d.id === values.datasetId);
      // Hands the modal over to its success phase. Deliberately not followed by
      // a `finally` that clears loading: that would re-render the form footer
      // over the success one the phase switch just installed.
      onSaved(testCase.id, dataset?.name ?? '', !created);
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
        <Form form={form} gap={0} id={formId} layout="vertical">
          {unfreezable ? (
            <div className={`${styles.draftStatus} ${styles.draftStatusError}`}>
              <Icon icon={TriangleAlert} size={14} style={{ marginBlockStart: 3 }} />
              <span>{t('capture.draft.unfreezable')}</span>
            </div>
          ) : drafting ? (
            <div className={styles.draftStatus}>
              <Icon spin icon={RotateCw} size={14} style={{ marginBlockStart: 3 }} />
              <span>{t('capture.draft.drafting')}</span>
            </div>
          ) : draftError ? (
            <div className={`${styles.draftStatus} ${styles.draftStatusError}`}>
              <Icon icon={TriangleAlert} size={14} style={{ marginBlockStart: 3 }} />
              <Flexbox flex={1} gap={4}>
                <span>{t('capture.draft.failed')}</span>
                <Flexbox horizontal>
                  <Button size="small" onClick={() => void requestDraft(kind, note)}>
                    {t('capture.draft.retry')}
                  </Button>
                </Flexbox>
              </Flexbox>
            </div>
          ) : (
            draftedBy && (
              <div className={styles.draftStatus}>
                <Icon icon={Sparkles} size={14} style={{ marginBlockStart: 3 }} />
                <span>{t('capture.draft.ready', { model: draftedBy })}</span>
              </div>
            )
          )}
          <Form.Field
            label={t('capture.criteria')}
            name="criteria"
            required={t('capture.criteriaRequired')}
          >
            <TextArea
              autoSize={{ maxRows: 12, minRows: 6 }}
              disabled={drafting}
              placeholder={
                drafting ? t('capture.draft.placeholder') : t('capture.criteriaPlaceholder')
              }
            />
          </Form.Field>
          <Text style={{ fontSize: 12 }} type="secondary">
            {t('capture.criteriaHint')}
          </Text>
          {!unfreezable && (
            <Flexbox horizontal align="center" gap={8} style={{ marginBlockStart: 12 }}>
              <Input
                placeholder={t('capture.draft.notePlaceholder')}
                size="small"
                style={{ flex: 1 }}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                onPressEnter={() => !drafting && void requestDraft(kind, note)}
              />
              <Button
                disabled={drafting}
                icon={RotateCw}
                size="small"
                onClick={() => void requestDraft(kind, note)}
              >
                {t('capture.draft.redraft')}
              </Button>
            </Flexbox>
          )}

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
