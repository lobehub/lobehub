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
import { t } from 'i18next';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncError from '@/components/AsyncError';
import { getDeviceIcon } from '@/features/DeviceManager/getDeviceIcon';
import { useDeviceSelectOptions } from '@/features/DeviceManager/useDeviceSelectOptions';
import { RemoteDirectoryBrowser } from '@/features/WorkingDirectory/RemoteDirectoryBrowser';
import { deviceService } from '@/services/device';
import { deviceSelectors, useDeviceStore } from '@/store/device';
import { useProjectDirectoryStore, useProjectEnvironments } from '@/store/projectWorkingDirectory';

interface AddDirectoryOptions {
  /** The machine to add it on, when the caller already knows it. */
  deviceId?: string;
  /** Called with the folder once it is part of the project. */
  /** Called with the folder once it is part of the project, and the device it was saved on. */
  onAdded?: (directory: { deviceId: string; id: string }) => void;
}

function AddDirectoryContent({
  projectId,
  environmentId: initialEnvironmentId,
  deviceId: initialDeviceId,
  onAdded,
}: AddDirectoryOptions & {
  projectId: string;
  environmentId?: string;
}) {
  const { t } = useTranslation('project');
  const deviceRequest = useDeviceStore((s) => s.useFetchDevices)(true);
  const devices = useDeviceStore(deviceSelectors.deviceList);
  const environmentsRequest = useProjectDirectoryStore((s) => s.useFetchEnvironments)(projectId);
  const environments = useProjectEnvironments(projectId);
  // A project has one environment, made with it: nothing to choose.
  const environmentId = initialEnvironmentId ?? environments[0]?.id ?? '';
  const [deviceId, setDevice] = useState(initialDeviceId ?? '');
  // Opened from a device's own row: the machine is decided, only its folder is asked.
  const fixedDevice = initialDeviceId
    ? devices.find((device) => device.deviceId === initialDeviceId)
    : undefined;
  const fixedDeviceName = initialDeviceId
    ? fixedDevice?.friendlyName || fixedDevice?.hostname || initialDeviceId
    : undefined;
  const [path, setPath] = useState('');
  // An online machine is browsed for the folder; typing the path is the fallback.
  const [manual, setManual] = useState(false);
  const device = devices.find((item) => item.deviceId === deviceId);
  const browsable = !!device?.online && !manual;
  const deviceOptions = useDeviceSelectOptions(devices, deviceId);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>();
  const bind = useProjectDirectoryStore((s) => s.bind);
  const { close } = useModalContext();
  const save = async (path: string) => {
    if (!environmentId || !deviceId || !path.trim()) return;
    setPending(true);
    setError(undefined);
    try {
      const stat = await deviceService.statPath(deviceId, path);
      if (!stat?.exists || !stat.isDirectory) throw new Error(t('settings.directoryUnavailable'));
      const added = await bind({
        projectId,
        environmentId,
        deviceId,
        path,
        name: path.split(/[\\/]/).findLast(Boolean) || path,
      });
      close();
      // The device picked here, not the one the caller suggested: the person may have changed it.
      onAdded?.({ deviceId, id: added.id });
    } catch (error) {
      console.error('Failed to add work location', error);
      setError(error);
    } finally {
      setPending(false);
    }
  };
  const errorMessage = error instanceof Error ? error.message : undefined;
  return (
    <Flexbox gap={16}>
      {!browsable && (
        <Text type="secondary">
          {fixedDeviceName
            ? t('settings.setDirectoryDescription', { device: fixedDeviceName })
            : t('settings.addDirectoryDescription')}
        </Text>
      )}
      {fixedDeviceName ? (
        <Flexbox horizontal align="center" gap={8}>
          {getDeviceIcon(fixedDevice?.platform, 16)}
          <Text weight={500}>{fixedDeviceName}</Text>
        </Flexbox>
      ) : (
        <>
          <Text>{t('directories.device')}</Text>
          <Select
            aria-label={t('directories.device')}
            disabled={pending}
            options={deviceOptions}
            placeholder={t('directories.device')}
            value={deviceId}
            onChange={(id) => {
              setDevice(id ?? '');
              setManual(false);
              setError(undefined);
            }}
          />
        </>
      )}
      {browsable ? (
        // The device's own folders, as when adding a working directory to an agent.
        <RemoteDirectoryBrowser
          deviceId={deviceId}
          error={error ? errorMessage || t('settings.addDirectoryFailed') : undefined}
          loading={pending}
          onCancel={close}
          onSelect={(picked) => void save(picked)}
          onManual={(typed) => {
            setPath(typed);
            setError(undefined);
            setManual(true);
          }}
        />
      ) : (
        <ManualPath
          canBrowse={!!device?.online}
          deviceId={deviceId}
          environmentId={environmentId}
          error={error}
          errorMessage={errorMessage}
          path={path}
          pending={pending}
          submitLabel={t(
            initialDeviceId ? 'settings.setDeviceDirectory' : 'settings.addExecutionEnvironment',
          )}
          onBrowse={() => setManual(false)}
          onCancel={close}
          onSave={() => void save(path)}
          onChange={(next) => {
            setPath(next);
            setError(undefined);
          }}
        />
      )}
      {deviceRequest.error || environmentsRequest.error ? (
        <AsyncError
          error={deviceRequest.error || environmentsRequest.error}
          onRetry={() =>
            Promise.all([deviceRequest.revalidate(), environmentsRequest.revalidate()])
          }
        />
      ) : null}
    </Flexbox>
  );
}

