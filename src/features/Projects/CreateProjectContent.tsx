import { PROJECT_DUPLICATE_ID, type ProjectDuplicateField } from '@lobechat/types';
import {
  Button,
  cssVar,
  Flexbox,
  Icon,
  Input,
  ModalFooter,
  Text,
  toast,
  useModalContext,
} from '@lobehub/ui';
import { FolderIcon } from 'lucide-react';
import { memo, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { type ProjectListItem, useProjectStore } from '@/store/project';
import { isTrpcErrorCode } from '@/utils/trpcError';

import {
  getCreatedProjectPath,
  getCreateProjectInput,
  getProjectConflictField,
  getProjectFieldSuggestions,
  isProjectIdentifierValid,
  isProjectSlugValid,
} from './createProjectForm';

export interface CreateProjectOptions {
  /**
   * Handle the created project instead of opening it. Callers that create a
   * project as a step of another action (filing a delivery under a new one)
   * must not have the user navigated away from what they were doing.
   */
  onCreated?: (project: ProjectListItem) => void;
}

interface CreateProjectFormState {
  conflict?: { field: ProjectDuplicateField; value: string };
  identifier: string;
  identifierEdited: boolean;
  loading: boolean;
  name: string;
  slug: string;
  slugEdited: boolean;
}

export const CreateProjectTitle = memo(() => {
  const { t } = useTranslation('project');

  return t('create.title');
});

const CreateProjectContent = memo<CreateProjectOptions>(({ onCreated }) => {
  const { t } = useTranslation(['project', 'common']);
  const { close } = useModalContext();
  const navigate = useWorkspaceAwareNavigate();
  const createProject = useProjectStore((s) => s.createProject);
  const identifierDescriptionId = useId();
  const slugDescriptionId = useId();
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
  const conflictField =
    form.conflict && form[form.conflict.field].trim() === form.conflict.value
      ? form.conflict.field
      : undefined;
  const identifierTaken = conflictField === 'identifier';
  const slugTaken = conflictField === 'slug';
  const identifierError = identifierInvalid || identifierTaken;
  const slugError = !slugValid || slugTaken;

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
    if (!createInput || form.loading || conflictField) return;
    updateForm({ conflict: undefined, loading: true });
    try {
      const project = await createProject(createInput);
      close();
      if (onCreated) {
        onCreated(project);
      } else {
        const path = getCreatedProjectPath(project);
        if (path) navigate(path);
        // Staying put, the new row in the sidebar is the only sign it worked.
        else toast.success(t('create.success', { name: project.name }));
      }
    } catch (error) {
      const field = getProjectConflictField(error);
      if (field) {
        const value = createInput[field];
        if (value) updateForm({ conflict: { field, value } });
        else toast.error(t('create.slugTaken'));
        return;
      }
      if (
        isTrpcErrorCode(error, 'CONFLICT') &&
        error instanceof Error &&
        error.message === PROJECT_DUPLICATE_ID
      ) {
        toast.error(t('create.idConflict'));
        return;
      }
      console.error('Failed to create project', error);
      toast.error(t('operationFailed', { ns: 'common' }));
    } finally {
      updateForm({ loading: false });
    }
  };

  return (
    <>
      <Flexbox data-brand-slot={'project-form'} gap={16} padding={16}>
        <Flexbox data-brand-slot={'project-name-field'} gap={6}>
          <Text fontSize={13} weight={500}>
            {t('create.nameLabel')}
          </Text>
          <Input
            autoFocus
            maxLength={255}
            placeholder={t('create.namePlaceholder')}
            prefix={<Icon icon={FolderIcon} size={16} />}
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
            aria-describedby={identifierDescriptionId}
            aria-invalid={identifierError}
            aria-label={t('create.identifierLabel')}
            maxLength={6}
            placeholder={t('create.identifierPlaceholder')}
            style={identifierError ? { borderColor: cssVar.colorError } : undefined}
            value={form.identifier}
            onPressEnter={handleCreate}
            onChange={(event) =>
              updateForm({ identifier: event.target.value.toUpperCase(), identifierEdited: true })
            }
          />
          <Text
            aria-live="polite"
            fontSize={12}
            id={identifierDescriptionId}
            type={identifierError ? 'danger' : 'secondary'}
          >
            {t(
              identifierTaken
                ? 'create.identifierTaken'
                : identifierInvalid
                  ? 'create.identifierInvalid'
                  : 'create.identifierDescription',
            )}
          </Text>
        </Flexbox>
        <Flexbox gap={6}>
          <Text fontSize={13} weight={500}>
            {t('create.slugLabel')}
          </Text>
          <Input
            aria-describedby={slugDescriptionId}
            aria-invalid={slugError}
            aria-label={t('create.slugLabel')}
            maxLength={100}
            placeholder={t('create.slugPlaceholder')}
            style={slugError ? { borderColor: cssVar.colorError } : undefined}
            value={form.slug}
            onPressEnter={handleCreate}
            onChange={(event) =>
              updateForm({ slug: event.target.value.toLowerCase(), slugEdited: true })
            }
          />
          <Text
            aria-live="polite"
            fontSize={12}
            id={slugDescriptionId}
            type={slugError ? 'danger' : 'secondary'}
          >
            {t(
              slugTaken
                ? 'create.slugTaken'
                : slugValid
                  ? 'create.slugDescription'
                  : 'create.slugInvalid',
            )}
          </Text>
        </Flexbox>
      </Flexbox>
      <ModalFooter>
        <Button onClick={close}>{t('cancel', { ns: 'common' })}</Button>
        <Button
          disabled={!createInput || !!conflictField}
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

export default CreateProjectContent;
