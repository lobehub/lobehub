import { Flexbox, Input } from '@lobehub/ui';
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
  const [loading, setLoading] = useState(false);

  const handleCreate = async () => {
    const value = name.trim();
    if (!value || loading) return;
    setLoading(true);
    try {
      const project = await createProject(value);
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
      <Flexbox padding={16}>
        <Input
          autoFocus
          maxLength={255}
          placeholder={t('create.namePlaceholder')}
          value={name}
          onChange={(event) => setName(event.target.value)}
          onPressEnter={handleCreate}
        />
      </Flexbox>
      <ModalFooter>
        <Button onClick={close}>{t('cancel', { ns: 'common' })}</Button>
        <Button disabled={!name.trim()} loading={loading} type="primary" onClick={handleCreate}>
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
