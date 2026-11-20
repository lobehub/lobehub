import { Button, Flexbox, Input, ModalFooter, Text, toast, useModalContext } from '@lobehub/ui';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useAgentStore } from '@/store/agent';
import { builtinAgentSelectors } from '@/store/agent/selectors';
import { useHomeStore } from '@/store/home';
import { type ProjectListItem, useLoadedProjectList, useProjectStore } from '@/store/project';

import {
  buildCreateProjectRequest,
  DEFAULT_MAIN_AGENT_MODE,
  doesConflictApplyTo,
  getCreateProjectInput,
  getProjectConflictField,
  getProjectFieldSuggestions,
  isProjectIdentifierTaken,
  isProjectIdentifierValid,
  isProjectSlugValid,
  type MainAgentMode,
  reserveProjectIds,
} from './createProjectForm';
import CreateProjectMoreFields from './CreateProjectMoreFields';
import MainAgentSection from './MainAgentSection';
import ProjectAvatarField from './ProjectAvatarField';

export interface CreateProjectOptions {
  /**
   * Handle the created project instead of opening it. Callers that create a
   * project as a step of another action (filing a delivery under a new one)
   * must not have the user navigated away from what they were doing.
   */
  onCreated?: (project: ProjectListItem) => void;
}

interface CreateProjectFormState {
  /** Emoji or uploaded image URL; a dedicated main agent takes it over too. */
  avatar?: string;
  /** Creating now would save the project, and its agent, without the avatar on its way. */
  avatarUploading: boolean;
  identifier: string;
  /** Set when the server rejects the identifier as already taken. */
  identifierConflict: boolean;
  loading: boolean;
  /** Explicit pick in this modal; otherwise LobeAI. */
  mainAgentId?: string;
  mainAgentMode: MainAgentMode;
  name: string;
  slug: string;
  /** Set when the server rejects the slug as already taken in this scope. */
  slugConflict: boolean;
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
  const loadedProjects = useLoadedProjectList();
  const [form, setForm] = useState<CreateProjectFormState>({
    avatarUploading: false,
    identifier: '',
    identifierConflict: false,
    loading: false,
    mainAgentMode: DEFAULT_MAIN_AGENT_MODE,
    name: '',
    slug: '',
    slugConflict: false,
    slugEdited: false,
  });
  // Taken once per open modal: both generated avatars are seeded by these ids.
  const [reservedIds] = useState(reserveProjectIds);
  const inboxAgentId = useAgentStore(builtinAgentSelectors.inboxAgentId);
  const mainAgentId = form.mainAgentId ?? inboxAgentId;
  const createInput = getCreateProjectInput(form);
  const identifierInvalid =
    Boolean(form.identifier.trim()) && !isProjectIdentifierValid(form.identifier);
  // Identifiers are unique per scope, so a name whose derived prefix is already
  // taken (two projects starting with "lobe…") would otherwise only fail after
  // submit, as an opaque "operation failed".
  const identifierTaken =
    form.identifierConflict ||
    (loadedProjects ? isProjectIdentifierTaken(form.identifier, loadedProjects) : false);
  const slugValid = isProjectSlugValid(form.slug);
  // Slugs are unique per scope too, so a name that derives an already-used slug
  // ("LobeHub" twice) must report it on the slug field, not on the identifier.
  const slugTaken = form.slugConflict;

  const updateForm = (patch: Partial<CreateProjectFormState>) => {
    setForm((current) => ({ ...current, ...patch }));
  };

  const updateName = (name: string) => {
    const suggestions = getProjectFieldSuggestions(name);
    setForm((current) => ({
      ...current,
      name,
      slug: current.slugEdited ? current.slug : suggestions.slug,
      // A derived slug changes with the name, so a conflict reported for the
      // previous one no longer applies. A slug typed by hand stays put.
      slugConflict: current.slugEdited ? current.slugConflict : false,
    }));
  };

  const handleCreate = async () => {
    if (!createInput || identifierTaken || slugTaken || form.loading || form.avatarUploading)
      return;
    const submittedIdentifier = createInput.identifier ?? '';
    const submittedSlug = createInput.slug ?? '';
    updateForm({ loading: true });
    try {
      const project = await createProject(
        buildCreateProjectRequest(createInput, {
          avatar: form.avatar,
          ids: reservedIds,
          mainAgentId,
          mainAgentMode: form.mainAgentMode,
        }),
      );
      if (form.mainAgentMode === 'dedicated') {
        // The project created an agent and maybe the Project label; show both.
        const { refreshAgentLabels, refreshAgentList } = useHomeStore.getState();
        void Promise.all([refreshAgentList(), refreshAgentLabels()]);
      }
      close();
      if (onCreated) onCreated(project);
      else navigate(`/project/${project.slug ?? project.id}`);
    } catch (error) {
      console.error('Failed to create project', error);
      // The unique index stays the final authority: a concurrent create, or a
      // private project by another member that the loaded list cannot see, can
      // still collide after the inline check. The server names the field it
      // rejected, so the error lands on that input instead of a generic toast.
      const conflict = getProjectConflictField(error);
      if (conflict === 'identifier') {
        setForm((current) => ({
          ...current,
          // Only the identifier that was submitted is known to be taken. The
          // field stays editable while the request is in flight, so a value
          // typed meanwhile must not inherit that verdict.
          identifierConflict: doesConflictApplyTo(submittedIdentifier, current.identifier),
        }));
        return;
      }
      if (conflict === 'slug') {
        setForm((current) => ({
          ...current,
          slugConflict: doesConflictApplyTo(submittedSlug, current.slug),
        }));
        return;
      }
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
          <ProjectAvatarField
            avatar={form.avatar}
            disabled={form.loading}
            id={reservedIds.projectId}
            name={form.name}
            onChange={(avatar) => updateForm({ avatar })}
            onUploadingChange={(avatarUploading) => updateForm({ avatarUploading })}
          >
            <Input
              autoFocus
              maxLength={255}
              placeholder={t('create.namePlaceholder')}
              value={form.name}
              onChange={(event) => updateName(event.target.value)}
              onPressEnter={handleCreate}
            />
          </ProjectAvatarField>
        </Flexbox>
        <MainAgentSection
          agentId={mainAgentId}
          dedicatedAgentId={reservedIds.agentId}
          disabled={form.loading}
          mode={form.mainAgentMode}
          projectAvatar={form.avatar}
          projectName={form.name}
          onAgentChange={(id) => updateForm({ mainAgentId: id })}
          onModeChange={(mainAgentMode) => updateForm({ mainAgentMode })}
        />
        <CreateProjectMoreFields
          identifier={form.identifier}
          identifierInvalid={identifierInvalid}
          identifierTaken={identifierTaken}
          slug={form.slug}
          slugTaken={slugTaken}
          slugValid={slugValid}
          onIdentifierChange={(identifier) => updateForm({ identifier, identifierConflict: false })}
          onSlugChange={(slug) => updateForm({ slug, slugConflict: false, slugEdited: true })}
          onSubmit={handleCreate}
        />
        <Text fontSize={12} type="secondary">
          {t('create.afterCreateHint')}
        </Text>
      </Flexbox>
      <ModalFooter>
        <Button onClick={close}>{t('cancel', { ns: 'common' })}</Button>
        <Button
          disabled={!createInput || identifierTaken || slugTaken || form.avatarUploading}
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
