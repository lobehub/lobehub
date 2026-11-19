'use client';

import type { ScmRepositoryListItem, TfsRepository } from '@lobechat/types';
import { parseTfsRepository } from '@lobechat/utils/tfs';
import {
  ActionIcon,
  Button,
  cssVar,
  Flexbox,
  Input,
  ModalFooter,
  Text,
  toast,
  useModalContext,
} from '@lobehub/ui';
import { GitBranchIcon, XIcon } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { GITHUB_RETURN_TO } from '@/features/Integrations/Github/installHref';
import { TfsRepositoryPicker } from '@/features/Tfs/TfsRepositoryPicker';
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
import { parseGithubRepository } from './githubRepository';
import { MAX_REPOSITORIES } from './RepositoryField';
import RepositoryList from './RepositoryList';

interface SelectedTfsRepository {
  defaultBranch?: string;
  fullName: string;
  name: string;
  url: string;
}

interface FormState {
  /** Default branch of the picked repository; unknown for a pasted URL. */
  defaultBranch?: string;
  /** The field another project already holds, as the last create reported it. */
  duplicate?: 'identifier' | 'name';
  identifier: string;
  loading: boolean;
  mainAgentId?: string;
  mainAgentMode: MainAgentMode;
  name: string;
  nameEdited: boolean;
  url: string;
}

/**
 * New project from a GitHub repository: pick one the connected GitHub App can
 * read, or paste a URL, and the project is named after it, led by an agent of
 * its own, and created with the repository attached as its environment —
 * no fields to fill unless the defaults are wrong.
 */
