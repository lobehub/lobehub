import { PROJECT_IDENTIFIER_REGEX } from '@lobechat/types';
import { Flexbox, Input, Text } from '@lobehub/ui';
import { Button, createModal, ModalFooter, toast, useModalContext } from '@lobehub/ui/base-ui';
import { t as translate } from 'i18next';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useProjectStore } from '@/store/project';

const CreateProjectContent = memo(() => {
  const { t } = useTranslation(['project', 'common']);
  const { close } = useModalContext();
  const navigate = useWorkspaceAwareNavigate();
  const createProject = useProjectStore((s) => s.createProject);
  const [name, setName] = useState('');
  const [identifier, setIdentifier] = useState('');
  const [loading, setLoading] = useState(false);
  const normalizedIdentifier = identifier.trim().toUpperCase();
  const identifierValid = PROJECT_IDENTIFIER_REGEX.test(normalizedIdentifier);

  const handleCreate = async () => {
    const value = name.trim();
    if (!value || !identifierValid || loading) return;
    setLoading(true);
    try {
      const project = await createProject({ identifier: normalizedIdentifier, name: value });
      close();
      navigate(`/project/${project.id}`);
    } catch (error) {
      console.error('Failed to create project', error);
      toast.error(t('operationFailed', { ns: 'common' }));
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Flexbox gap={16} padding={16}>
        <Flexbox gap={6}>
          <Text fontSize={13} weight={500}>
            {t('create.identifierLabel')}
          </Text>
          <Input
            autoFocus
            maxLength={6}
            placeholder={t('create.identifierPlaceholder')}
            value={identifier}
            onChange={(event) => setIdentifier(event.target.value.toUpperCase())}
            onPressEnter={handleCreate}
          />
          <Text fontSize={12} type="secondary">
            {t('create.identifierDescription')}
          </Text>
        </Flexbox>
        <Flexbox gap={6}>
          <Text fontSize={13} weight={500}>
            {t('create.nameLabel')}
          </Text>
          <Input
            maxLength={255}
            placeholder={t('create.namePlaceholder')}
            value={name}
            onChange={(event) => setName(event.target.value)}
            onPressEnter={handleCreate}
          />
        </Flexbox>
      </Flexbox>
      <ModalFooter>
        <Button onClick={close}>{t('cancel', { ns: 'common' })}</Button>
        <Button
          disabled={!name.trim() || !identifierValid}
          loading={loading}
          type="primary"
          onClick={handleCreate}
        >
          {t('create.action')}
        </Button>
      </ModalFooter>
    </>
  );
});

export const openCreateProjectModal = () =>
  createModal({
    content: <CreateProjectContent />,
    footer: null,
    styles: { content: { padding: 0 } },
    title: translate('create.title', { ns: 'project' }),
    width: 420,
  });
