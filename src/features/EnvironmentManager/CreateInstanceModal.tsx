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
import { type SandboxInstance, useEnvironmentActions } from './useEnvironmentData';

interface CreateInstanceContentProps {
  environmentId: string;
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
const CreateInstanceContent = memo<CreateInstanceContentProps>(({ environmentId, onCreated }) => {
  const { t } = useTranslation('setting');
  const { close } = useModalContext();
  const actions = useEnvironmentActions();

  const [name, setName] = useState('');
  const [workingDirectory, setWorkingDirectory] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | undefined>();

  // Checked here against the rule the execution plane applies, so a folder it
  // would refuse is refused while the person is still typing rather than on
  // their next message.
  const canCreate = Boolean(name.trim()) && isSafeSandboxCwd(workingDirectory);

  const submit = async () => {
    if (!canCreate || creating) return;

    setCreating(true);
    setError(undefined);
    try {
      const created = await actions.createInstance({
        environmentId,
        name: name.trim(),
        workingDirectory,
      });
      close();
      onCreated?.(created);
    } catch (cause) {
      // A directory another instance already uses is fixed by typing a
      // different one, so it belongs next to the field rather than in a toast
      // that outlives the dialog.
      setError(
        (cause as { message?: string })?.message === 'DUPLICATE_INSTANCE_DIRECTORY'
          ? t('environments.instances.duplicateDirectory')
          : describeError(cause, t, t('environments.instances.createFailed')),
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
              setName(event.target.value);
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
          <Text fontSize={12} type={'secondary'}>
            {t('environments.instances.directoryHint')}
          </Text>
          <Input
            placeholder={t('environments.instances.directoryPlaceholder')}
            value={workingDirectory}
            onChange={(event) => {
              setWorkingDirectory(event.target.value);
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
          {t('environments.instances.confirm')}
        </Button>
      </ModalFooter>
    </>
  );
});

CreateInstanceContent.displayName = 'CreateInstanceContent';

export const openCreateInstanceModal = (params: CreateInstanceContentProps) =>
  createModal({
    content: <CreateInstanceContent {...params} />,
    footer: null,
    maskClosable: true,
    styles: { content: { padding: 0 } },
    title: translate('environments.instances.add', { ns: 'setting' }),
    width: 'min(90vw, 480px)',
  });
