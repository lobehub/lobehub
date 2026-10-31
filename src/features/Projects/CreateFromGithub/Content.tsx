import type { ScmRepositoryListItem } from '@lobechat/types';
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
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { getActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import { GITHUB_RETURN_TO } from '@/features/Integrations/Github/installHref';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useProjectStore } from '@/store/project';

import {
  getCreateProjectInput,
  getProjectFieldSuggestions,
  isProjectIdentifierValid,
} from '../createProjectForm';
import MainAgentField from '../MainAgentField';
import { writeRememberedMainAgent } from '../mainAgentStorage';
import { useDefaultMainAgent } from '../useDefaultMainAgent';
import { parseGithubRepository } from './githubRepository';
import RepositoryList from './RepositoryList';

/** Server codes for a taken slug or identifier; see `rethrowDuplicateProjectField`. */
const DUPLICATE_FIELD = {
  DUPLICATE_PROJECT_IDENTIFIER: 'identifier',
  DUPLICATE_PROJECT_SLUG: 'name',
} as const;

interface FormState {
  /** Default branch of the picked repository; unknown for a pasted URL. */
  defaultBranch?: string;
  /** The field another project already holds, as the last create reported it. */
  duplicate?: 'identifier' | 'name';
  identifier: string;
  loading: boolean;
  /** Explicit pick in this dialog; otherwise the remembered agent or LobeAI. */
  mainAgentId?: string;
  name: string;
  nameEdited: boolean;
  url: string;
}

/**
 * New project from a GitHub repository: pick one the connected GitHub App can
 * read, or paste a URL, and the project is named after it, led by the default
 * main agent, and created with the repository attached as its environment —
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
    name: '',
    nameEdited: false,
    url: '',
  });

  const repository = parseGithubRepository(form.url);
  const urlInvalid = Boolean(form.url.trim()) && !repository;
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

  /** A new repository renames the project unless the person already named it. */
  const applyUrl = (url: string, defaultBranch?: string) => {
    const parsed = parseGithubRepository(url);
    setForm((current) => {
      const name = current.nameEdited ? current.name : (parsed?.name ?? '');
      return { ...current, defaultBranch, duplicate: undefined, name, url };
    });
  };

  const selectRepository = (repo: ScmRepositoryListItem) => {
    applyUrl(repo.htmlUrl, repo.defaultBranch);
  };

  const updateName = (name: string) => {
    setForm((current) => ({ ...current, duplicate: undefined, name, nameEdited: true }));
  };

  const connectGithub = () => {
    close();
    navigate(GITHUB_RETURN_TO);
  };

  const handleCreate = async () => {
    if (!createInput || !repository || form.loading) return;
    setForm((current) => ({ ...current, loading: true }));
    try {
      const project = await createProject({
        ...createInput,
        coordinatorAgentId: mainAgentId,
        repository: {
          defaultBranch: form.defaultBranch,
          name: repository.fullName,
          url: repository.url,
        },
      });
      if (mainAgentId) writeRememberedMainAgent(mainAgentId, getActiveWorkspaceId());
      close();
      navigate(`/project/${project.slug ?? project.id}`);
    } catch (error) {
      const duplicate =
        error instanceof Error
          ? DUPLICATE_FIELD[error.message as keyof typeof DUPLICATE_FIELD]
          : undefined;
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
        <Flexbox gap={6}>
          <Text fontSize={13} weight={500}>
            {t('createFromGithub.urlLabel')}
          </Text>
          <Input
            autoFocus
            aria-invalid={urlInvalid}
            placeholder={t('createFromGithub.urlPlaceholder')}
            style={urlInvalid ? { borderColor: cssVar.colorError } : undefined}
            value={form.url}
            onChange={(event) => applyUrl(event.target.value)}
            onPressEnter={handleCreate}
          />
          {urlInvalid && (
            <Text fontSize={12} type={'danger'}>
              {t('createFromGithub.urlInvalid')}
            </Text>
          )}
        </Flexbox>

        <RepositoryList
          selected={repository?.fullName}
          onConnect={connectGithub}
          onSelect={selectRepository}
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
          <Flexbox gap={6}>
            <Text fontSize={13} weight={500}>
              {t('create.mainAgentLabel')}
            </Text>
            <MainAgentField
              agentId={mainAgentId}
              disabled={form.loading}
              onChange={(id) => setForm((current) => ({ ...current, mainAgentId: id }))}
            />
          </Flexbox>
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
