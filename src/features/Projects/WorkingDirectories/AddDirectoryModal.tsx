import { Flexbox, Input } from '@lobehub/ui';
import { Button, createModal, Select, Text, useModalContext } from '@lobehub/ui/base-ui';
import { t } from 'i18next';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncError from '@/components/AsyncError';
import { deviceService } from '@/services/device';
import { useDeviceStore } from '@/store/device';
import { useProjectDirectoryStore } from '@/store/projectWorkingDirectory';

function AddDirectoryContent({
  projectId,
  environmentId,
}: {
  projectId: string;
  environmentId: string;
}) {
  const { t } = useTranslation('project');
  const deviceRequest = useDeviceStore((s) => s.useFetchDevices)(true);
  const devices = useDeviceStore((s) => s.devices);
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
      <Select
        aria-label={t('directories.device')}
        disabled={pending}
        options={devices.map((d) => ({ value: d.deviceId, label: d.friendlyName || d.deviceId }))}
        placeholder={t('directories.device')}
        value={deviceId}
        onChange={(id) => setDevice(id ?? '')}
      />
      <Input
        aria-label={t('directories.path')}
        disabled={pending}
        placeholder={t('directories.path')}
        value={path}
        onChange={(e) => setPath(e.target.value)}
      />
      {error || deviceRequest.error ? (
        <AsyncError
          description={error instanceof Error ? error.message : undefined}
          error={error || deviceRequest.error}
          onRetry={() => (error ? save() : deviceRequest.mutate())}
        />
      ) : null}
      <Flexbox horizontal gap={8} justify="flex-end">
        <Button disabled={pending} onClick={close}>
          {t('cancel', { ns: 'common' })}
        </Button>
        <Button
          disabled={!deviceId || !path.trim()}
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
export const openAddDirectoryModal = (projectId: string, environmentId: string) =>
  createModal({
    title: t('settings.addDirectory', { ns: 'project' }),
    content: <AddDirectoryContent environmentId={environmentId} projectId={projectId} />,
    footer: null,
    width: 520,
  });
