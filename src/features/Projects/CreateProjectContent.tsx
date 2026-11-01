import {
  Button,
  cssVar,
  Flexbox,
  Input,
  ModalFooter,
  Text,
  toast,
  useModalContext,
} from '@lobehub/ui';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { getActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useAgentStore } from '@/store/agent';
import { builtinAgentSelectors } from '@/store/agent/selectors';
import { useHomeStore } from '@/store/home';
import { homeAgentListSelectors } from '@/store/home/selectors';
import { type ProjectListItem, useProjectStore } from '@/store/project';

import {
  buildCreateProjectRequest,
  getCreateProjectInput,
  getProjectFieldSuggestions,
  isProjectIdentifierValid,
  isProjectSlugValid,
} from './createProjectForm';
import MainAgentSection from './MainAgentSection';
import {
  DEDICATED_MAIN_AGENT,
  type MainAgentMode,
  readRememberedMainAgent,
  resolveDefaultMainAgent,
  resolveDefaultMainAgentMode,
  writeRememberedMainAgent,
} from './mainAgentStorage';
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
  loading: boolean;
  /** Explicit pick in this modal; otherwise the remembered agent or LobeAI. */
  mainAgentId?: string;
  mainAgentMode: MainAgentMode;
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
  const [remembered] = useState(() => readRememberedMainAgent(getActiveWorkspaceId()));
  const [form, setForm] = useState<CreateProjectFormState>(() => ({
    avatarUploading: false,
    identifier: '',
    loading: false,
    mainAgentMode: resolveDefaultMainAgentMode(remembered),
    name: '',
    slug: '',
    slugEdited: false,
  }));
  const inboxAgentId = useAgentStore(builtinAgentSelectors.inboxAgentId);
  const defaultMainAgentId = useHomeStore((s) =>
    resolveDefaultMainAgent({
      // New projects are shared, so a private agent is not a valid default.
      agentExists: (id) => homeAgentListSelectors.sharedAgents(s).some((agent) => agent.id === id),
      inboxAgentId,
      listLoaded: homeAgentListSelectors.isAgentListInit(s),
      remembered,
    }),
  );
  const mainAgentId = form.mainAgentId ?? defaultMainAgentId;
  const createInput = getCreateProjectInput(form);
  const identifierInvalid =
    Boolean(form.identifier.trim()) && !isProjectIdentifierValid(form.identifier);
  const slugValid = isProjectSlugValid(form.slug);

  const updateForm = (patch: Partial<CreateProjectFormState>) => {
    setForm((current) => ({ ...current, ...patch }));
  };

  const updateName = (name: string) => {
    const suggestions = getProjectFieldSuggestions(name);
    setForm((current) => ({
      ...current,
      name,
      slug: current.slugEdited ? current.slug : suggestions.slug,
    }));
  };

  const handleCreate = async () => {
    if (!createInput || form.loading || form.avatarUploading) return;
    updateForm({ loading: true });
    try {
      const project = await createProject(
        buildCreateProjectRequest(createInput, {
          avatar: form.avatar,
          mainAgentId,
          mainAgentMode: form.mainAgentMode,
        }),
      );
      const rememberedChoice =
        form.mainAgentMode === 'dedicated' ? DEDICATED_MAIN_AGENT : mainAgentId;
      if (rememberedChoice) writeRememberedMainAgent(rememberedChoice, getActiveWorkspaceId());
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
        <Flexbox gap={6}>
          <Text fontSize={13} weight={500}>
            {t('create.identifierLabel')}
          </Text>
          <Input
            aria-invalid={identifierInvalid}
            maxLength={6}
            placeholder={t('create.identifierPlaceholder')}
            style={identifierInvalid ? { borderColor: cssVar.colorError } : undefined}
            value={form.identifier}
            onChange={(event) => updateForm({ identifier: event.target.value.toUpperCase() })}
            onPressEnter={handleCreate}
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
            aria-invalid={!slugValid}
            maxLength={100}
            placeholder={t('create.slugPlaceholder')}
            style={slugValid ? undefined : { borderColor: cssVar.colorError }}
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
        <MainAgentSection
          agentId={mainAgentId}
          disabled={form.loading}
          mode={form.mainAgentMode}
          projectAvatar={form.avatar}
          projectName={form.name}
          onAgentChange={(id) => updateForm({ mainAgentId: id })}
          onModeChange={(mainAgentMode) => updateForm({ mainAgentMode })}
        />
      </Flexbox>
      <ModalFooter>
        <Button onClick={close}>{t('cancel', { ns: 'common' })}</Button>
        <Button
          disabled={!createInput || form.avatarUploading}
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
