'use client';

import { Flexbox } from '@lobehub/ui';
import { Input, Text, toast } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { type FC, type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';

import ModelMultiSelect, { fromTargetKey } from '@/features/Eval/components/ModelMultiSelect';
import { agentEvalService } from '@/services/agentEval';

const styles = createStaticStyles(({ css }) => ({
  error: css`
    font-size: ${cssVar.fontSizeSM};
    color: ${cssVar.colorError};
  `,
  label: css`
    font-size: ${cssVar.fontSize};
    font-weight: 500;
    color: ${cssVar.colorText};
  `,
}));

export interface CompareContentProps {
  datasetId: string;
  formId: string;
  /** Preselected `provider/model` keys, e.g. the model that produced the bad case. */
  initialModels?: string[];
  onLoadingChange?: (loading: boolean) => void;
  onStarted: (runId: string) => void;
  /** Compare only these cases; defaults to every frozen case in the dataset. */
  testCaseIds?: string[];
}

const MIN_MODELS = 2;

const CompareContent: FC<CompareContentProps> = ({
  datasetId,
  formId,
  initialModels,
  onLoadingChange,
  onStarted,
  testCaseIds,
}) => {
  const { t } = useTranslation('eval');
  const [models, setModels] = useState<string[]>(initialModels ?? []);
  const [name, setName] = useState('');
  const [touched, setTouched] = useState(false);
  const tooFew = models.length < MIN_MODELS;

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setTouched(true);
    if (tooFew) return;

    onLoadingChange?.(true);
    try {
      const { runId } = await agentEvalService.startReplayComparison({
        datasetId,
        name: name.trim() || undefined,
        targets: models.map(fromTargetKey),
        testCaseIds,
      });
      onStarted(runId);
    } catch (error) {
      toast.error(
        t('compareModal.error', { message: error instanceof Error ? error.message : '' }),
      );
      onLoadingChange?.(false);
    }
  };

  return (
    <form id={formId} onSubmit={handleSubmit}>
      <Flexbox gap={20} paddingBlock={8}>
        <Flexbox gap={8}>
          <span className={styles.label}>{t('compareModal.models')}</span>
          <ModelMultiSelect
            placeholder={t('compareModal.modelsPlaceholder')}
            value={models}
            onChange={setModels}
          />
          {touched && tooFew ? (
            <span className={styles.error}>{t('compareModal.modelsRequired')}</span>
          ) : (
            <Text style={{ fontSize: 12 }} type="secondary">
              {testCaseIds?.length
                ? t('compareModal.scopeCases', { count: testCaseIds.length })
                : t('compareModal.scopeDataset')}
            </Text>
          )}
        </Flexbox>
        <Flexbox gap={8}>
          <span className={styles.label}>{t('compareModal.name')}</span>
          <Input
            placeholder={t('compareModal.namePlaceholder')}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </Flexbox>
      </Flexbox>
    </form>
  );
};

export default CompareContent;
