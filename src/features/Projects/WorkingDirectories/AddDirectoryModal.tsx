import { Flexbox } from '@lobehub/ui';
import {
  Alert,
  Button,
  createModal,
  Input,
  Select,
  Text,
  useModalContext,
} from '@lobehub/ui';
import { t } from 'i18next';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncError from '@/components/AsyncError';
import { deviceService } from '@/services/device';
import { useDeviceStore } from '@/store/device';
import { useProjectDirectoryStore, useProjectEnvironments } from '@/store/projectWorkingDirectory';

function AddDirectoryContent({
  projectId,
  environmentId: initialEnvironmentId,
}: {
  projectId: string;
  environmentId?: string;
}) {
  const { t } = useTranslation('project');
  const deviceRequest = useDeviceStore((s) => s.useFetchDevices)(true);
  const devices = useDeviceStore((s) => s.devices);
  const environmentsRequest = useProjectDirectoryStore((s) => s.useFetchEnvironments)(projectId);
  const environments = useProjectEnvironments(projectId);
  const [environmentId, setEnvironment] = useState(initialEnvironmentId ?? '');
  const [deviceId, setDevice] = useState('');
  const [path, setPath] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>();
  const bind = useProjectDirectoryStore((s) => s.bind);
  const { close } = useModalContext();
  const save = async () => {
    setPending(true);
    setError(undefined);
    try {
      const stat = await deviceService.statPath(deviceId, path);
      if (!stat?.exists || !stat.isDirectory) throw new Error(t('settings.directoryUnavailable'));
      await bind({
        projectId,
        environmentId,
        deviceId,
        path,
        name: path.split(/[\\/]/).findLast(Boolean) || path,
      });
      close();
    } catch (error) {
      console.error('Failed to add work location', error);
      setError(error);
    } finally {
      setPending(false);
    }
  };
  return (
    <Flexbox gap={16}>
      <Text type="secondary">{t('settings.addDirectoryDescription')}</Text>
      <Text>{t('directories.environment')}</Text>
      <Select
        aria-label={t('directories.environment')}
        disabled={pending}
        options={environments.map((env) => ({ value: env.id, label: env.name }))}
        placeholder={t('directories.environment')}
        value={environmentId}
        onChange={(id) => {
          setEnvironment(id ?? '');
          setError(undefined);
        }}
      />
      <Text>{t('directories.device')}</Text>
      <Select
        aria-label={t('directories.device')}
        disabled={pending}
        options={devices.map((d) => ({ value: d.deviceId, label: d.friendlyName || d.deviceId }))}
        placeholder={t('directories.device')}
        value={deviceId}
        onChange={(id) => {
          setDevice(id ?? '');
          setError(undefined);
        }}
      />
      <Text>{t('directories.path')}</Text>
      <Input
        aria-label={t('directories.path')}
        disabled={pending}
        placeholder={t('directories.path')}
        value={path}
        onChange={(e) => {
          setPath(e.target.value);
          setError(undefined);
        }}
      />
      {error ? (
        <Alert
          showIcon
          description={error instanceof Error ? error.message : undefined}
          title={t('settings.addDirectoryFailed')}
          type="error"
        />
      ) : null}
      {deviceRequest.error || environmentsRequest.error ? (
        <AsyncError
          error={deviceRequest.error || environmentsRequest.error}
          onRetry={() => Promise.all([deviceRequest.mutate(), environmentsRequest.revalidate()])}
        />
      ) : null}
      <Flexbox horizontal gap={8} justify="flex-end">
        <Button disabled={pending} onClick={close}>
          {t('cancel', { ns: 'common' })}
        </Button>
        <Button
          disabled={!environmentId || !deviceId || !path.trim()}
          loading={pending}
          type="primary"
          onClick={save}
        >
          {t('settings.addDirectory')}
        </Button>
      </Flexbox>
    </Flexbox>
  );
}
export const openAddDirectoryModal = (projectId: string, environmentId?: string) =>
  createModal({
    title: t('settings.addDirectory', { ns: 'project' }),
    content: <AddDirectoryContent environmentId={environmentId} projectId={projectId} />,
    footer: null,
    width: 520,
  });