/** The typed-path form: for an offline machine, or when the person chose to type it. */
const ManualPath = ({
  canBrowse,
  deviceId,
  environmentId,
  error,
  errorMessage,
  onBrowse,
  onCancel,
  onChange,
  onSave,
  path,
  pending,
  submitLabel,
}: {
  canBrowse: boolean;
  deviceId: string;
  environmentId: string;
  error: unknown;
  errorMessage?: string;
  onBrowse: () => void;
  onCancel: () => void;
  onChange: (path: string) => void;
  onSave: () => void;
  path: string;
  pending: boolean;
  submitLabel: string;
}) => {
  const { t } = useTranslation('project');
  const { t: tDevice } = useTranslation('device');
  return (
    <>
      <Text>{t('directories.path')}</Text>
      <Input
        aria-label={t('directories.path')}
        disabled={pending}
        placeholder={t('directories.path')}
        value={path}
        onChange={(e) => onChange(e.target.value)}
        onPressEnter={() => environmentId && deviceId && path.trim() && onSave()}
      />
      {error ? (
        <Alert
          showIcon
          description={errorMessage}
          title={t('settings.addDirectoryFailed')}
          type="error"
        />
      ) : null}
      <Flexbox horizontal align="center" gap={8} justify="space-between">
        <div>
          {canBrowse && (
            <Button disabled={pending} onClick={onBrowse}>
              {tDevice('workingDirectory.browseFolders')}
            </Button>
          )}
        </div>
        <Flexbox horizontal gap={8}>
          <Button disabled={pending} onClick={onCancel}>
            {t('cancel', { ns: 'common' })}
          </Button>
          <Button
            disabled={!environmentId || !deviceId || !path.trim()}
            loading={pending}
            type="primary"
            onClick={onSave}
          >
            {submitLabel}
          </Button>
        </Flexbox>
      </Flexbox>
    </>
  );
};
export const openAddDirectoryModal = (
  projectId: string,
  environmentId?: string,
  options: AddDirectoryOptions = {},
) =>
  createModal({
    title: t(
      options.deviceId ? 'settings.setDeviceDirectory' : 'settings.addExecutionEnvironment',
      { ns: 'project' },
    ),
    content: (
      <AddDirectoryContent {...options} environmentId={environmentId} projectId={projectId} />
    ),
    footer: null,
    width: 520,
  });
