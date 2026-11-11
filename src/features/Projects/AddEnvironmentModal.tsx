'use client';

import {
  Button,
  createModal,
  cssVar as lobeCssVar,
  Flexbox,
  Input,
  ModalFooter,
  Segmented,
  Text,
  toast,
  useModalContext,
} from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { t as translate } from 'i18next';
import { CheckIcon } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncError from '@/components/AsyncError';
import RepositoryAvatar from '@/components/RepositoryAvatar';
import { repositorySlug } from '@/features/ChatInput/ControlBar/sandboxEnvironmentOptions';
import { GITHUB_RETURN_TO } from '@/features/Integrations/Github/installHref';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useProjectDirectoryStore, useProjectEnvironments } from '@/store/projectWorkingDirectory';

import { parseGithubRepository } from './CreateFromGithub/githubRepository';
import RepositoryList from './CreateFromGithub/RepositoryList';
import { environmentRepositoryUrl, reusableEnvironments } from './environmentSource';

const styles = stylex.create({
  list: {
    overflowY: 'auto',
    maxHeight: '300px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: cssVar.borderRadius,
  },
  row: {
    cursor: 'pointer',
    display: 'flex',
    gap: '12px',
    alignItems: 'center',
    width: '100%',
    paddingBlock: '8px',
    paddingInline: '12px',
    borderBlockStartWidth: 0,
    borderBlockEndWidth: '1px',
    borderBlockEndStyle: { 'default': 'solid', ':last-child': 'none' },
    borderBlockEndColor: cssVar.colorBorderSecondary,
    borderInlineWidth: 0,
    font: 'inherit',
    color: 'inherit',
    textAlign: 'start',
    backgroundColor: { 'default': 'transparent', ':hover': cssVar.colorFillTertiary },
  },
  selected: {
    backgroundColor: { 'default': cssVar.colorFillSecondary, ':hover': cssVar.colorFillSecondary },
  },
  check: {
    flex: 'none',
    color: cssVar.colorPrimary,
  },
});

type Source = 'existing' | 'github';

interface AddEnvironmentContentProps {
  /** Called with the environment now linked to the project. */
  onAdded?: (environmentId: string) => void;
  projectId: string;
  /**
   * The project's conversations run a workspace-public agent, which applies
   * published environments only: a new repository is published, and only
   * published environments are offered for reuse.
   */
  publish?: boolean;
}

/**
 * The one way to give a project an environment: a GitHub repository — one the
 * connected GitHub App can read, or a pasted URL — or an environment the person
 * already has, linked as it is.
 */
