'use client';

import type { EnvironmentVisibility } from '@lobechat/types';
import { layoutRepositorySources } from '@lobechat/types';
import {
  Button,
  confirmModal,
  createModal,
  Flexbox,
  Input,
  ModalFooter,
  Text,
  useModalContext,
} from '@lobehub/ui';
import { t as translate } from 'i18next';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { buildConnectorPagePath } from '@/features/Integrations/connectorPage';
import { parseGithubRepository } from '@/features/Projects/CreateFromGithub/githubRepository';
import RepositoryField, {
  AdvancedRepositories,
  type PickedRepository,
} from '@/features/Projects/CreateFromGithub/RepositoryField';
import VisibilityConfirmContent from '@/features/VisibilityConfirmContent';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useIMECompositionEvent } from '@/hooks/useIMECompositionEvent';

import { type CreatedEnvironment, useEnvironmentActions } from './useEnvironmentData';

/**
 * Naming a new code environment, after picking the repository it checks out.
 *
 * A dialog rather than a field parked in the page: creating is one action among
 * several this page offers, and an input sitting in the body reads as a setting
 * you are meant to fill in. Everything else about an environment is edited once
 * it exists, where the form can explain what each part does.
 *
 * There is one kind. A folder of files someone hands an agent is a folder on
 * the drive, picked in the directory picker — not an environment.
 */
interface CreateEnvironmentContentProps {
  /** Called with the new environment once it exists; the caller opens it. */
  onCreated?: (environment: CreatedEnvironment) => void;
  visibility?: EnvironmentVisibility;
}

const CreateEnvironmentContent = memo<CreateEnvironmentContentProps>(
  ({ onCreated, visibility }) => {
    const { t } = useTranslation('setting');
    const { close } = useModalContext();
    const actions = useEnvironmentActions();

    const [name, setName] = useState('');
    // Tracks whether the name is still the one the repository suggested. A name
    // the person typed is theirs, and picking a different repository must not
    // overwrite it; a suggested one is just a default and follows the pick.
    const [nameIsSuggested, setNameIsSuggested] = useState(true);
    // Picked from the list or pasted, the same field the create-project dialog
    // uses. None is fine; several are laid out side by side.
    const [repositories, setRepositories] = useState<PickedRepository[]>([]);
    const navigate = useWorkspaceAwareNavigate();
    const connectGithub = () => {
      close();
      navigate(buildConnectorPagePath('github'));
    };
    const [creating, setCreating] = useState(false);
    // The Enter that confirms an IME candidate reaches `keydown` as an Enter,
    // so a Chinese name would submit the dialog on the keystroke that picked it.
    const { compositionProps, isComposingRef } = useIMECompositionEvent();
    const [error, setError] = useState<string | undefined>();

    const trimmed = name.trim();

    const changeRepositories = (next: PickedRepository[]) => {
      setRepositories(next);
      setError(undefined);
      // Naming a thing that does not exist yet is the harder half of this dialog,
      // so the first repository answers it: an environment for a repository is
      // almost always called after it.
      if (nameIsSuggested) setName((next[0] && parseGithubRepository(next[0].url)?.name) ?? '');
    };

    const create = async () => {
      setCreating(true);
      setError(undefined);
      try {
        const created = await actions.createEnvironment({
          // Each picked repository is a source, checked out from the URL GitHub
          // reported for it. No repository at all is a valid environment: setup
          // and variables only, cloning nothing. Several are laid out side by side.
          configuration:
            repositories.length > 0
              ? {
                  kind: 'code',
                  sources: layoutRepositorySources(
                    repositories.map((repository) => ({
                      kind: 'git' as const,
                      url: repository.url,
                      ...(repository.defaultBranch && { ref: repository.defaultBranch }),
                    })),
                  ) as { kind: 'git'; path?: string; ref?: string; url: string }[],
                }
              : { kind: 'code' },
          name: trimmed,
          // Created into the pool the host chose (private on the workspace
          // page). Landing in the workspace's shared pool by default would be
          // a publication nobody asked for.
          visibility,
        });
        close();
        // After the dialog, not instead of it: the person sees the environment
        // land in the list.
        if (created?.id) onCreated?.(created);
      } catch (cause) {
        // The one failure the user can act on is a name already taken, and it is
        // fixed by typing a different one — so it belongs next to the field
        // rather than in a toast that outlives the dialog.
        setError(
          (cause as { message?: string })?.message === 'DUPLICATE_ENVIRONMENT_NAME'
            ? t('environments.duplicateName')
            : t('environments.createFailed'),
        );
      } finally {
        setCreating(false);
      }
    };

    // Created in the workspace's pool, an environment is published from its
    // first instance on — and an instance keeps whatever a session leaves in its
    // home directory, credentials included. So creating one there asks the same
    // question publishing one does, with the same explanation, rather than
    // publishing it silently.
    const submit = () => {
      if (!trimmed || creating) return;
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
        <Flexbox gap={12} paddingBlock={8} paddingInline={16}>
          {/* Repository first, name second. The name is the harder question and the
            repository usually answers it, so asking for the name first makes the
            person invent something they are about to be handed. */}
          <RepositoryField
            emptyHint={t('environments.form.repositoryOptional')}
            value={repositories}
            onChange={changeRepositories}
            onConnect={connectGithub}
          />

          <Flexbox gap={6}>
            <Text fontSize={12} type={'secondary'} weight={500}>
              {t('environments.nameLabel')}
            </Text>
            <Input
              autoFocus
              placeholder={t('environments.namePlaceholder')}
              value={name}
              onChange={(event) => {
                setName(event.target.value);
                setNameIsSuggested(false);
                setError(undefined);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !isComposingRef.current) void submit();
              }}
              {...compositionProps}
            />
            {error && (
              <Text fontSize={12} type={'danger'}>
                {error}
              </Text>
            )}
          </Flexbox>

          <AdvancedRepositories
            layoutHint={t('environments.form.layoutHint')}
            value={repositories}
            onChange={changeRepositories}
            onConnect={connectGithub}
          />
        </Flexbox>
        <ModalFooter>
          <Button onClick={close}>{t('environments.cancel')}</Button>
          <Button
            disabled={!trimmed}
            loading={creating}
            type={'primary'}
            onClick={() => void submit()}
          >
            {t('environments.create')}
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
    width: 'min(90vw, 520px)',
  });
