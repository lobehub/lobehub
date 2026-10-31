import { Button, Flexbox, Icon, Input, ModalFooter, Segmented, Text, TextArea } from '@lobehub/ui';
import { LockIcon, UsersIcon } from 'lucide-react';
import { memo, useId } from 'react';
import { useTranslation } from 'react-i18next';

import CoverPicker from '@/features/LibraryCover/CoverPicker';
import type { ResourceListVisibilityFilter } from '@/features/ResourceManager/store/initialState';

import { type LibraryFormOptions, useLibraryForm } from './useLibraryForm';

export const LIBRARY_NAME_MAX_LENGTH = 255;

const CreateForm = memo<LibraryFormOptions>((props) => {
  const { t } = useTranslation(['knowledgeBase', 'common']);
  const fieldId = useId();
  const {
    cover,
    description,
    draftSeed,
    isEditMode,
    loading,
    name,
    nameError,
    setCover,
    setDescription,
    setName,
    setVisibility,
    showVisibility,
    submit,
    submitDisabled,
    visibility,
  } = useLibraryForm(props);

  return (
    <>
      <Flexbox gap={16} padding={16}>
        <Flexbox gap={6}>
          <Text fontSize={13} id={`${fieldId}-name`} weight={500}>
            {t('createNew.name.label')}
          </Text>
          <Input
            autoFocus
            aria-invalid={nameError}
            aria-labelledby={`${fieldId}-name`}
            data-invalid={nameError ? '' : undefined}
            maxLength={LIBRARY_NAME_MAX_LENGTH}
            placeholder={t('createNew.name.placeholder')}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onPressEnter={submit}
          />
          {nameError && (
            <Text fontSize={12} type={'danger'}>
              {t('createNew.name.required')}
            </Text>
          )}
        </Flexbox>
        {showVisibility && (
          <Flexbox gap={6}>
            <Text fontSize={13} id={`${fieldId}-visibility`} weight={500}>
              {t('createNew.visibility.label')}
            </Text>
            <Segmented
              block
              aria-labelledby={`${fieldId}-visibility`}
              value={visibility}
              options={[
                {
                  icon: <Icon icon={LockIcon} />,
                  label: t('createNew.visibility.private'),
                  value: 'private',
                },
                {
                  icon: <Icon icon={UsersIcon} />,
                  label: t('createNew.visibility.workspace'),
                  value: 'workspace',
                },
              ]}
              onChange={(value) => setVisibility(value as ResourceListVisibilityFilter)}
            />
            <Text fontSize={12} type={'secondary'}>
              {t(
                visibility === 'private'
                  ? 'createNew.visibility.privateHelp'
                  : 'createNew.visibility.workspaceHelp',
              )}
            </Text>
          </Flexbox>
        )}
        <Flexbox gap={6}>
          <Text fontSize={13} id={`${fieldId}-description`} weight={500}>
            {t('createNew.description.label')}
          </Text>
          <TextArea
            aria-labelledby={`${fieldId}-description`}
            autoSize={{ maxRows: 6, minRows: 3 }}
            placeholder={t('createNew.description.placeholder')}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
          <Text fontSize={12} type={'secondary'}>
            {t('createNew.description.help')}
          </Text>
        </Flexbox>
        <Flexbox gap={6}>
          <Text fontSize={13} weight={500}>
            {t('createNew.cover.label')}
          </Text>
          <CoverPicker seed={draftSeed} value={cover} onChange={setCover} />
        </Flexbox>
      </Flexbox>
      <ModalFooter>
        <Button onClick={props.onClose}>{t('cancel', { ns: 'common' })}</Button>
        <Button disabled={submitDisabled} loading={loading} type={'primary'} onClick={submit}>
          {isEditMode ? t('createNew.edit.confirm') : t('createNew.confirm')}
        </Button>
      </ModalFooter>
    </>
  );
});

export default CreateForm;
