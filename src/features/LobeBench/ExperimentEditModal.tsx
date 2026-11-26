'use client';

import type { AgentEvalExperimentListItem } from '@lobechat/types';
import {
  Button,
  createModal,
  Flexbox,
  Input,
  Text,
  TextArea,
  toast,
  useModalContext,
} from '@lobehub/ui';
import { t as translate } from 'i18next';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import InlineErrorText from '@/components/InlineErrorText';
import { type InlineErrorState, toInlineError } from '@/components/InlineErrorText/errorDetail';
import { isLobeBenchMeta } from '@/features/LobeBench/lobeBench';
import { agentEvalService } from '@/services/agentEval';

type EditableExperiment = Pick<AgentEvalExperimentListItem, 'id' | 'name' | 'metadata'>;

interface ExperimentEditFormProps {
  experiment: EditableExperiment;
  onSaved?: () => Promise<unknown> | void;
}

/**
 * Name and question of an experiment. The case set, contenders and attempts are frozen
 * once the experiment starts, so they are not editable here.
 */
const ExperimentEditForm = memo<ExperimentEditFormProps>(({ experiment, onSaved }) => {
  const { t } = useTranslation('eval');
  const { close } = useModalContext();
  const meta = isLobeBenchMeta(experiment.metadata) ? experiment.metadata : undefined;
  const [name, setName] = useState(experiment.name ?? '');
  const [question, setQuestion] = useState(meta?.question ?? '');
  const [saving, setSaving] = useState(false);
  /** Save failure shown above the buttons; the modal stays open with the user's input. */
  const [error, setError] = useState<InlineErrorState | null>(null);

  const submit = async () => {
    setError(null);
    setSaving(true);
    try {
      const trimmedName = name.trim();
      const trimmedQuestion = question.trim();
      await agentEvalService.updateExperiment({
        id: experiment.id,
        // The whole metadata object is stored, so keep every other Lobe Bench field.
        metadata: {
          ...(experiment.metadata as Record<string, unknown> | null | undefined),
          question: trimmedQuestion || undefined,
        },
        // An empty name keeps the current one (the server requires a string).
        name: trimmedName || experiment.name || undefined,
      });
      toast.success(t('lobeBench.experiment.edit.saved'));
      await onSaved?.();
      close();
    } catch (cause) {
      console.error('Failed to save Lobe Bench experiment:', cause);
      setError(toInlineError(t('lobeBench.experiment.edit.failedRetry'), cause));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Flexbox gap={16}>
      <Flexbox gap={6}>
        <Text weight={500}>{t('lobeBench.new.name')}</Text>
        <Input
          id={'lobe-bench-experiment-name'}
          placeholder={t('lobeBench.new.name.placeholder')}
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setError(null);
          }}
        />
      </Flexbox>
      <Flexbox gap={6}>
        <Text weight={500}>{t('lobeBench.new.question')}</Text>
        <TextArea
          autoSize={{ maxRows: 5, minRows: 2 }}
          id={'lobe-bench-experiment-question'}
          placeholder={t('lobeBench.new.question.placeholder')}
          value={question}
          onChange={(e) => {
            setQuestion(e.target.value);
            setError(null);
          }}
        />
      </Flexbox>
      {error && <InlineErrorText detail={error.detail}>{error.summary}</InlineErrorText>}
      <Flexbox horizontal gap={8} justify={'flex-end'}>
        <Button onClick={close}>{t('common.cancel')}</Button>
        <Button loading={saving} type={'primary'} onClick={submit}>
          {t('common.save')}
        </Button>
      </Flexbox>
    </Flexbox>
  );
});

ExperimentEditForm.displayName = 'LobeBenchExperimentEditForm';

/** Opens the Lab-style Edit dialog for an experiment; `onSaved` runs after a successful save. */
export const openExperimentEditModal = (
  experiment: EditableExperiment,
  onSaved?: () => Promise<unknown> | void,
) =>
  createModal({
    content: <ExperimentEditForm experiment={experiment} onSaved={onSaved} />,
    footer: null,
    title: translate('lobeBench.experiment.edit.title', { ns: 'eval' }),
    width: 520,
  });
