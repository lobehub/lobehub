import { Flexbox, Input, Text } from '@lobehub/ui';
import { Button, createModal, ModalFooter, toast, useModalContext } from '@lobehub/ui/base-ui';
import { t as translate } from 'i18next';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useProjectStore } from '@/store/project';

import { getCreateProjectInput, isProjectSlugValid } from './createProjectForm';

interface CreateProjectFormState {
  identifier: string;
  loading: boolean;
  name: string;
  slug: string;
}

const CreateProjectContent = memo(() => {
  const { t } = useTranslation(['project', 'common']);
  const { close } = useModalContext();
  const navigate = useWorkspaceAwareNavigate();
  const createProject = useProjectStore((s) => s.createProject);
  const [form, setForm] = useState<CreateProjectFormState>({
    identifier: '',
    loading: false,
    name: '',
    slug: '',
  });
  const createInput = getCreateProjectInput(form);
  const slugValid = isProjectSlugValid(form.slug);

  const updateForm = (patch: Partial<CreateProjectFormState>) => {
    setForm((current) => ({ ...current, ...patch }));
  };

  const handleCreate = async () => {
    if (!createInput || form.loading) return;
    updateForm({ loading: true });
    try {
      const project = await createProject(createInput);
      close();
      navigate(`/project/${project.id}`);
    } catch (error) {
      console.error('Failed to create project', error);
      toast.error(t('operationFailed', { ns: 'common' }));
    } finally {
      updateForm({ loading: false });
    }
  };

  return (
    <>
      <Flexbox gap={16} padding={16}>
        <Flexbox gap={6}>
          <Text fontSize={13} weight={500}>
            {t('create.nameLabel')}
          </Text>
          <Input
            autoFocus
            maxLength={255}
            placeholder={t('create.namePlaceholder')}
            value={form.name}
            onChange={(event) => updateForm({ name: event.target.value })}
            onPressEnter={handleCreate}
          />
        </Flexbox>
        <Flexbox gap={6}>
          <Text fontSize={13} weight={500}>
            {t('create.identifierLabel')}
          </Text>
          <Input
            maxLength={6}
            placeholder={t('create.identifierPlaceholder')}
            value={form.identifier}
            onChange={(event) => updateForm({ identifier: event.target.value.toUpperCase() })}
            onPressEnter={handleCreate}
          />
          <Text fontSize={12} type="secondary">
            {t('create.identifierDescription')}
          </Text>
        </Flexbox>
        <Flexbox gap={6}>
          <Text fontSize={13} weight={500}>
            {t('create.slugLabel')}
          </Text>
          <Input
            maxLength={100}
            placeholder={t('create.slugPlaceholder')}
            status={slugValid ? undefined : 'error'}
            value={form.slug}
            onChange={(event) => updateForm({ slug: event.target.value.toLowerCase() })}
            onPressEnter={handleCreate}
          />
          <Text fontSize={12} type={slugValid ? 'secondary' : 'danger'}>
            {t(slugValid ? 'create.slugDescription' : 'create.slugInvalid')}
          </Text>
        </Flexbox>
      </Flexbox>
      <ModalFooter>
        <Button onClick={close}>{t('cancel', { ns: 'common' })}</Button>
        <Button
          disabled={!createInput}
          loading={form.loading}
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
    width: 460,
  });
