'use client';

import type { EnvironmentVisibility } from '@lobechat/types';
import {
  Button,
  confirmModal,
  createModal,
  Flexbox,
  ModalFooter,
  Text,
  useModalContext,
} from '@lobehub/ui';
import { t as translate } from 'i18next';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { GITHUB_RETURN_TO } from '@/features/Integrations/Github/installHref';
import RepositorySource, {
  repositoryOf,
  type RepositorySourceValue,
} from '@/features/Projects/CreateFromGithub/RepositorySource';
import VisibilityConfirmContent from '@/features/VisibilityConfirmContent';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';

import { type CreatedEnvironment, useEnvironmentActions } from './useEnvironmentData';

/**
 * Adding a code repository: pick one from GitHub, or paste its URL — the same
 * two controls a project adds a repository with.
 *
 * The repository is the whole decision. It is required, because an entry that
 * checks nothing out has nothing to set up; and it names the entry, because
 * the person would only type the repository's name again. Everything else —
 * branch, setup command, variables — is edited once it exists, where the form
 * can explain what each part does.
 */
interface CreateEnvironmentContentProps {
  /** Called with the repository's entry once it exists; the caller opens it. */
  onCreated?: (environment: CreatedEnvironment) => void;
  visibility?: EnvironmentVisibility;
}

export const CreateEnvironmentContent = memo<CreateEnvironmentContentProps>(
  ({ onCreated, visibility }) => {
    const { t } = useTranslation('setting');
    const { close } = useModalContext();
    const navigate = useWorkspaceAwareNavigate();
    const actions = useEnvironmentActions();

    const [picked, setPicked] = useState<RepositorySourceValue>({ url: '' });
    const [creating, setCreating] = useState(false);
    const [error, setError] = useState<string | undefined>();

    const repository = repositoryOf(picked);

    const create = async () => {
      if (!repository) return;
      setCreating(true);
      setError(undefined);
      try {
        const created = await actions.createFromRepository({
          name: repository.fullName,
          ref: picked.defaultBranch,
          url: repository.url,
          // Created into the pool the person is looking at. Opening the dialog
          // from the Private tab and having the result land in the workspace's
          // shared list would be a publication nobody asked for.
          visibility,
        });
        close();
        // After the dialog, not instead of it: the person sees the entry land
        // in the list — or, for a repository already added, sees that one.
        if (created?.id) onCreated?.(created);
      } catch (cause) {
        console.error('Failed to add the repository', cause);
        setError(t('environments.createFailed'));
      } finally {
        setCreating(false);
      }
    };

    // Created in the workspace's pool, an entry is published from its first
    // instance on — and an instance keeps whatever a session leaves in its home
    // directory, credentials included. So adding one there asks the same
    // question publishing one does, with the same explanation, rather than
    // publishing it silently because of which tab happened to be open.
    const submit = () => {
      if (!repository || creating) return;
      if (visibility !== 'public') return void create();

      confirmModal({
        content: <VisibilityConfirmContent variant={'publish'} />,
        okText: t('environments.create'),
        onOk: create,
        title: t('environments.visibility.createPublishedConfirmTitle'),
      });
    };

    return (
      <>
        <Flexbox gap={16} padding={16}>
          <RepositorySource
            value={picked}
            onSubmit={submit}
            onChange={(value) => {
              setPicked(value);
              setError(undefined);
            }}
            onConnect={() => {
              close();
              navigate(GITHUB_RETURN_TO);
            }}
          />
          {error && (
            <Text fontSize={12} type={'danger'}>
              {error}
            </Text>
          )}
        </Flexbox>
        <ModalFooter>
          <Button onClick={close}>{t('environments.cancel')}</Button>
          <Button
            disabled={!repository}
            loading={creating}
            type={'primary'}
            onClick={() => void submit()}
          >
            {t('environments.add')}
          </Button>
        </ModalFooter>
      </>
    );
  },
);

CreateEnvironmentContent.displayName = 'CreateEnvironmentContent';

export const openCreateEnvironmentModal = (
  visibility?: EnvironmentVisibility,
  onCreated?: (environment: CreatedEnvironment) => void,
  title: string = translate('environments.create', { ns: 'setting' }),
) =>
  createModal({
    content: <CreateEnvironmentContent visibility={visibility} onCreated={onCreated} />,
    footer: null,
    maskClosable: true,
    styles: { content: { padding: 0 } },
    title,
    width: 'min(90vw, 560px)',
  });
