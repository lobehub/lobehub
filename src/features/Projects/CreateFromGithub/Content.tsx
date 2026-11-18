import type { ScmRepositoryListItem } from '@lobechat/types';
import { Github } from '@lobehub/icons';
import {
  ActionIcon,
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
import { ChevronDownIcon, ChevronRightIcon, XIcon } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { GITHUB_RETURN_TO } from '@/features/Integrations/Github/installHref';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useHomeStore } from '@/store/home';
import { useProjectStore } from '@/store/project';

import {
  buildCreateProjectRequest,
  getCreateProjectInput,
  getProjectConflictField,
  getProjectFieldSuggestions,
  isProjectIdentifierValid,
  reserveProjectIds,
} from '../createProjectForm';
import MainAgentSection from '../MainAgentSection';
import { parseGithubRepository } from './githubRepository';
import RepositoryList from './RepositoryList';

/** A repository the advanced options add beside the main one. */
interface ExtraRepository {
  defaultBranch?: string;
  /** `owner/name`. */
  fullName: string;
  url: string;
}

interface FormState {
  /** Default branch of the picked repository; unknown for a pasted URL. */
  defaultBranch?: string;
  /** The field another project already holds, as the last create reported it. */
  duplicate?: 'identifier' | 'name';
  identifier: string;
  loading: boolean;
  name: string;
  nameEdited: boolean;
  url: string;
}

const MAX_EXTRA_REPOSITORIES = 9;

/**
 * New project from a GitHub repository: pick one the connected GitHub App can
 * read, or paste a URL, and the project is named after it, led by an agent of
 * its own, and created with the repository attached as its environment —
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

  // Advanced options: more repositories the project's environment checks out
  // beside the main one, side by side in folders named after them.
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [extras, setExtras] = useState<ExtraRepository[]>([]);
  const [extraUrl, setExtraUrl] = useState('');

  // Taken once per open dialog: the dedicated agent's previewed character is seeded by it.
  const [reservedIds] = useState(reserveProjectIds);

  const repository = parseGithubRepository(form.url);
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

  const extraParsed = parseGithubRepository(extraUrl);
  const extraUrlInvalid = Boolean(extraUrl.trim()) && !extraParsed;
  const isTaken = (fullName: string) =>
    fullName.toLowerCase() === repository?.fullName.toLowerCase() ||
    extras.some((item) => item.fullName.toLowerCase() === fullName.toLowerCase());

  /** Adds a repository beside the main one; picking one already there removes it. */
  const toggleExtra = (extra: ExtraRepository) => {
    setExtras((current) => {
      const key = extra.fullName.toLowerCase();
      if (current.some((item) => item.fullName.toLowerCase() === key))
        return current.filter((item) => item.fullName.toLowerCase() !== key);
      if (key === repository?.fullName.toLowerCase()) return current;
      if (current.length >= MAX_EXTRA_REPOSITORIES) return current;
      return [...current, extra];
    });
  };

  const addExtraUrl = () => {
    if (!extraParsed || isTaken(extraParsed.fullName)) return;
    toggleExtra({ fullName: extraParsed.fullName, url: extraParsed.url });
    setExtraUrl('');
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
        ...buildCreateProjectRequest(createInput, { ids: reservedIds }),
        repository: {
          defaultBranch: form.defaultBranch,
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
      // The project created an agent and maybe the Project label; show both.
      const { refreshAgentLabels, refreshAgentList } = useHomeStore.getState();
      void Promise.all([refreshAgentList(), refreshAgentLabels()]);
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
        <RepositoryList
          selected={repository?.fullName}
          onConnect={connectGithub}
          onSelect={selectRepository}
        />

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
            <Text fontSize={12} type={'danger'}>
              {t('createFromGithub.urlInvalid')}
            </Text>
          )}
        </Flexbox>

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
          <MainAgentSection dedicatedAgentId={reservedIds.agentId} projectName={form.name} />
        )}
        {repository && (
          <Flexbox gap={8}>
            <Flexbox horizontal>
              <Button
                icon={<Icon icon={advancedOpen ? ChevronDownIcon : ChevronRightIcon} />}
                size={'small'}
                type={'text'}
                onClick={() => setAdvancedOpen((open) => !open)}
              >
                {extras.length > 0
                  ? t('createFromGithub.advancedWithCount', { count: extras.length })
                  : t('createFromGithub.advanced')}
              </Button>
            </Flexbox>
            {advancedOpen && (
              <Flexbox gap={12}>
                <Text fontSize={12} type={'secondary'}>
                  {t('createFromGithub.extraRepositoriesHint')}
                </Text>
                {extras.length > 0 && (
                  <Flexbox gap={6}>
                    {extras.map((extra) => (
                      <Flexbox
                        horizontal
                        align={'center'}
                        gap={8}
                        key={extra.fullName}
                        style={{
                          border: `1px solid ${cssVar.colorBorderSecondary}`,
                          borderRadius: cssVar.borderRadius,
                          paddingBlock: 6,
                          paddingInline: 12,
                        }}
                      >
                        <Github size={14} />
                        <Text ellipsis style={{ flex: 1 }} weight={500}>
                          {extra.fullName}
                        </Text>
                        <ActionIcon
                          icon={XIcon}
                          size={'small'}
                          title={t('createFromGithub.removeRepository')}
                          onClick={() => toggleExtra(extra)}
                        />
                      </Flexbox>
                    ))}
                  </Flexbox>
                )}
                <RepositoryList
                  hideGuide
                  label={t('createFromGithub.extraRepositoriesLabel')}
                  picked={extras.map((item) => item.fullName)}
                  onConnect={connectGithub}
                  onSelect={(repo) =>
                    toggleExtra({
                      defaultBranch: repo.defaultBranch ?? undefined,
                      fullName: repo.fullName,
                      url: repo.htmlUrl,
                    })
                  }
                />
                <Flexbox gap={6}>
                  <Text fontSize={13} weight={500}>
                    {t('createFromGithub.extraUrlLabel')}
                  </Text>
                  <Flexbox horizontal gap={8}>
                    <Input
                      aria-invalid={extraUrlInvalid}
                      placeholder={t('createFromGithub.urlPlaceholder')}
                      style={extraUrlInvalid ? { borderColor: cssVar.colorError } : undefined}
                      value={extraUrl}
                      onChange={(event) => setExtraUrl(event.target.value)}
                      onPressEnter={addExtraUrl}
                    />
                    <Button
                      disabled={
                        !extraParsed ||
                        isTaken(extraParsed.fullName) ||
                        extras.length >= MAX_EXTRA_REPOSITORIES
                      }
                      onClick={addExtraUrl}
                    >
                      {t('createFromGithub.addRepository')}
                    </Button>
                  </Flexbox>
                  {extraUrlInvalid && (
                    <Text fontSize={12} type={'danger'}>
                      {t('createFromGithub.urlInvalid')}
                    </Text>
                  )}
                </Flexbox>
              </Flexbox>
            )}
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
