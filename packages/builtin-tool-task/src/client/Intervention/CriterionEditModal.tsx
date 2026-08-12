'use client';

import { Flexbox, Input, Text, TextArea } from '@lobehub/ui';
import {
  Button,
  createModal,
  type ModalInstance,
  Select,
  Switch,
  useModalContext,
} from '@lobehub/ui/base-ui';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { GoalCriterionDraft } from '../../types';

interface CriterionEditContentProps {
  criterion: GoalCriterionDraft;
  /** Create flow: the criterion only exists once it is saved. */
  isNew?: boolean;
  onSubmit: (value: GoalCriterionDraft) => void;
  seq: number;
}

const CriterionEditTitle = memo<Pick<CriterionEditContentProps, 'isNew' | 'seq'>>(
  ({ isNew, seq }) => {
    const { t } = useTranslation('plugin');

    return isNew
      ? t('builtins.lobe-task.goal.addCriterion')
      : t('builtins.lobe-task.goal.editCriterion', { seq });
  },
);

CriterionEditTitle.displayName = 'GoalCriterionEditTitle';

/**
 * A criterion's judge prompt is the thing the whole loop is scored against, so
 * it gets a real editing surface rather than a row that grows a textarea in
 * place — the same modal treatment the acceptance checklist already uses.
 */
const CriterionEditContent = memo<CriterionEditContentProps>(({ criterion, isNew, onSubmit }) => {
  const { t: tp } = useTranslation('plugin');
  const { close } = useModalContext();
  const [draft, setDraft] = useState<GoalCriterionDraft>(criterion);
  const verifierType = draft.verifierType ?? 'agent';
  const isProgram = verifierType === 'program';

  const patch = (value: Partial<GoalCriterionDraft>) =>
    setDraft((previous) => ({ ...previous, ...value }));

  const handleSave = () => {
    if (!draft.title.trim()) return;
    onSubmit({ ...draft, title: draft.title.trim() });
    close();
  };

  return (
    <Flexbox gap={16}>
      <Flexbox gap={6}>
        <Text fontSize={12} type={'secondary'}>
          {tp('builtins.lobe-task.goal.criterionTitle')}
        </Text>
        <Input value={draft.title} onChange={(event) => patch({ title: event.target.value })} />
      </Flexbox>

      <Flexbox gap={6}>
        <Text fontSize={12} type={'secondary'}>
          {tp('builtins.lobe-task.goal.verifierType')}
        </Text>
        <Select
          value={verifierType}
          options={[
            { label: tp('builtins.lobe-task.goal.verifier.agent'), value: 'agent' },
            { label: tp('builtins.lobe-task.goal.verifier.llm'), value: 'llm' },
            { label: tp('builtins.lobe-task.goal.verifier.program'), value: 'program' },
          ]}
          onChange={(value) => patch({ verifierType: value as GoalCriterionDraft['verifierType'] })}
        />
      </Flexbox>

      <Flexbox gap={6}>
        <Text fontSize={12} type={'secondary'}>
          {isProgram
            ? tp('builtins.lobe-task.goal.script')
            : tp('builtins.lobe-task.goal.judgePrompt')}
        </Text>
        {isProgram ? (
          <TextArea
            autoSize={{ maxRows: 8, minRows: 3 }}
            value={String(draft.verifierConfig?.command ?? '')}
            onChange={(event) =>
              patch({ verifierConfig: { ...draft.verifierConfig, command: event.target.value } })
            }
          />
        ) : (
          <TextArea
            autoSize={{ maxRows: 10, minRows: 4 }}
            placeholder={tp('builtins.lobe-task.goal.instruction')}
            value={draft.instruction ?? ''}
            onChange={(event) => patch({ instruction: event.target.value })}
          />
        )}
      </Flexbox>

      <Flexbox horizontal align={'center'} gap={10}>
        <Switch
          checked={draft.required ?? true}
          size={'small'}
          onChange={(checked) => patch({ required: checked })}
        />
        <Text fontSize={13}>{tp('builtins.lobe-task.goal.requiredHint')}</Text>
      </Flexbox>

      <Flexbox horizontal gap={8} justify={'flex-end'}>
        <Button onClick={close}>{tp('builtins.lobe-task.goal.cancel')}</Button>
        <Button disabled={!draft.title.trim()} type={'primary'} onClick={handleSave}>
          {tp(isNew ? 'builtins.lobe-task.goal.add' : 'builtins.lobe-task.goal.save')}
        </Button>
      </Flexbox>
    </Flexbox>
  );
});

CriterionEditContent.displayName = 'GoalCriterionEditContent';

export const openCriterionEditModal = (props: CriterionEditContentProps): ModalInstance =>
  createModal({
    content: <CriterionEditContent {...props} />,
    footer: null,
    maskClosable: true,
    title: <CriterionEditTitle isNew={props.isNew} seq={props.seq} />,
    width: 'min(90vw, 560px)',
  });
