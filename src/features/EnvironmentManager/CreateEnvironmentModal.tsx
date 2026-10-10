'use client';

import type { EnvironmentKind, EnvironmentVisibility } from '@lobechat/types';
import { Flexbox, Icon } from '@lobehub/ui';
import {
  Button,
  confirmModal,
  createModal,
  Input,
  ModalFooter,
  Text,
  useModalContext,
} from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import { t as translate } from 'i18next';
import { CodeXmlIcon, FolderIcon, type LucideIcon } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import VisibilityConfirmContent from '@/features/VisibilityConfirmContent';
import { useIMECompositionEvent } from '@/hooks/useIMECompositionEvent';

import GithubRepositoryPicker, { type GithubRepositorySelection } from './GithubRepositoryPicker';
import { type CreatedEnvironment, useEnvironmentActions } from './useEnvironmentData';

const styles = createStaticStyles(({ css }) => ({
  kind: css`
    cursor: pointer;

    flex: 1;

    min-width: 0;
    padding: 12px;
    border: 1px solid ${cssVar.colorBorder};
    border-radius: ${cssVar.borderRadiusLG};

    background: ${cssVar.colorFillQuaternary};

    transition:
      border-color 0.2s,
      background 0.2s;

    &:hover {
      border-color: ${cssVar.colorTextQuaternary};
    }
  `,
  kindActive: css`
    border-color: ${cssVar.colorPrimary};
    background: ${cssVar.colorPrimaryBg};

    &:hover {
      border-color: ${cssVar.colorPrimary};
    }
  `,
}));

const KINDS: { icon: LucideIcon; kind: EnvironmentKind }[] = [
  { icon: FolderIcon, kind: 'files' },
  { icon: CodeXmlIcon, kind: 'code' },
];

/**
 * Naming a new environment, after saying what it is for.
 *
 * A dialog rather than a field parked in the page: creating is one action among
 * several this page offers, and an input sitting in the body reads as a setting
 * you are meant to fill in.
 *
 * The kind comes first because it decides what else is worth asking. A folder
 * of files someone hands an agent has no repository and nothing to install, so
 * offering a repository picker to it would ask a question that has no answer.
 * Everything else about an environment is edited once it exists, where the
 * form can explain what each part does.
 */
interface CreateEnvironmentContentProps {
  /**
   * Called with the new environment once it exists, together with the default
   * instance the server created alongside it. Nothing is asked about that
   * instance: the caller opens the environment and starts its build, so the
   * person lands on something that is already on its way to being usable.
   */
  onCreated?: (environment: CreatedEnvironment) => void;
  visibility?: EnvironmentVisibility;
}

const CreateEnvironmentContent = memo<CreateEnvironmentContentProps>(
  ({ onCreated, visibility }) => {
    const { t } = useTranslation('setting');
    const { close } = useModalContext();
    const actions = useEnvironmentActions();

    // Nothing is preselected: the two kinds lead to different fields, and a
    // default would skip the one question this dialog exists to ask first.
    const [kind, setKind] = useState<EnvironmentKind>();
    const [name, setName] = useState('');
    // Tracks whether the name is still the one the repository suggested. A name
    // the person typed is theirs, and picking a different repository must not
    // overwrite it; a suggested one is just a default and follows the pick.
    const [nameIsSuggested, setNameIsSuggested] = useState(true);
    const [repository, setRepository] = useState<GithubRepositorySelection | undefined>();
    const [creating, setCreating] = useState(false);
    // The Enter that confirms an IME candidate reaches `keydown` as an Enter,
    // so a Chinese name would submit the dialog on the keystroke that picked it.
    const { compositionProps, isComposingRef } = useIMECompositionEvent();
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

    const create = async () => {
      setCreating(true);
      setError(undefined);
      try {
        const created = await actions.createEnvironment({
          // The repository is the environment's one source. Every repository
          // carries the owner GitHub reported for it, so the checkout URL is
          // built from the pair rather than from whichever owner the list was
          // filtered by — those differ for a repository reached as a collaborator.
          configuration:
            kind === 'code' && repository
              ? {
                  kind,
                  sources: [
                    {
                      kind: 'git',
                      ref: repository.defaultBranch,
                      url: `https://github.com/${repository.owner}/${repository.repository}`,
                    },
                  ],
                }
              : { kind },
          name: trimmed,
          // Created into the pool the person is looking at. Opening the dialog
          // from the Private tab and having the result land in the workspace's
          // shared list would be a publication nobody asked for.
          visibility,
        });
        close();
        // After the dialog, not instead of it: the person sees the environment
        // land with its default copy already in it.
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
    // publishing it silently because of which tab happened to be open.
    const submit = () => {
      if (!kind || !trimmed || creating) return;
      if (visibility !== 'public') return void create();

      confirmModal({
        content: <VisibilityConfirmContent capturedState variant={'publish'} />,
        okText: t('environments.create'),
        onOk: create,
        title: t('environments.visibility.createPublishedConfirmTitle'),
      });
    };

    return (
      <>
        <Flexbox gap={12} paddingBlock={8} paddingInline={16}>
          <Flexbox gap={6}>
            <Text fontSize={12} type={'secondary'} weight={500}>
              {t('environments.kind.label')}
            </Text>
            <Flexbox horizontal gap={8} role={'radiogroup'}>
              {KINDS.map((option) => (
                <Flexbox
                  aria-checked={kind === option.kind}
                  className={cx(styles.kind, kind === option.kind && styles.kindActive)}
                  gap={4}
                  key={option.kind}
                  role={'radio'}
                  tabIndex={0}
                  onClick={() => setKind(option.kind)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      setKind(option.kind);
                    }
                  }}
                >
                  <Flexbox horizontal align={'center'} gap={6}>
                    <Icon icon={option.icon} size={16} />
                    <Text weight={500}>{t(`environments.kind.${option.kind}`)}</Text>
                  </Flexbox>
                  <Text fontSize={12} type={'secondary'}>
                    {t(`environments.kind.${option.kind}Desc`)}
                  </Text>
                </Flexbox>
              ))}
            </Flexbox>
          </Flexbox>

          {/* What a files environment is for, said where the repository picker
              would otherwise be: there is nothing to configure, and the reason
              to make one is to hand an agent files to work on. */}
          {kind === 'files' && (
            <Text fontSize={12} type={'secondary'}>
              {t('environments.kind.filesHint')}
            </Text>
          )}

          {/* Repository first, name second. The name is the harder question and the
            repository usually answers it, so asking for the name first makes the
            person invent something they are about to be handed. */}
          {kind === 'code' && (
            <GithubRepositoryPicker value={repository} onChange={pickRepository} onLeave={close} />
          )}

          {kind && (
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
          )}
        </Flexbox>
        <ModalFooter>
          <Button onClick={close}>{t('environments.cancel')}</Button>
          <Button
            disabled={!kind || !trimmed}
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
) =>
  createModal({
    content: <CreateEnvironmentContent visibility={visibility} onCreated={onCreated} />,
    footer: null,
    maskClosable: true,
    styles: { content: { padding: 0 } },
    title: translate('environments.create', { ns: 'setting' }),
    width: 'min(90vw, 480px)',
  });
