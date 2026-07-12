'use client';

import { type VerifierType, verifierTypes } from '@lobechat/types';
import { Flexbox, Input, Text, TextArea } from '@lobehub/ui';
import { Button, Select, Switch, useModalContext } from '@lobehub/ui/base-ui';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { VerifyCriterionDraft } from '@/services/verify';

interface VerifyCriterionFormProps {
  initial: VerifyCriterionDraft;
  /** Omitted when the criterion is brand-new and not yet committed. */
  onDelete?: () => void;
  onSubmit: (next: VerifyCriterionDraft) => void;
}

/** Per-criterion editor body: the only place title/notes/verifier/required are edited. */
const VerifyCriterionForm = ({ initial, onDelete, onSubmit }: VerifyCriterionFormProps) => {
  const { t } = useTranslation('chat');
  const { close } = useModalContext();

  const [title, setTitle] = useState(initial.title ?? '');
  const [description, setDescription] = useState(initial.description ?? '');
  const [verifierType, setVerifierType] = useState<VerifierType>(initial.verifierType ?? 'llm');
  const [required, setRequired] = useState(initial.required !== false);

  const verifierOptions = useMemo(
    () =>
      verifierTypes.map((type) => ({
        label: t(`verifyConfig.verifierType.${type}` as const),
        value: type,
      })),
    [t],
  );

  const handleSave = () => {
    const trimmed = title.trim();
    if (!trimmed) return;
    onSubmit({
      ...initial,
      description: description.trim() || undefined,
      required,
      title: trimmed,
      verifierType,
    });
    close();
  };

  return (
    <Flexbox gap={16} padding={16}>
      <Flexbox gap={6}>
        <Text fontSize={12} type={'secondary'}>
          {t('verifyConfig.detail.titleLabel')}
        </Text>
        <Input
          autoFocus
          placeholder={t('verifyConfig.criterionTitlePlaceholder')}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
      </Flexbox>

      <Flexbox gap={6}>
        <Text fontSize={12} type={'secondary'}>
          {t('verifyConfig.detail.descriptionLabel')}
        </Text>
        <TextArea
          autoSize={{ maxRows: 6, minRows: 2 }}
          placeholder={t('verifyConfig.detail.descriptionPlaceholder')}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </Flexbox>

      <Flexbox gap={6}>
        <Text fontSize={12} type={'secondary'}>
          {t('verifyConfig.detail.verifierLabel')}
        </Text>
        <Select
          options={verifierOptions}
          value={verifierType}
          optionRender={(option) => (
            <Flexbox gap={2}>
              <Text>{option.label}</Text>
              <Text fontSize={12} type={'secondary'}>
                {t(`verifyConfig.verifierTypeDesc.${option.value as VerifierType}` as const)}
              </Text>
            </Flexbox>
          )}
          onChange={(value) => setVerifierType(value as VerifierType)}
        />
      </Flexbox>

      <Flexbox horizontal align={'center'} justify={'space-between'}>
        <Text>{t('verifyConfig.required')}</Text>
        <Switch checked={required} onChange={setRequired} />
      </Flexbox>

      <Flexbox horizontal align={'center'} justify={'space-between'}>
        {onDelete ? (
          <Button
            danger
            type={'text'}
            onClick={() => {
              onDelete();
              close();
            }}
          >
            {t('verifyConfig.removeCriterion')}
          </Button>
        ) : (
          <span />
        )}
        <Flexbox horizontal gap={8}>
          <Button onClick={close}>{t('verifyConfig.cancel')}</Button>
          <Button disabled={!title.trim()} type={'primary'} onClick={handleSave}>
            {t('verifyConfig.save')}
          </Button>
        </Flexbox>
      </Flexbox>
    </Flexbox>
  );
};

export default VerifyCriterionForm;
