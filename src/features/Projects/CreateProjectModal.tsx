import { Flexbox, Input, Text } from '@lobehub/ui';
import { Button, createModal, ModalFooter, toast, useModalContext } from '@lobehub/ui/base-ui';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { type ProjectListItem, useProjectStore } from '@/store/project';

import {
  getCreateProjectInput,
  getProjectFieldSuggestions,
  isProjectIdentifierValid,
  isProjectSlugValid,
} from './createProjectForm';

interface CreateProjectOptions {
  /**
   * Handle the created project instead of opening it. Callers that create a
   * project as a step of another action (filing a delivery under a new one)
   * must not have the user navigated away from what they were doing.
   */
  onCreated?: (project: ProjectListItem) => void;
}

interface CreateProjectFormState {
  identifier: string;
  identifierEdited: boolean;
  loading: boolean;
  name: string;
  slug: string;
  slugEdited: boolean;
}

const CreateProjectTitle = memo(() => {
  const { t } = useTranslation('project');

  return t('create.title');
});

const CreateProjectContent = memo<CreateProjectOptions>(({ onCreated }) => {
  const { t } = useTranslation(['project', 'common']);
  const { close } = useModalContext();
  const navigate = useWorkspaceAwareNavigate();
  const createProject = useProjectStore((s) => s.createProject);
  const [form, setForm] = useState<CreateProjectFormState>({
    identifier: '',
    identifierEdited: false,
    loading: false,
    name: '',
    slug: '',
    slugEdited: false,
  });
  const createInput = getCreateProjectInput(form);
  const identifierValid = isProjectIdentifierValid(form.identifier);
  const identifierInvalid =
    (form.identifierEdited || Boolean(form.name.trim())) && !identifierValid;
  const slugValid = isProjectSlugValid(form.slug);

  const updateForm = (patch: Partial<CreateProjectFormState>) => {
    setForm((current) => ({ ...current, ...patch }));
  };

  const updateName = (name: string) => {
    const suggestions = getProjectFieldSuggestions(name);
    setForm((current) => ({
      ...current,
      identifier: current.identifierEdited ? current.identifier : suggestions.identifier,
      name,
      slug: current.slugEdited ? current.slug : suggestions.slug,
    }));
  };

  const handleCreate = async () => {
    if (!createInput || form.loading) return;
    updateForm({ loading: true });
    try {
      const project = await createProject(createInput);
      close();
      if (onCreated) onCreated(project);
      else navigate(`/project/${project.slug ?? project.id}`);
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
            onChange={(event) => updateName(event.target.value)}
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
            status={identifierInvalid ? 'error' : undefined}
            value={form.identifier}
            onPressEnter={handleCreate}
            onChange={(event) =>
              updateForm({ identifier: event.target.value.toUpperCase(), identifierEdited: true })
            }
          />
          <Text fontSize={12} type={identifierInvalid ? 'danger' : 'secondary'}>
            {t(identifierInvalid ? 'create.identifierInvalid' : 'create.identifierDescription')}
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
            onPressEnter={handleCreate}
            onChange={(event) =>
              updateForm({ slug: event.target.value.toLowerCase(), slugEdited: true })
            }
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

export const openCreateProjectModal = (options: CreateProjectOptions = {}) =>
  createModal({
    content: <CreateProjectContent {...options} />,
    footer: null,
    styles: { content: { padding: 0 } },
    title: <CreateProjectTitle />,
    width: 460,
  });
