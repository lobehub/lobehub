import { Flexbox, Input } from '@lobehub/ui';
import { Button, createModal, ModalFooter, Text, useModalContext } from '@lobehub/ui/base-ui';
import { t } from 'i18next';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncError from '@/components/AsyncError';
import { deviceService } from '@/services/device';
import { useProjectDirectoryStore } from '@/store/projectWorkingDirectory';

interface EnvironmentOptions {
  deviceId?: string;
  id?: string;
  name?: string;
  onSaved: (environment: { id: string; name: string }) => void | Promise<void>;
  path?: string;
  repositoryUrl?: string;
}
function EnvironmentContent(options: EnvironmentOptions) {
  const { t } = useTranslation('project');
  const { close } = useModalContext();
  const [name, setName] = useState(options.name ?? '');
  const [repositoryUrl, setRepositoryUrl] = useState(options.repositoryUrl ?? '');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>();
  const [failedAction, setFailedAction] = useState<'save' | 'detect'>('save');
  const saveEnvironment = useProjectDirectoryStore((s) => s.saveEnvironment);
  const save = async () => {
    setFailedAction('save');
    setPending(true);
    setError(undefined);
    try {
      const environment = await saveEnvironment({ id: options.id, name, repositoryUrl });
      await options.onSaved(environment);
      close();
    } catch (error) {
      console.error('Failed to save environment', error);
      setError(error);
    } finally {
      setPending(false);
    }
  };
  const detect = async () => {
    setFailedAction('detect');
    setPending(true);
    setError(undefined);
    try {
      const result = await deviceService.statPath(options.deviceId!, options.path!);
      if (!result?.isDirectory) throw new Error(t('directories.unavailable'));
      setRepositoryUrl(result.repositoryUrl ?? '');
    } catch (error) {
      console.error('Failed to detect repository', error);
      setError(error);
    } finally {
      setPending(false);
    }
  };
  return (
    <>
      <Flexbox gap={12} padding={16}>
        <Text>{t('directories.environmentName')}</Text>
        <Input
          aria-label={t('directories.environmentName')}
          disabled={pending}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <Text>{t('directories.repository')}</Text>
        <Input
          aria-label={t('directories.repository')}
          disabled={pending}
          value={repositoryUrl}
          onChange={(e) => setRepositoryUrl(e.target.value)}
        />
        {options.deviceId && options.path && (
          <Button disabled={pending} onClick={detect}>
            {t('directories.detectRepository')}
          </Button>
        )}
        <Text type="secondary">{t('directories.repositoryHint')}</Text>
        {error ? (
          <AsyncError
            description={error instanceof Error ? error.message : undefined}
            error={error}
            onRetry={failedAction === 'detect' ? detect : save}
          />
        ) : null}
      </Flexbox>
      <ModalFooter>
        <Button disabled={pending} onClick={close}>
          {t('cancel', { ns: 'common' })}
        </Button>
        <Button disabled={!name.trim()} loading={pending} type="primary" onClick={save}>
          {t('save', { ns: 'common' })}
        </Button>
      </ModalFooter>
    </>
  );
}
export const openEnvironmentModal = (options: EnvironmentOptions) =>
  createModal({
    title: t(options.id ? 'directories.editEnvironment' : 'directories.newEnvironment', {
      ns: 'project',
    }),
    content: <EnvironmentContent {...options} />,
    footer: null,
    styles: { content: { padding: 0 } },
    width: 480,
  });
