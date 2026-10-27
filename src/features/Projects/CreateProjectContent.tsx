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
  getCreateProjectInput,
  getProjectFieldSuggestions,
  isProjectIdentifierValid,
  isProjectSlugValid,
} from './createProjectForm';
import MainAgentField from './MainAgentField';
import {
  readRememberedMainAgent,
  resolveDefaultMainAgent,
  writeRememberedMainAgent,
} from './mainAgentStorage';

export interface CreateProjectOptions {
  /**
   * Handle the created project instead of opening it. Callers that create a
   * project as a step of another action (filing a delivery under a new one)
   * must not have the user navigated away from what they were doing.
   */
  onCreated?: (project: ProjectListItem) => void;
}

interface CreateProjectFormState {
  identifier: string;
  loading: boolean;
  /** Explicit pick in this modal; otherwise the remembered agent or LobeAI. */
  mainAgentId?: string;
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
  const [form, setForm] = useState<CreateProjectFormState>({
    identifier: '',
    loading: false,
    name: '',
    slug: '',
    slugEdited: false,
  });
  const inboxAgentId = useAgentStore(builtinAgentSelectors.inboxAgentId);
  const [remembered] = useState(() => readRememberedMainAgent(getActiveWorkspaceId()));
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
    if (!createInput || form.loading) return;
    updateForm({ loading: true });
    try {
      const project = await createProject({ ...createInput, coordinatorAgentId: mainAgentId });
      if (mainAgentId) writeRememberedMainAgent(mainAgentId, getActiveWorkspaceId());
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
        <Flexbox gap={6}>
          <Text fontSize={13} weight={500}>
            {t('create.mainAgentLabel')}
          </Text>
          <MainAgentField
            agentId={mainAgentId}
            disabled={form.loading}
            onChange={(id) => updateForm({ mainAgentId: id })}
          />
          <Text fontSize={12} type="secondary">
            {t('create.mainAgentDescription')}
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

export default CreateProjectContent;
