import type { DeviceListItem } from '@lobechat/types';
import {
  ActionIcon,
  Button,
  confirmModal,
  cssVar,
  Flexbox,
  Icon,
  SortableList,
  Tag,
  Text,
  toast,
  Tooltip,
} from '@lobehub/ui';
import {
  BoxIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  FolderIcon,
  PencilIcon,
  PlusIcon,
  Trash2Icon,
} from 'lucide-react';
import { type ReactNode, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncError from '@/components/AsyncError';
import { getDeviceIcon } from '@/features/DeviceManager/getDeviceIcon';
import { useSingleton } from '@/hooks/useSingleton';
import { deviceSelectors, useDeviceStore } from '@/store/device';
import type { ProjectDirectory } from '@/store/projectWorkingDirectory';
import { useProjectDirectoryStore } from '@/store/projectWorkingDirectory';

import { openAddDirectoryModal } from './AddDirectoryModal';
import {
  type DirectoryEnableAttempt,
  directoryUnavailableReason,
  isMissingDirectoryError,
} from './directoryAvailability';
import { openEditDirectoryModal } from './EditDirectoryModal';
import type { ProjectExecutionEnvironment } from './executionEnvironments';
import { useProjectExecutionEnvironments } from './useProjectExecutionEnvironments';

/**
 * Presence as a dot — green online, gray offline — with the word on hover. A
 * device restored from the persisted list (`onlineUnknown`) has not been
 * confirmed yet, so it shows no dot until `listDevices` answers.
 */
const DevicePresence = ({ device }: { device?: DeviceListItem }) => {
  const { t } = useTranslation('project');
  if (device?.onlineUnknown) return null;
  const online = !!device?.online;
  const label = t(online ? 'settings.deviceOnline' : 'settings.deviceOffline');
  // A plain element with its own title: a tooltip trigger inside a sortable
  // row renders as a bordered button.
  return (
    <div
      aria-label={label}
      role="img"
      title={label}
      style={{
        background: online ? cssVar.colorSuccess : cssVar.colorTextQuaternary,
        borderRadius: '50%',
        flex: 'none',
        height: 8,
        width: 8,
      }}
    />
  );
};

interface ExecutionEnvironmentsProps {
  canManage: boolean;
  /** The project's environment, which a new folder is linked to. */
  environmentId?: string;
  projectId: string;
  /** What the cloud sandbox row unfolds into: the project environment's form. */
  sandboxDetails: ReactNode;
  /** The cloud sandbox's repositories, named on its row. */
  sandboxSummary?: string;
}

/**
 * Where the project's conversations run, as one list in priority order: the
 * cloud sandbox, and every device folder someone added. Dragging a row
 * changes the order a new conversation follows — the first folder that is
 * ready on an online device, or the cloud sandbox, which always is. A project
 * starts with only the sandbox; a folder is added on purpose, device by
 * device.
 */
export function ExecutionEnvironments({
  canManage,
  environmentId,
  projectId,
  sandboxDetails,
  sandboxSummary,
}: ExecutionEnvironmentsProps) {
  const { t } = useTranslation('project');
  const { error, loaded, ordered, reorder, revalidate } =
    useProjectExecutionEnvironments(projectId);
  const deviceRequest = useDeviceStore((s) => s.useFetchDevices)(true);
  const devices = useDeviceStore(deviceSelectors.deviceList);
  const isDeviceListLoaded = useDeviceStore(deviceSelectors.isDeviceListLoaded);
  const removeDirectory = useProjectDirectoryStore((s) => s.removeDirectory);
  const bind = useProjectDirectoryStore((s) => s.bind);
  const [sandboxOpen, setSandboxOpen] = useState(false);
  // The order being dragged, shown at once; the saved one replaces it.
  const [pendingOrder, setPendingOrder] = useState<string[]>();

  const directories = ordered.flatMap((item) =>
    item.kind === 'directory' ? [item.directory] : [],
  );

  // A folder registered before environments existed is not enabled for the
  // project's environment yet, so nothing can start in it. There is nothing to
  // choose — a project has one environment — so it is enabled here, once,
  // while its device is online, by someone who may change the project.
  const [attempts, setAttempts] = useState<Record<string, DirectoryEnableAttempt>>({});
  // Tried once per page visit; a folder whose enable is in flight shows nothing.
  const tried = useSingleton(() => new Set<string>());
  useEffect(() => {
    if (!canManage || !environmentId) return;
    for (const directory of directories) {
      if (directory.instanceId || tried.has(directory.id)) continue;
      const device = devices.find((item) => item.deviceId === directory.deviceId);
      if (!device?.online || device.onlineUnknown) continue;
      tried.add(directory.id);
      bind({
        deviceId: directory.deviceId,
        environmentId,
        name: directory.name,
        path: directory.path,
        projectId,
      }).catch((error: unknown) => {
        console.error('Failed to enable project directory', error);
        setAttempts((current) => ({
          ...current,
          [directory.id]: isMissingDirectoryError(error) ? 'missing' : 'failed',
        }));
      });
    }
  }, [bind, canManage, devices, directories, environmentId, projectId, tried]);

  const remove = (directory: ProjectDirectory) =>
    confirmModal({
      cancelText: t('cancel', { ns: 'common' }),
      content: t('settings.removeDirectoryConfirmDescription', {
        device: directory.deviceName || directory.deviceId,
        path: directory.path,
      }),
      okButtonProps: { danger: true },
      okText: t('settings.removeDirectory'),
      onOk: async () => {
        try {
          await removeDirectory(projectId, directory.id);
        } catch (error) {
          console.error('Failed to remove project directory', error);
          toast.error(t('settings.removeDirectoryFailed'));
        }
      },
      title: t('settings.removeDirectoryConfirmTitle', { name: directory.name }),
    });

  const save = async (order: string[]) => {
    setPendingOrder(order);
    try {
      await reorder(order);
    } catch (error) {
      console.error('Failed to reorder execution environments', error);
      toast.error(t('settings.reorderFailed'));
    } finally {
      setPendingOrder(undefined);
    }
  };

  // A folder nothing can start in yet, said only when it needs something from
  // the person: a device to come online, a path to fix, or someone who may.
  const unavailableBadge = (directory: ProjectDirectory, device?: DeviceListItem) => {
    const reason = directoryUnavailableReason({
      attempt: attempts[directory.id],
      canManage,
      enabled: !!directory.instanceId,
      online: !!device?.online,
      presenceUnknown: !!device?.onlineUnknown,
    });
    if (!reason) return null;
    return (
      <Tooltip title={t(`settings.directoryUnavailable_${reason}`)}>
        <Tag color="warning" size="small">
          {t('settings.directoryUnavailableTag')}
        </Tag>
      </Tooltip>
    );
  };

  /**
   * One execution environment on one line: what it is, where it works — cut
   * short with the whole text on hover — then its state and its actions.
   */
  const line = (head: ReactNode, place: ReactNode, status: ReactNode, actions: ReactNode) => (
    <Flexbox horizontal align="center" flex={1} gap={16} style={{ minWidth: 0 }}>
      <Flexbox horizontal align="center" gap={8} style={{ flex: 'none', maxWidth: '45%' }}>
        {head}
      </Flexbox>
      <Flexbox horizontal align="center" flex={1} gap={6} style={{ minWidth: 0 }}>
        {place}
      </Flexbox>
      <Flexbox horizontal align="center" gap={8} style={{ flex: 'none' }}>
        {status}
      </Flexbox>
      <Flexbox horizontal align="center" gap={4} style={{ flex: 'none' }}>
        {actions}
      </Flexbox>
    </Flexbox>
  );

  const placeText = (text: string, icon = FolderIcon) => (
    <>
      <Icon icon={icon} size={14} style={{ color: cssVar.colorTextTertiary, flex: 'none' }} />
      <Text ellipsis={{ tooltip: text, tooltipWhenOverflow: true }} fontSize={12} type="secondary">
        {text}
      </Text>
    </>
  );

  const renderSandbox = () => (
    <Flexbox flex={1} gap={8} style={{ minWidth: 0 }}>
      {line(
        <>
          <Icon icon={BoxIcon} size={16} />
          <Text ellipsis weight={500}>
            {t('settings.cloudSandboxGroup')}
          </Text>
        </>,
        sandboxSummary ? (
          <Text ellipsis fontSize={12} type="secondary">
            {sandboxSummary}
          </Text>
        ) : null,
        null,
        <ActionIcon
          icon={sandboxOpen ? ChevronDownIcon : ChevronRightIcon}
          size="small"
          title={t('settings.configureSandbox')}
          onClick={() => setSandboxOpen((value) => !value)}
        />,
      )}
      {sandboxOpen && <div style={{ paddingBlock: 8 }}>{sandboxDetails}</div>}
    </Flexbox>
  );

  const renderDirectory = (directory: ProjectDirectory) => {
    const device = devices.find((item) => item.deviceId === directory.deviceId);
    return line(
      <>
        {getDeviceIcon(device?.platform ?? directory.platform ?? undefined, 16)}
        <Text ellipsis weight={500}>
          {device?.friendlyName || device?.hostname || directory.deviceName || directory.deviceId}
        </Text>
      </>,
      placeText(directory.path),
      <>
        {unavailableBadge(directory, device)}
        <DevicePresence device={device} />
      </>,
      canManage ? (
        <>
          <ActionIcon
            icon={PencilIcon}
            size="small"
            title={t('settings.editDirectory')}
            onClick={() => openEditDirectoryModal(projectId, directory)}
          />
          <ActionIcon
            icon={Trash2Icon}
            size="small"
            title={t('settings.removeDirectory')}
            onClick={() => remove(directory)}
          />
        </>
      ) : null,
    );
  };

  const render = (item: ProjectExecutionEnvironment) =>
    item.kind === 'sandbox' ? renderSandbox() : renderDirectory(item.directory);

  if (error || deviceRequest.error)
    return (
      <AsyncError
        error={error || deviceRequest.error}
        onRetry={() => Promise.all([revalidate(), deviceRequest.revalidate()])}
      />
    );
  if (!loaded || !isDeviceListLoaded)
    return <Text type="secondary">{t('loading', { ns: 'common' })}</Text>;

  const byId = new Map(ordered.map((item) => [item.id, item]));
  const items = (pendingOrder ?? ordered.map((item) => item.id)).flatMap((id) => {
    const item = byId.get(id);
    return item ? [item] : [];
  });

  return (
    <Flexbox gap={8}>
      {canManage ? (
        <SortableList
          items={items}
          renderItem={(item: ProjectExecutionEnvironment) => (
            <SortableList.Item id={item.id} variant="filled">
              <SortableList.DragHandle />
              {render(item)}
            </SortableList.Item>
          )}
          onChange={(next: ProjectExecutionEnvironment[]) => void save(next.map((item) => item.id))}
        />
      ) : (
        items.map((item) => (
          <Flexbox
            horizontal
            align="center"
            key={item.id}
            paddingBlock={8}
            paddingInline={12}
            style={{ background: cssVar.colorFillQuaternary, borderRadius: cssVar.borderRadius }}
          >
            {render(item)}
          </Flexbox>
        ))
      )}
      {canManage && (
        <div>
          <Button
            icon={<Icon icon={PlusIcon} />}
            size="small"
            onClick={() => openAddDirectoryModal(projectId, environmentId)}
          >
            {t('settings.addExecutionEnvironment')}
          </Button>
        </div>
      )}
    </Flexbox>
  );
}
