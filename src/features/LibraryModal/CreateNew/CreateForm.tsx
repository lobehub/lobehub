import { Button, Flexbox, Input, TextArea } from '@lobehub/ui';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useResourceManagerStore } from '@/routes/(main)/resource/features/store';
import { useKnowledgeBaseStore } from '@/store/library';

interface CreateFormProps {
  id?: string;
  initialValues?: { name?: string; description?: string };
  onClose?: () => void;
  onSuccess?: (id: string) => void;
}

const CreateForm = memo<CreateFormProps>(({ id, initialValues, onClose, onSuccess }) => {
  const { t } = useTranslation('knowledgeBase');
  const [loading, setLoading] = useState(false);
  const [name, setName] = useState(initialValues?.name || '');
  const [description, setDescription] = useState(initialValues?.description || '');
  const createNewKnowledgeBase = useKnowledgeBaseStore((s) => s.createNewKnowledgeBase);
  const updateKnowledgeBase = useKnowledgeBaseStore((s) => s.updateKnowledgeBase);
  // Derive KB visibility from the current sidebar mode: "private space" →
  // private KB, "workspace space" → public KB. Personal-mode users have the
  // toggle hidden and `listVisibility` stays at its default 'workspace', so
  // personal-mode create still resolves to 'public' — matching the pre-column
  // default and giving `buildWorkspaceWhere` nothing to filter on.
  const listVisibility = useResourceManagerStore((s) => s.listVisibility);

  const isEditMode = !!id;

  const handleSubmit = async () => {
    if (!name.trim()) return;

    setLoading(true);
    const values = {
      description: description.trim(),
      name: name.trim(),
      visibility: listVisibility === 'private' ? ('private' as const) : ('public' as const),
    };

    try {
      if (isEditMode) {
        await updateKnowledgeBase(id, values);
        setLoading(false);
        onClose?.();
      } else {
        const newId = await createNewKnowledgeBase(values);
        setLoading(false);

        if (onSuccess) {
          onSuccess(newId);
          onClose?.();
        } else {
          window.location.href = `/resource/library/${newId}`;
        }
      }
    } catch (e) {
      console.error(e);
      setLoading(false);
    }
  };

  return (
    <Flexbox gap={16}>
      <Input
        autoFocus
        placeholder={t('createNew.name.placeholder')}
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <Flexbox gap={8}>
        <label style={{ fontSize: 14 }}>{t('createNew.description.label')}</label>
        <TextArea
          placeholder={t('createNew.description.placeholder')}
          style={{ minHeight: 120 }}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </Flexbox>
      <Button block loading={loading} type={'primary'} onClick={handleSubmit}>
        {isEditMode ? t('createNew.edit.confirm') : t('createNew.confirm')}
      </Button>
    </Flexbox>
  );
});

export default CreateForm;
