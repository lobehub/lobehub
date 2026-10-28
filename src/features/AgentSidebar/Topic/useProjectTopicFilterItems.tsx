import type { DropdownItem } from '@lobehub/ui';
import { Icon } from '@lobehub/ui';
import { CircleDotIcon, LucideCheck, MonitorIcon } from 'lucide-react';
import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useDeviceStore } from '@/store/device';
import { deviceSelectors } from '@/store/device/selectors';
import { useProjectDirectories } from '@/store/projectWorkingDirectory';
import {
  createTopicDeviceResolver,
  TOPIC_STATUS_FILTERS,
  type TopicListFilter,
} from '@/utils/client/topic';

import { resolveDeviceGroupName } from './TopicListContent/ByDeviceMode/resolveDeviceGroup';
import { useTopicListFilter, useTopicListScope } from './TopicListScope';
import { useScopedTopics } from './useScopedTopics';

const check = (selected: boolean) => (selected ? <Icon icon={LucideCheck} /> : <div />);

/**
 * Status and device narrowing for the Project sidebar, offered as submenus of
 * the filter group. Devices are the ones the project's topics actually run on,
 * so the menu never lists a machine that would empty the list. Returns no items
 * outside a project-scoped list.
 */
export const useProjectTopicFilterItems = (): (() => DropdownItem[]) => {
  const { t } = useTranslation('topic');
  const scope = useTopicListScope();
  const filterState = useTopicListFilter();
  const { topics } = useScopedTopics();
  const directories = useProjectDirectories(scope?.projectId);
  const devices = useDeviceStore(deviceSelectors.deviceList);

  const deviceOptions = useMemo(() => {
    const resolveDeviceId = createTopicDeviceResolver(directories);
    const ids = new Set<string>();
    let hasUnattributed = false;
    for (const topic of topics ?? []) {
      const deviceId = resolveDeviceId(topic);
      if (deviceId) ids.add(deviceId);
      else hasUnattributed = true;
    }
    return {
      devices: [...ids].map((id) => {
        const device = devices.find((item) => item.deviceId === id);
        return {
          id,
          name: resolveDeviceGroupName({
            deviceName: directories.find((directory) => directory.deviceId === id)?.deviceName,
            friendlyName: device?.friendlyName,
            hostname: device?.hostname,
            unknownLabel: t('groupTitle.byDevice.unknown'),
          }),
        };
      }),
      hasUnattributed,
    };
  }, [topics, directories, devices, t]);

  return useCallback(() => {
    if (!scope || !filterState) return [];
    const { filter, setFilter } = filterState;
    const update = (patch: TopicListFilter) => setFilter({ ...filter, ...patch });

    const statusLabel = filter.status
      ? t(`groupTitle.byStatus.${filter.status}`)
      : t('filter.allTopics');
    const deviceLabel =
      filter.device === 'none'
        ? t('filter.noDevice')
        : filter.device
          ? (deviceOptions.devices.find((device) => device.id === filter.device)?.name ??
            t('groupTitle.byDevice.unknown'))
          : t('filter.allTopics');

    return [
      {
        children: [
          {
            icon: check(!filter.status),
            key: 'status-all',
            label: t('filter.allTopics'),
            onClick: () => update({ status: undefined }),
          },
          ...TOPIC_STATUS_FILTERS.map((status) => ({
            icon: check(filter.status === status),
            key: `status-${status}`,
            label: t(`groupTitle.byStatus.${status}`),
            onClick: () => update({ status }),
          })),
        ],
        icon: CircleDotIcon,
        key: 'filter-status',
        label: t('filter.byStatus', { value: statusLabel }),
        type: 'submenu' as const,
      },
      {
        children: [
          {
            icon: check(!filter.device),
            key: 'device-all',
            label: t('filter.allTopics'),
            onClick: () => update({ device: undefined }),
          },
          ...deviceOptions.devices.map((device) => ({
            icon: check(filter.device === device.id),
            key: `device-${device.id}`,
            label: device.name,
            onClick: () => update({ device: device.id }),
          })),
          ...(deviceOptions.hasUnattributed
            ? [
                {
                  icon: check(filter.device === 'none'),
                  key: 'device-none',
                  label: t('filter.noDevice'),
                  onClick: () => update({ device: 'none' }),
                },
              ]
            : []),
        ],
        icon: MonitorIcon,
        key: 'filter-device',
        label: t('filter.byDevice', { value: deviceLabel }),
        type: 'submenu' as const,
      },
    ];
  }, [scope, filterState, deviceOptions, t]);
};