const AddEnvironmentContent = ({ onAdded, projectId, publish }: AddEnvironmentContentProps) => {
  const { t } = useTranslation(['project', 'common']);
  const { close } = useModalContext();
  const navigate = useWorkspaceAwareNavigate();
  const attachRepository = useProjectDirectoryStore((s) => s.attachRepository);
  const attachEnvironment = useProjectDirectoryStore((s) => s.attachEnvironment);
  const available = useProjectDirectoryStore((s) => s.useFetchEnvironments)();
  useProjectDirectoryStore((s) => s.useFetchEnvironments)(projectId);
  const linked = useProjectEnvironments(projectId);
  const owned = useProjectEnvironments();
  const reusable = reusableEnvironments(owned, linked, publish);

  const [source, setSource] = useState<Source>('github');
  const [url, setUrl] = useState('');
  const [defaultBranch, setDefaultBranch] = useState<string>();
  const [existingId, setExistingId] = useState<string>();
  const [adding, setAdding] = useState(false);

  const repository = parseGithubRepository(url);
  const urlInvalid = Boolean(url.trim()) && !repository;
  const existing = reusable.find((environment) => environment.id === existingId);
  const ready = source === 'github' ? !!repository : !!existing;

  const add = async () => {
    if (!ready || adding) return;
    setAdding(true);
    try {
      let environmentId: string;
      if (source === 'github') {
        const environment = await attachRepository({
          projectId,
          repository: { defaultBranch, name: repository!.fullName, url: repository!.url },
          ...(publish && { visibility: 'public' as const }),
        });
        environmentId = environment.id;
      } else {
        await attachEnvironment(projectId, existing!.id);
        environmentId = existing!.id;
      }
      close();
      onAdded?.(environmentId);
    } catch (error) {
      console.error('Failed to add an environment to the project', error);
      toast.error(t('environment.add.failed'));
    } finally {
      setAdding(false);
    }
  };

  return (
    <>
      <Flexbox gap={16} padding={16}>
        <Segmented
          block
          value={source}
          options={[
            { label: t('environment.add.github'), value: 'github' },
            { label: t('environment.add.existing'), value: 'existing' },
          ]}
          onChange={(value) => setSource(value as Source)}
        />
        {source === 'github' ? (
          <>
            <RepositoryList
              selected={repository?.fullName}
              onConnect={() => {
                close();
                navigate(GITHUB_RETURN_TO);
              }}
              onSelect={(picked) => {
                setUrl(picked.htmlUrl);
                setDefaultBranch(picked.defaultBranch);
              }}
            />
            <Flexbox gap={6}>
              <Text fontSize={13} weight={500}>
                {t('createFromGithub.urlLabel')}
              </Text>
              <Input
                aria-invalid={urlInvalid}
                placeholder={t('createFromGithub.urlPlaceholder')}
                style={urlInvalid ? { borderColor: lobeCssVar.colorError } : undefined}
                value={url}
                onPressEnter={add}
                onChange={(event) => {
                  setUrl(event.target.value);
                  // A typed URL names no branch; the repository's default applies.
                  setDefaultBranch(undefined);
                }}
              />
              {urlInvalid && (
                <Text fontSize={12} type={'danger'}>
                  {t('createFromGithub.urlInvalid')}
                </Text>
              )}
            </Flexbox>
            {publish && (
              <Text fontSize={12} type={'secondary'}>
                {t('overview.context.repository.publishHint')}
              </Text>
            )}
          </>
        ) : available.error && !available.hasData ? (
          <AsyncError error={available.error} onRetry={() => available.revalidate()} />
        ) : !available.hasData ? (
          <Text type={'secondary'}>{t('loading', { ns: 'common' })}</Text>
        ) : reusable.length === 0 ? (
          <Flexbox align={'center'} gap={12} paddingBlock={24}>
            <Text type={'secondary'}>
              {t(publish ? 'environment.add.noPublished' : 'environment.add.noExisting')}
            </Text>
            <Button onClick={() => setSource('github')}>{t('environment.add.github')}</Button>
          </Flexbox>
        ) : (
          <div {...stylex.props(styles.list)} role={'listbox'}>
            {reusable.map((environment) => {
              const selected = environment.id === existingId;
              return (
                <button
                  aria-selected={selected}
                  key={environment.id}
                  role={'option'}
                  type={'button'}
                  {...stylex.props(styles.row, selected && styles.selected)}
                  onClick={() => setExistingId(environment.id)}
                >
                  <RepositoryAvatar size={28} url={environmentRepositoryUrl(environment)} />
                  <Flexbox flex={1} gap={2} style={{ minWidth: 0 }}>
                    <Text ellipsis weight={500}>
                      {environment.name}
                    </Text>
                    {/* A name that already is the slug needs no second copy of it. */}
                    {repositorySlug(environment) !== environment.name && (
                      <Text ellipsis fontSize={12} type={'secondary'}>
                        {repositorySlug(environment) ?? t('settings.noRepository')}
                      </Text>
                    )}
                  </Flexbox>
                  {selected && (
                    <span {...stylex.props(styles.check)}>
                      <CheckIcon size={16} />
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </Flexbox>
      <ModalFooter>
        <Button onClick={close}>{t('cancel', { ns: 'common' })}</Button>
        <Button disabled={!ready} loading={adding} type={'primary'} onClick={add}>
          {t('environment.add.action')}
        </Button>
      </ModalFooter>
    </>
  );
};

export const openAddEnvironmentModal = (props: AddEnvironmentContentProps) =>
  createModal({
    content: <AddEnvironmentContent {...props} />,
    footer: null,
    styles: { content: { padding: 0 } },
    title: translate('environment.add.title', { ns: 'project' }),
    width: 560,
  });
