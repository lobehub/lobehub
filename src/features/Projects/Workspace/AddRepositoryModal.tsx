'use client';

import {
  Button,
  createModal,
  cssVar,
  Flexbox,
  Input,
  ModalFooter,
  Text,
  toast,
  useModalContext,
} from '@lobehub/ui';
import { t as translate } from 'i18next';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { GITHUB_RETURN_TO } from '@/features/Integrations/Github/installHref';
import { parseGithubRepository } from '@/features/Projects/CreateFromGithub/githubRepository';
import RepositoryList from '@/features/Projects/CreateFromGithub/RepositoryList';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useProjectDirectoryStore } from '@/store/projectWorkingDirectory';

interface AddRepositoryContentProps {
  onAdded: (environmentId: string) => void;
  projectId: string;
}

/**
 * A repository for the project: one the connected GitHub App can read, or a
 * pasted URL — the same two ways a project is created from GitHub, so the
 * dialog works whether or not GitHub is connected. The environment that checks
 * it out is the caller's own, reused when they already have one for it.
 */
const AddRepositoryContent = ({ onAdded, projectId }: AddRepositoryContentProps) => {
  const { t } = useTranslation(['project', 'common']);
  const { close } = useModalContext();
  const navigate = useWorkspaceAwareNavigate();
  const attachRepository = useProjectDirectoryStore((s) => s.attachRepository);
  const [url, setUrl] = useState('');
  const [defaultBranch, setDefaultBranch] = useState<string>();
  const [adding, setAdding] = useState(false);

  const repository = parseGithubRepository(url);
  const urlInvalid = Boolean(url.trim()) && !repository;

  const add = async () => {
    if (!repository || adding) return;
    setAdding(true);
    try {
      const environment = await attachRepository({
        projectId,
        repository: { defaultBranch, name: repository.fullName, url: repository.url },
      });
      close();
      onAdded(environment.id);
    } catch (error) {
      console.error('Failed to add the repository to the project', error);
      toast.error(t('overview.context.repository.attachFailed'));
    } finally {
      setAdding(false);
    }
  };

  return (
    <>
      <Flexbox gap={16} padding={16}>
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
            style={urlInvalid ? { borderColor: cssVar.colorError } : undefined}
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
      </Flexbox>
      <ModalFooter>
        <Button onClick={close}>{t('cancel', { ns: 'common' })}</Button>
        <Button disabled={!repository} loading={adding} type={'primary'} onClick={add}>
          {t('overview.context.repository.addAction')}
        </Button>
      </ModalFooter>
    </>
  );
};

export const openAddRepositoryModal = (props: AddRepositoryContentProps) =>
  createModal({
    content: <AddRepositoryContent {...props} />,
    footer: null,
    styles: { content: { padding: 0 } },
    title: translate('overview.context.repository.addTitle', { ns: 'project' }),
    width: 520,
  });
