import { Button, cssVar, Flexbox, Input, ModalFooter, Text, useModalContext } from '@lobehub/ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import InlineErrorText from '@/components/InlineErrorText';
import { type InlineErrorState, toInlineError } from '@/components/InlineErrorText/errorDetail';
import { buildConnectorPagePath } from '@/features/Integrations/connectorPage';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useHomeStore } from '@/store/home';
import { useProjectStore } from '@/store/project';

import {
  buildCreateProjectRequest,
  DEFAULT_MAIN_AGENT_MODE,
  getCreateProjectInput,
  getProjectConflictField,
  getProjectFieldSuggestions,
  isProjectIdentifierValid,
  type MainAgentMode,
  reserveProjectIds,
} from '../createProjectForm';
import MainAgentSection from '../MainAgentSection';
import { useDefaultMainAgent } from '../useDefaultMainAgent';
import { parseGithubRepository } from './githubRepository';
import RepositoryField, { AdvancedRepositories, type PickedRepository } from './RepositoryField';

interface FormState {
  /** The field another project already holds, as the last create reported it. */
  duplicate?: 'identifier' | 'name';
  identifier: string;
  loading: boolean;
  /** Explicit pick in this dialog; otherwise the workspace inbox agent, LobeAI. */
  mainAgentId?: string;
  mainAgentMode: MainAgentMode;
  name: string;
  nameEdited: boolean;
}

/**
 * New project from a GitHub repository: pick one the connected GitHub App can
 * read, or paste a URL, and the project is named after it, led by an existing
 * agent (LobeAI unless another is picked) or by one created for it, and created
 * with the repository attached as its environment —
 * no fields to fill unless the defaults are wrong.
 */
