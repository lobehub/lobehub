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
import { useInViewport } from 'ahooks';
import { BoxIcon, CloudIcon, PencilIcon, PlusIcon, Trash2Icon } from 'lucide-react';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncError from '@/components/AsyncError';
import { useDeviceMetricSeries } from '@/features/DeviceManager/DeviceHealth/shared';
import { getDeviceIcon } from '@/features/DeviceManager/getDeviceIcon';
import { useSingleton } from '@/hooks/useSingleton';
import { deviceSelectors, useDeviceStore } from '@/store/device';
import type { ProjectDirectory } from '@/store/projectWorkingDirectory';
import { useProjectDirectoryStore } from '@/store/projectWorkingDirectory';
import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';
import { formatSize } from '@/utils/format';

import { openAddDirectoryModal } from './AddDirectoryModal';
import {
  type DirectoryEnableAttempt,
  directoryUnavailableReason,
  isMissingDirectoryError,
} from './directoryAvailability';
import { openEditDirectoryModal } from './EditDirectoryModal';
import type { ProjectExecutionEnvironment } from './executionEnvironmentOrder';
import { runDeviceFacts, runDevicePlatform } from './runDeviceFacts';
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

/**
 * The machine's size — cores and memory — from its last health report, or
 * nothing for a device that never sent one. Read per card while it is on
 * screen, as the device list does: each row fetches (and caches) its own
 * device's series, the same one the device page shows.
 */
const DeviceSpec = ({ device }: { device: DeviceListItem }) => {
  const { t } = useTranslation('setting');
  const ref = useRef<HTMLSpanElement>(null);
  const [inViewport] = useInViewport(ref);
  const { data } = useDeviceMetricSeries(device.deviceId, device.scope, !!inViewport);
  const parts = [
    data?.cpuCount ? t('devices.detail.cores', { count: data.cpuCount }) : undefined,
    data?.memoryTotalBytes ? formatSize(data.memoryTotalBytes, 0) : undefined,
  ].filter(Boolean);
  // The anchor stays mounted while nothing is known, so the row can come into view.
  return (
    <span ref={ref} style={{ flex: 'none' }}>
      {parts.length > 0 && (
        <Text fontSize={12} type="secondary">
          {`· ${parts.join(' · ')}`}
        </Text>
      )}
    </span>
  );
};

interface ExecutionEnvironmentsProps {
  canManage: boolean;
  /** The project's environment, which a new run device is linked to. */
  environmentId?: string;
  projectId: string;
}

/**
 * The project's run devices, as one list in priority order: the cloud
 * sandbox, and every device someone added with the workspace root to work
 * under — the same machine may appear more than once, with different roots.
 * Dragging a row changes the order runs follow. What gets prepared on the
 * chosen device — repositories, setup, variables — is the project's
 * environment, edited on its own tab; a device records none of it.
 */