const CreateFromGithubContent = ({ provider = 'github' }: { provider?: 'github' | 'tfs' }) => {
  const parseRepository = provider === 'tfs' ? parseTfsRepository : parseGithubRepository;
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
    url: '',
  });
  const [tfsRepositories, setTfsRepositories] = useState<SelectedTfsRepository[]>([]);

  // Taken once per open dialog: the dedicated agent's previewed character is seeded by it.
  const [reservedIds] = useState(reserveProjectIds);

  const repository = parseRepository(
    provider === 'tfs' ? (tfsRepositories[0]?.url ?? '') : form.url,
  );
  const urlInvalid = Boolean(form.url.trim()) && !repository;
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

  /** A new repository renames the project unless the person already named it. */
  const applyUrl = (url: string, defaultBranch?: string) => {
    const parsed = parseRepository(url);
    setForm((current) => {
      const name = current.nameEdited ? current.name : (parsed?.name ?? '');
      return { ...current, defaultBranch, duplicate: undefined, name, url };
    });
  };

  const selectRepository = (repo: ScmRepositoryListItem) => {
    applyUrl(repo.htmlUrl, repo.defaultBranch);
  };

  const selectTfsRepository = (repo: TfsRepository) => {
    const selected = {
      defaultBranch: repo.defaultBranch,
      fullName: `${repo.project.name}/${repo.name}`,
      name: repo.name,
      url: repo.remoteUrl,
    };
    setTfsRepositories((current) => {
      const index = current.findIndex(
        (item) => item.url.toLowerCase() === repo.remoteUrl.toLowerCase(),
      );
      if (index < 0) return current.length >= MAX_REPOSITORIES ? current : [...current, selected];
      const next = [...current];
      next[index] = selected;
      return next;
    });
    setForm((current) => ({
      ...current,
      duplicate: undefined,
      name: current.nameEdited || tfsRepositories.length > 0 ? current.name : selected.name,
    }));
  };

  const removeTfsRepository = (url: string) => {
    const next = tfsRepositories.filter((item) => item.url !== url);
    setTfsRepositories(next);
    if (!form.nameEdited && next[0]) setForm((current) => ({ ...current, name: next[0].name }));
  };

  const updateName = (name: string) => {
    setForm((current) => ({ ...current, duplicate: undefined, name, nameEdited: true }));
  };

  const connectGithub = () => {
    close();
    navigate(provider === 'tfs' ? '/settings/integrations/tfs' : GITHUB_RETURN_TO);
  };

  const handleCreate = async () => {
    if (!createInput || !repository || form.loading) return;
    setForm((current) => ({ ...current, loading: true }));
    try {
      const project = await createProject({
        ...buildCreateProjectRequest(createInput, {
          ids: reservedIds,
          mainAgentId: form.mainAgentId,
          mainAgentMode: form.mainAgentMode,
        }),
        repository: {
          defaultBranch:
            provider === 'tfs' ? tfsRepositories[0]?.defaultBranch : form.defaultBranch,
          name: repository.fullName,
          url: repository.url,
        },
        ...(provider === 'tfs' && {
          additionalRepositories: tfsRepositories.slice(1).map(({ defaultBranch, url }) => ({
            defaultBranch,
            url,
          })),
        }),
      });
      if (form.mainAgentMode === 'dedicated') {
        const { refreshAgentLabels, refreshAgentList } = useHomeStore.getState();
        void Promise.all([refreshAgentList(), refreshAgentLabels()]);
      }
      close();
      navigate(`/project/${project.slug ?? project.id}`);
    } catch (error) {
      // A taken slug also comes back as a conflict; this dialog has no slug
      // input, so it reports it on the name the slug is derived from.
      const field = getProjectConflictField(error);
      const duplicate = field === 'slug' ? 'name' : field;
      if (duplicate) {
        setForm((current) => ({ ...current, duplicate }));
      } else {
        console.error('Failed to create project from GitHub', error);
        toast.error(t('operationFailed', { ns: 'common' }));
      }
    } finally {
      setForm((current) => ({ ...current, loading: false }));
    }
  };

  return (
    <>
      <Flexbox gap={16} padding={16}>
        {/* Picking a connected repository is the primary path; the URL field is the fallback. */}
        {provider === 'tfs' ? (
          <TfsRepositoryPicker
            onClear={() => undefined}
            onLeave={close}
            onSelect={selectTfsRepository}
          />
        ) : (
          <RepositoryList
            selected={repository?.fullName}
            onConnect={connectGithub}
            onSelect={selectRepository}
          />
        )}

        {provider === 'tfs' && tfsRepositories.length > 0 && (
          <Flexbox gap={8}>
            <Text fontSize={13} weight={500}>
              {t('createFromGithub.repositoryTitle')}
            </Text>
            {tfsRepositories.map((item) => (
              <Flexbox horizontal align="center" gap={8} key={item.url}>
                <GitBranchIcon size={14} />
                <Text ellipsis style={{ flex: 1 }} weight={500}>
                  {item.fullName}
                </Text>
                {item.defaultBranch && (
                  <Text fontSize={12} type="secondary">
                    {item.defaultBranch}
                  </Text>
                )}
                <ActionIcon
                  icon={XIcon}
                  size="small"
                  title={t('createFromGithub.removeRepository')}
                  onClick={() => removeTfsRepository(item.url)}
                />
              </Flexbox>
            ))}
            <Text fontSize={12} type="secondary">
              {t('createFromGithub.layoutHint')}
            </Text>
          </Flexbox>
        )}

        {provider === 'github' && (
          <Flexbox gap={6}>
            <Text fontSize={13} weight={500}>
              {t('createFromGithub.urlLabel')}
            </Text>
            <Input
              aria-invalid={urlInvalid}
              placeholder={t('createFromGithub.urlPlaceholder')}
              style={urlInvalid ? { borderColor: cssVar.colorError } : undefined}
              value={form.url}
              onChange={(event) => applyUrl(event.target.value)}
              onPressEnter={handleCreate}
            />
            {urlInvalid && (
              <Text fontSize={12} type="danger">
                {t('createFromGithub.urlInvalid')}
              </Text>
            )}
          </Flexbox>
        )}

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
        {repository && (
          <Text fontSize={12} type={identifierInvalid || form.duplicate ? 'danger' : 'secondary'}>
            {form.duplicate === 'name'
              ? t('createFromGithub.duplicateName')
              : form.duplicate === 'identifier'
                ? t('createFromGithub.duplicateIdentifier')
                : identifierInvalid
                  ? t('create.identifierInvalid')
                  : t('createFromGithub.environmentHint')}
          </Text>
        )}
        {repository && (
          <MainAgentSection
            agentId={form.mainAgentId}
            dedicatedAgentId={reservedIds.agentId}
            disabled={form.loading}
            mode={form.mainAgentMode}
            projectName={form.name}
            onAgentChange={(id) => setForm((current) => ({ ...current, mainAgentId: id }))}
            onModeChange={(mainAgentMode) =>
              setForm((current) => ({ ...current, mainAgentMode }))
            }
          />
        )}
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
