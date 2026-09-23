'use client';

import { isSafeSandboxCwd } from '@lobechat/builtin-tool-cloud-sandbox';
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

import { describeError } from './errorMessage';
import { suggestInstanceDirectory } from './instanceDirectory';
import { type SandboxInstance, useEnvironmentActions } from './useEnvironmentData';

interface CreateInstanceContentProps {
  environmentId: string;
  /**
   * The instance being edited, or absent to make a new one.
   *
   * The same dialog for both because they ask the same two questions about
   * the same two fields — and because a rename done inline, in a row, could
   * not show the directory at all, so the one thing that cannot be changed was
   * also the one thing never explained.
   */
  instance?: SandboxInstance;
  onCreated?: (instance: SandboxInstance) => void;
}

/**
 * Naming a new instance and choosing its directory.
 *
 * One dialog for both places an instance is made from — the environment's
 * panel in settings and the working-directory menu in the composer — so the
 * two never drift into asking different questions. It always asks: the
 * directory is where a conversation's outputs land and the name is how it is
 * told apart from its siblings, and neither is something to decide for the
 * person by deriving it from the environment's name.
 */
const CreateInstanceContent = memo<CreateInstanceContentProps>(
  ({ environmentId, instance, onCreated }) => {
    const { t } = useTranslation('setting');
    const { close } = useModalContext();
    const actions = useEnvironmentActions();

    const editing = Boolean(instance);

    const [name, setName] = useState(instance?.name ?? '');
    const [workingDirectory, setWorkingDirectory] = useState(instance?.workingDirectory ?? '');
    // Whether the folder is the person's own now. Until it is, it follows the
    // name — "a folder of its own, named after this instance" is the answer
    // nearly every time, and a field with no right answer showing is one that
    // has to be puzzled out before the dialog can be finished.
    //
    // Derived from the field being non-empty rather than latched on first
    // keystroke. Latched, it is a one-way door: type a folder, change your
    // mind, clear it, and the help never comes back. Clearing it is how you
    // hand it back — and it does not refill on the spot, since a field that
    // repopulates under the cursor cannot be cleared at all. The next edit to
    // the name picks it up again.
    const [directoryOwned, setDirectoryOwned] = useState(false);
    const [creating, setCreating] = useState(false);
    const [error, setError] = useState<string | undefined>();

    // Checked here against the rule the execution plane applies, so a folder it
    // would refuse is refused while the person is still typing rather than on
    // their next message. Editing only ever changes the name, and the directory
    // it came with was already accepted once.
    const canCreate = editing
      ? Boolean(name.trim()) && name.trim() !== instance!.name
      : Boolean(name.trim()) && isSafeSandboxCwd(workingDirectory);

    const submit = async () => {
      if (!canCreate || creating) return;

      setCreating(true);
      setError(undefined);
      try {
        if (instance) {
          await actions.renameInstance({ id: instance.id, name: name.trim() });
          close();

          return;
        }

        const created = await actions.createInstance({
          environmentId,
          name: name.trim(),
          workingDirectory,
        });
        close();
        onCreated?.(created);
        // After the dialog is gone, not before: materializing the instance
        // clones a repository and runs an install, and the row exists either
        // way — holding the dialog open for minutes would make creating one
        // feel like it might fail, when the only thing that can still fail is
        // the build, which the list reports on.
        void actions.buildInstance(created.id);
      } catch (cause) {
        // A directory another instance already uses is fixed by typing a
        // different one, so it belongs next to the field rather than in a toast
        // that outlives the dialog.
        const code = (cause as { message?: string })?.message;
        setError(
          code === 'DUPLICATE_INSTANCE_DIRECTORY'
            ? t('environments.instances.duplicateDirectory')
            : code === 'OVERLAPPING_INSTANCE_DIRECTORY'
              ? t('environments.instances.overlappingDirectory')
              : describeError(
                  cause,
                  t,
                  t(
                    editing
                      ? 'environments.instances.renameFailed'
                      : 'environments.instances.createFailed',
                  ),
                ),
        );
      } finally {
        setCreating(false);
      }
    };

    return (
      <>
        <Flexbox gap={12} paddingBlock={8} paddingInline={16}>
          <Flexbox gap={6}>
            <Text fontSize={12} type={'secondary'} weight={500}>
              {t('environments.nameLabel')}
            </Text>
            <Input
              autoFocus
              placeholder={t('environments.instances.namePlaceholder')}
              value={name}
              onChange={(event) => {
                const next = event.target.value;
                setName(next);
                if (!editing && !directoryOwned)
                  setWorkingDirectory(suggestInstanceDirectory(next));
                setError(undefined);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void submit();
              }}
            />
          </Flexbox>

          <Flexbox gap={6}>
            <Text fontSize={12} type={'secondary'} weight={500}>
              {t('environments.instances.directoryLabel')}
            </Text>
            {/* Only while editing, where the field is disabled and the reason
                is the whole point of still showing it. Creating, the same
                sentence is the placeholder — one line instead of two, and it
                stands exactly where the answer goes. */}
            {editing && (
              <Text fontSize={12} type={'secondary'}>
                {t('environments.instances.directoryLocked')}
              </Text>
            )}
            {/* Shown while editing, and not editable: the folder holds the built
              state and the execution plane has no rename that carries one
              folder to another. A field that would fail on save is worse than
              a field that says why it cannot. */}
            <Input
              disabled={editing}
              placeholder={t('environments.instances.directoryHint')}
              value={workingDirectory}
              onChange={(event) => {
                const next = event.target.value;
                setWorkingDirectory(next);
                // Empty is not a choice, so it gives the field back rather
                // than counting as one.
                setDirectoryOwned(next.trim() !== '');
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
            disabled={!canCreate}
            loading={creating}
            type={'primary'}
            onClick={() => void submit()}
          >
            {t(editing ? 'environments.instances.save' : 'environments.instances.confirm')}
          </Button>
        </ModalFooter>
      </>
    );
  },
);

CreateInstanceContent.displayName = 'CreateInstanceContent';

export const openCreateInstanceModal = (params: CreateInstanceContentProps) =>
  createModal({
    content: <CreateInstanceContent {...params} />,
    footer: null,
    maskClosable: true,
    styles: { content: { padding: 0 } },
    title: translate(
      params.instance ? 'environments.instances.rename' : 'environments.instances.add',
      { ns: 'setting' },
    ),
    width: 'min(90vw, 480px)',
  });

/** The same dialog, opened on an instance that already exists. */
export const openEditInstanceModal = (instance: SandboxInstance) =>
  openCreateInstanceModal({ environmentId: instance.environmentId, instance });