export function ExecutionEnvironments({
  canManage,
  environmentId,
  projectId,
}: ExecutionEnvironmentsProps) {
  const { t } = useTranslation('project');
  const { error, loaded, ordered, reorder, revalidate } =
    useProjectExecutionEnvironments(projectId);
  const deviceRequest = useDeviceStore((s) => s.useFetchDevices)(true);
  const devices = useDeviceStore(deviceSelectors.deviceList);
  const isDeviceListLoaded = useDeviceStore(deviceSelectors.isDeviceListLoaded);
  const removeDirectory = useProjectDirectoryStore((s) => s.removeDirectory);
  const bind = useProjectDirectoryStore((s) => s.bind);
  const currentUserId = useUserStore(userProfileSelectors.userId);
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
      console.error('Failed to reorder run devices', error);
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
   * One run device as a card: an icon tile, its name with any
   * state tag, a quiet line saying where it works, and its actions.
   */
  // The drag handle sits at the right end of each card's header row, after its
  // actions — the same place on every card, an unfolded sandbox included.
  const handle = canManage ? <SortableList.DragHandle /> : null;

  const card = ({
    actions,
    icon,
    meta,
    tags,
    title,
  }: {
    actions?: ReactNode;
    icon: ReactNode;
    meta?: ReactNode;
    tags?: ReactNode;
    title: string;
  }) => (
    <Flexbox horizontal align="center" flex={1} gap={12} style={{ minWidth: 0 }}>
      <Flexbox
        align="center"
        justify="center"
        style={{
          background: cssVar.colorFillTertiary,
          borderRadius: 10,
          flex: 'none',
          height: 40,
          width: 40,
        }}
      >
        {icon}
      </Flexbox>
      <Flexbox flex={1} gap={2} style={{ minWidth: 0 }}>
        <Flexbox horizontal align="center" gap={8} style={{ minWidth: 0 }}>
          <Text ellipsis fontSize={15} weight={500}>
            {title}
          </Text>
          {tags}
        </Flexbox>
        {meta && (
          <Flexbox horizontal align="center" gap={6} style={{ minWidth: 0 }}>
            {meta}
          </Flexbox>
        )}
      </Flexbox>
      {(actions || handle) && (
        <Flexbox horizontal align="center" gap={4} style={{ flex: 'none' }}>
          {actions}
          {handle}
        </Flexbox>
      )}
    </Flexbox>
  );

  const metaText = (text: string) => (
    <Text ellipsis={{ tooltip: text, tooltipWhenOverflow: true }} fontSize={12} type="secondary">
      {text}
    </Text>
  );

  // The sandbox has nothing of its own to set: it starts empty each run and
  // prepares the project's environment, which its tab edits.
  const renderSandbox = () =>
    card({
      icon: <Icon icon={BoxIcon} size={20} />,
      meta: metaText(t('settings.sandboxRunHint')),
      title: t('settings.cloudSandboxGroup'),
    });

  const renderDirectory = (directory: ProjectDirectory) => {
    const device = devices.find((item) => item.deviceId === directory.deviceId);
    const presence = device?.onlineUnknown
      ? undefined
      : t(device?.online ? 'settings.deviceOnline' : 'settings.deviceOffline');
    const platform = runDevicePlatform(device, directory.platform);
    const facts = runDeviceFacts(device, currentUserId);
    const separator = (
      <Text fontSize={12} style={{ flex: 'none' }} type="secondary">
        ·
      </Text>
    );
    return card({
      actions: canManage ? (
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
      ) : undefined,
      icon: getDeviceIcon(device?.platform ?? directory.platform ?? undefined, 20),
      meta: (
        <>
          <DevicePresence device={device} />
          {presence && (
            <Text fontSize={12} style={{ flex: 'none' }} type="secondary">
              {presence}
            </Text>
          )}
          {platform && (
            <>
              {separator}
              <Text fontSize={12} style={{ flex: 'none' }} type="secondary">
                {platform}
              </Text>
            </>
          )}
          {device && <DeviceSpec device={device} />}
          {separator}
          {metaText(directory.path)}
        </>
      ),
      tags: (
        <>
          {unavailableBadge(directory, device)}
          {/* One tag for what it is and that it costs: with presence and
              sharing beside it, a second one would push the name out. */}
          {facts.managed && (
            <Tooltip title={t('settings.paidDeviceTooltip')}>
              <Tag color="info" icon={<Icon icon={CloudIcon} />} size="small">
                {t('settings.paidDeviceTag')}
              </Tag>
            </Tooltip>
          )}
          {facts.sharedBy && (
            <Tag size="small">{t('settings.sharedDeviceTag', { name: facts.sharedBy })}</Tag>
          )}
        </>
      ),
      title: device?.friendlyName || device?.hostname || directory.deviceName || directory.deviceId,
    });
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
    <Flexbox gap={12}>
      <Flexbox horizontal align="center" gap={16} justify="space-between">
        <Text fontSize={13} type="secondary">
          {t('settings.executionOrderHint')}
        </Text>
        {canManage && (
          <Button
            icon={<Icon icon={PlusIcon} />}
            style={{ flex: 'none' }}
            type="primary"
            onClick={() => openAddDirectoryModal(projectId, environmentId)}
          >
            {t('settings.addExecutionEnvironment')}
          </Button>
        )}
      </Flexbox>
      {canManage ? (
        <SortableList
          items={items}
          renderItem={(item: ProjectExecutionEnvironment) => (
            <SortableList.Item
              id={item.id}
              style={{ borderRadius: 16, padding: 16 }}
              variant="filled"
            >
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
            padding={16}
            style={{ background: cssVar.colorFillQuaternary, borderRadius: 16 }}
          >
            {render(item)}
          </Flexbox>
        ))
      )}
    </Flexbox>
  );
}
