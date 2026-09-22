'use client';

import type { EnvironmentVisibility } from '@lobechat/types';
import { Flexbox } from '@lobehub/ui';
import {
  Button,
  createModal,
  Input,
  ModalFooter,
  Text,
  useModalContext,
} from '@lobehub/ui/base-ui';
import { t as translate } from 'i18next';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import GithubRepositoryPicker, { type GithubRepositorySelection } from './GithubRepositoryPicker';
import { useEnvironmentActions } from './useEnvironmentData';

/**
 * Naming a new environment.
 *
 * A dialog rather than a field parked in the page: creating is one action among
 * several this page offers, and an input sitting in the body reads as a setting
 * you are meant to fill in. The name is the only thing asked for — everything
 * else about an environment is edited once it exists, where the form can
 * explain what each part does.
 */
interface CreateEnvironmentContentProps {
  visibility?: EnvironmentVisibility;
}

const CreateEnvironmentContent = memo<CreateEnvironmentContentProps>(({ visibility }) => {
  const { t } = useTranslation('setting');
  const { close } = useModalContext();
  const actions = useEnvironmentActions();

  const [name, setName] = useState('');
  // Tracks whether the name is still the one the repository suggested. A name
  // the person typed is theirs, and picking a different repository must not
  // overwrite it; a suggested one is just a default and follows the pick.
  const [nameIsSuggested, setNameIsSuggested] = useState(true);
  const [repository, setRepository] = useState<GithubRepositorySelection | undefined>();
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const trimmed = name.trim();

  const pickRepository = (selection: GithubRepositorySelection | undefined) => {
    setRepository(selection);
    setError(undefined);
    // Naming a thing that does not exist yet is the harder half of this dialog,
    // so the repository answers it: an environment for a repository is almost
    // always called after it.
    if (nameIsSuggested) setName(selection?.repository ?? '');
  };

  const submit = async () => {
    if (!trimmed || creating) return;

    setCreating(true);
    setError(undefined);
    try {
      await actions.createEnvironment({
        // The repository is the environment's one source. Every repository
        // carries the owner GitHub reported for it, so the checkout URL is
        // built from the pair rather than from whichever owner the list was
        // filtered by — those differ for a repository reached as a collaborator.
        configuration: repository
          ? {
              sources: [
                {
                  kind: 'git',
                  ref: repository.defaultBranch,
                  url: `https://github.com/${repository.owner}/${repository.repository}`,
                },
              ],
            }
          : undefined,
        name: trimmed,
        // Created into the pool the person is looking at. Opening the dialog
        // from the Private tab and having the result land in the workspace's
        // shared list would be a publication nobody asked for.
        visibility,
      });
      close();
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

  return (
    <>
      {/* Repository first, name second. The name is the harder question and the
          repository usually answers it, so asking for the name first makes the
          person invent something they are about to be handed. */}
      <Flexbox gap={12} paddingBlock={8} paddingInline={16}>
        <GithubRepositoryPicker value={repository} onChange={pickRepository} onLeave={close} />

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
              if (event.key === 'Enter') void submit();
            }}
          />
          {error && (
            <Text fontSize={12} type={'danger'}>
              {error}
            </Text>
          )}
        </Flexbox>
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
});

CreateEnvironmentContent.displayName = 'CreateEnvironmentContent';

export const openCreateEnvironmentModal = (visibility?: EnvironmentVisibility) =>
  createModal({
    content: <CreateEnvironmentContent visibility={visibility} />,
    footer: null,
    maskClosable: true,
    styles: { content: { padding: 0 } },
    title: translate('environments.create', { ns: 'setting' }),
    width: 'min(90vw, 480px)',
  });