const CreateFromGithubContent = () => {
  const { t } = useTranslation(['project', 'common']);
  const { close } = useModalContext();
  const navigate = useWorkspaceAwareNavigate();
  const createProject = useProjectStore((s) => s.createProject);
  const [form, setForm] = useState<FormState>({
    identifier: '',
    loading: false,
    mainAgentMode: DEFAULT_MAIN_AGENT_MODE,
    name: '',
    nameEdited: false,
  });

  // The project's environment checks these out; the first one names the project.
  const [repositories, setRepositories] = useState<PickedRepository[]>([]);
  const [main, ...extras] = repositories;

  // Taken once per open dialog: the dedicated agent's previewed character is seeded by it.
  const [reservedIds] = useState(reserveProjectIds);

  /** Create failure that no field explains, shown above the footer buttons: the dialog stays open with the user's input. */
  const [error, setError] = useState<InlineErrorState | null>(null);

  const repository = main && parseGithubRepository(main.url);
  const defaultMainAgentId = useDefaultMainAgent();
  const mainAgentId = form.mainAgentId ?? defaultMainAgentId;
  const identifierInvalid =
    (Boolean(form.identifier.trim()) && !isProjectIdentifierValid(form.identifier)) ||
    form.duplicate === 'identifier';
  const createInput = repository
    ? getCreateProjectInput({
        identifier: form.identifier,
        name: form.name,
        slug: getProjectFieldSuggestions(form.name).slug,
      })
    : null;

  /** A new first repository renames the project unless the person already named it. */
  const changeRepositories = (next: PickedRepository[]) => {
    setRepositories(next);
    const first = next[0] && parseGithubRepository(next[0].url);
    setForm((current) => ({
      ...current,
      duplicate: undefined,
      name: current.nameEdited ? current.name : (first?.name ?? ''),
    }));
  };

  const updateName = (name: string) => {
    setForm((current) => ({ ...current, duplicate: undefined, name, nameEdited: true }));
    setError(null);
  };

  const connectGithub = () => {
    close();
    navigate(buildConnectorPagePath('github'));
  };

  const handleCreate = async () => {
    if (!createInput || !repository || form.loading) return;
    setError(null);
    setForm((current) => ({ ...current, loading: true }));
    try {
      const project = await createProject({
        ...buildCreateProjectRequest(createInput, {
          ids: reservedIds,
          mainAgentId,
          mainAgentMode: form.mainAgentMode,
        }),
        repository: {
          defaultBranch: main?.defaultBranch,
          name: repository.fullName,
          url: repository.url,
        },
        ...(extras.length > 0 && {
          additionalRepositories: extras.map(({ defaultBranch, url }) => ({
            url,
            ...(defaultBranch && { defaultBranch }),
          })),
        }),
      });
      if (form.mainAgentMode === 'dedicated') {
        // The project created an agent and maybe the Project label; show both.
        const { refreshAgentLabels, refreshAgentList } = useHomeStore.getState();
        void Promise.all([refreshAgentList(), refreshAgentLabels()]);
      }
      close();
      navigate(`/project/${project.slug ?? project.id}`);
    } catch (err) {
      // A taken slug also comes back as a conflict; this dialog has no slug
      // input, so it reports it on the name the slug is derived from.
      const field = getProjectConflictField(err);
      const duplicate = field === 'slug' ? 'name' : field;
      if (duplicate) {
        setForm((current) => ({ ...current, duplicate }));
      } else {
        console.error('Failed to create project from GitHub', err);
        setError(toInlineError(t('create.failedRetry'), err));
      }
    } finally {
      setForm((current) => ({ ...current, loading: false }));
    }
  };

  return (
    <>
      <Flexbox gap={16} padding={16}>
        <RepositoryField
          value={repositories}
          onChange={changeRepositories}
          onConnect={connectGithub}
        />

        {repository && (
          <Flexbox horizontal gap={12}>
            <Flexbox flex={1} gap={6}>
              <Text fontSize={13} weight={500}>
                {t('create.nameLabel')}
              </Text>
              <Input
                aria-invalid={form.duplicate === 'name'}
                maxLength={255}
                placeholder={t('create.namePlaceholder')}
                style={form.duplicate === 'name' ? { borderColor: cssVar.colorError } : undefined}
                value={form.name}
                onChange={(event) => updateName(event.target.value)}
                onPressEnter={handleCreate}
              />
            </Flexbox>
            <Flexbox gap={6} style={{ width: 160 }}>
              <Text fontSize={13} weight={500}>
                {t('create.identifierLabel')}
              </Text>
              <Input
                aria-invalid={identifierInvalid}
                maxLength={6}
                placeholder={t('create.identifierPlaceholder')}
                style={identifierInvalid ? { borderColor: cssVar.colorError } : undefined}
                value={form.identifier}
                onPressEnter={handleCreate}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    duplicate: undefined,
                    identifier: event.target.value.toUpperCase(),
                  }))
                }
              />
            </Flexbox>
          </Flexbox>
        )}
        {repository && (identifierInvalid || form.duplicate) && (
          <Text fontSize={12} type={'danger'}>
            {form.duplicate === 'name'
              ? t('createFromGithub.duplicateName')
              : form.duplicate === 'identifier'
                ? t('createFromGithub.duplicateIdentifier')
                : t('create.identifierInvalid')}
          </Text>
        )}
        {repository && (
          <MainAgentSection
            agentId={mainAgentId}
            dedicatedAgentId={reservedIds.agentId}
            disabled={form.loading}
            mode={form.mainAgentMode}
            projectName={form.name}
            onAgentChange={(id) => setForm((current) => ({ ...current, mainAgentId: id }))}
            onModeChange={(mainAgentMode) => setForm((current) => ({ ...current, mainAgentMode }))}
          />
        )}
        <AdvancedRepositories
          layoutHint={t('createFromGithub.layoutHint')}
          value={repositories}
          onChange={changeRepositories}
          onConnect={connectGithub}
        />
        {error && <InlineErrorText detail={error.detail}>{error.summary}</InlineErrorText>}
      </Flexbox>
      <ModalFooter>
        <Button onClick={close}>{t('cancel', { ns: 'common' })}</Button>
        <Button
          disabled={!createInput}
          loading={form.loading}
          type={'primary'}
          onClick={handleCreate}
        >
          {t('create.action')}
        </Button>
      </ModalFooter>
    </>
  );
};

export default CreateFromGithubContent;
