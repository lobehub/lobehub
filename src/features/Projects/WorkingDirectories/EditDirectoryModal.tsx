import {
  Alert,
  Button,
  createModal,
  Flexbox,
  Input,
  Select,
  Text,
  useModalContext,
} from '@lobehub/ui';
import { TRPCClientError } from '@trpc/client';
import { t } from 'i18next';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncError from '@/components/AsyncError';
import { deviceService } from '@/services/device';
import { deviceSelectors, useDeviceStore } from '@/store/device';
import type { ProjectDirectory } from '@/store/projectWorkingDirectory';
import { useProjectDirectoryStore } from '@/store/projectWorkingDirectory';

/** A refusal the user can act on, in their language; anything else keeps its own message. */
const describeError = (error: unknown) => {
  if (error instanceof TRPCClientError && error.data?.code === 'CONFLICT')
    return t('settings.editDirectoryBusy', { ns: 'project' });
  return error instanceof Error ? error.message : undefined;
};

function EditDirectoryContent({
  directory,
  projectId,
}: {
  directory: ProjectDirectory;
  projectId: string;
}) {
  const { t } = useTranslation('project');
  const deviceRequest = useDeviceStore((s) => s.useFetchDevices)(true);
  const devices = useDeviceStore(deviceSelectors.deviceList);
  const [deviceId, setDevice] = useState(directory.deviceId);
  const [path, setPath] = useState(directory.path);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>();
  const relocate = useProjectDirectoryStore((s) => s.relocateDirectory);
  const { close } = useModalContext();
  const unchanged = deviceId === directory.deviceId && path.trim() === directory.path;
  const save = async () => {
    setPending(true);
    setError(undefined);
    try {
      const stat = await deviceService.statPath(deviceId, path.trim());
      if (!stat?.exists || !stat.isDirectory) throw new Error(t('settings.directoryUnavailable'));
      await relocate({ deviceId, id: directory.id, path: path.trim(), projectId });
      close();
    } catch (error) {
      console.error('Failed to update project directory', error);
      setError(error);
    } finally {
      setPending(false);
    }
  };
  return (
    <Flexbox gap={16}>
      <Text type="secondary">{t('settings.editDirectoryDescription')}</Text>
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
          description={describeError(error)}
          title={t('settings.editDirectoryFailed')}
          type="error"
        />
      ) : null}
      {deviceRequest.error ? (
        <AsyncError error={deviceRequest.error} onRetry={() => deviceRequest.revalidate()} />
      ) : null}
      <Flexbox horizontal gap={8} justify="flex-end">
        <Button disabled={pending} onClick={close}>
          {t('cancel', { ns: 'common' })}
        </Button>
        <Button
          disabled={!deviceId || !path.trim() || unchanged}
          loading={pending}
          type="primary"
          onClick={save}
        >
          {t('save', { ns: 'common' })}
        </Button>
      </Flexbox>
    </Flexbox>
  );
}

export const openEditDirectoryModal = (projectId: string, directory: ProjectDirectory) =>
  createModal({
    title: t('settings.editDirectory', { ns: 'project' }),
    content: <EditDirectoryContent directory={directory} projectId={projectId} />,
    footer: null,
    width: 520,
  });
