'use client';

import { type VerifierType, verifierTypes } from '@lobechat/const/verify';
import { Flexbox, Input, Text, TextArea } from '@lobehub/ui';
import { Button, Select, Switch } from '@lobehub/ui/base-ui';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { VerifyCriterionDraft } from '@/services/verify';

/**
 * True when the criterion's judging rule lives in a linked document this editor
 * neither loads nor can update (`updateCriterion` carries no instruction
 * field). Rendering an editable blank box in that state would silently discard
 * whatever the user types into it, so the editor shows a read-only note.
 */
export const hasLinkedInstruction = (
  initial: Pick<VerifyCriterionDraft, 'documentId' | 'instruction'>,
) => Boolean(initial.documentId) && !initial.instruction;

export interface CriterionEditorProps {
  initial: VerifyCriterionDraft;
  /** Create flow: the criterion only exists once it is saved. */
  isNew?: boolean;
  onClose: () => void;
  /** Omitted when the criterion is brand-new and not yet committed. */
  onDelete?: () => void;
  onSubmit: (next: VerifyCriterionDraft) => void;
}

/**
 * The single criterion editing surface, shared by goal creation, the /goal
 * intervention card, and the task verify config (modal and drawer alike). A
 * criterion's judge prompt is the thing the whole loop is scored against, so it
 * gets a real editing surface rather than a row that grows a textarea in place.
 */
export const CriterionEditor = ({
  initial,
  isNew,
  onClose,
  onDelete,
  onSubmit,
}: CriterionEditorProps) => {
  const { t } = useTranslation('verify');
  const [draft, setDraft] = useState<VerifyCriterionDraft>(initial);
  const verifierType = draft.verifierType ?? 'llm';
  const isProgram = verifierType === 'program';
  const instructionLinked = hasLinkedInstruction(initial);

  const patch = (value: Partial<VerifyCriterionDraft>) =>
    setDraft((previous) => ({ ...previous, ...value }));

  const verifierOptions = useMemo(
    () =>
      verifierTypes.map((type) => ({
        label: t(`criterion.verifierType.${type}` as const),
        value: type,
      })),
    [t],
  );

  const handleSave = () => {
    const title = draft.title.trim();
    if (!title) return;
    onSubmit({
      ...draft,
      description: draft.description?.trim() || undefined,
      // Empty means "not overridden": criteria whose rubric lives in a linked
      // document keep the documentId instead of gaining a blank inline rule.
      instruction: draft.instruction?.trim() ? draft.instruction : undefined,
      title,
    });
    onClose();
  };

  return (
    <Flexbox gap={16} padding={16}>
      <Flexbox gap={6}>
        <Text fontSize={12} type={'secondary'}>
          {t('criterion.titleLabel')}
        </Text>
        <Input
          autoFocus
          placeholder={t('criterion.titlePlaceholder')}
          value={draft.title}
          onChange={(event) => patch({ title: event.target.value })}
        />
      </Flexbox>

      <Flexbox gap={6}>
        <Text fontSize={12} type={'secondary'}>
          {t('criterion.descriptionLabel')}
        </Text>
        <TextArea
          autoSize={{ maxRows: 6, minRows: 2 }}
          placeholder={t('criterion.descriptionPlaceholder')}
          value={draft.description ?? ''}
          onChange={(event) => patch({ description: event.target.value })}
        />
      </Flexbox>

      <Flexbox gap={6}>
        <Text fontSize={12} type={'secondary'}>
          {t('criterion.verifierLabel')}
        </Text>
        <Select
          options={verifierOptions}
          value={verifierType}
          optionRender={(option) => (
            <Flexbox gap={2}>
              <Text>{option.label}</Text>
              <Text fontSize={12} type={'secondary'}>
                {t(`criterion.verifierTypeDesc.${option.value as VerifierType}` as const)}
              </Text>
            </Flexbox>
          )}
          onChange={(value) => patch({ verifierType: value as VerifierType })}
        />
      </Flexbox>

      <Flexbox gap={6}>
        <Text fontSize={12} type={'secondary'}>
          {isProgram ? t('criterion.scriptLabel') : t('criterion.instructionLabel')}
        </Text>
        {isProgram ? (
          <TextArea
            autoSize={{ maxRows: 8, minRows: 3 }}
            value={String(draft.verifierConfig?.command ?? '')}
            onChange={(event) =>
              patch({ verifierConfig: { ...draft.verifierConfig, command: event.target.value } })
            }
          />
        ) : instructionLinked ? (
          <Text fontSize={12} type={'secondary'}>
            {t('criterion.instructionLinked')}
          </Text>
        ) : (
          <TextArea
            autoSize={{ maxRows: 10, minRows: 3 }}
            placeholder={t('criterion.instructionPlaceholder')}
            value={draft.instruction ?? ''}
            onChange={(event) => patch({ instruction: event.target.value })}
          />
        )}
      </Flexbox>

      <Flexbox horizontal align={'center'} gap={10}>
        <Switch
          checked={draft.required !== false}
          size={'small'}
          onChange={(checked) => patch({ required: checked })}
        />
        <Text fontSize={13}>{t('criterion.requiredHint')}</Text>
      </Flexbox>

      <Flexbox horizontal align={'center'} justify={'space-between'}>
        {onDelete ? (
          <Button
            danger
            type={'text'}
            onClick={() => {
              onDelete();
              onClose();
            }}
          >
            {t('criterion.delete')}
          </Button>
        ) : (
          <span />
        )}
        <Flexbox horizontal gap={8}>
          <Button onClick={onClose}>{t('criterion.cancel')}</Button>
          <Button disabled={!draft.title.trim()} type={'primary'} onClick={handleSave}>
            {t(isNew ? 'criterion.add' : 'criterion.save')}
          </Button>
        </Flexbox>
      </Flexbox>
    </Flexbox>
  );
};
