'use client';

import {
  AccordionHeader,
  AccordionItem,
  AccordionPanel,
  accordionStyles,
  AccordionTrigger,
  ActionIcon,
  Center,
  cssVar,
  cx,
  Flexbox,
  Icon,
  Tag,
  Text,
} from '@lobehub/ui';
import isEqual from 'fast-deep-equal';
import { MonitorIcon, PlusIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import TailMarquee from '@/components/TailMarquee';
import { getDeviceIcon } from '@/features/DeviceManager/getDeviceIcon';
import { startProjectTopicDraft } from '@/features/Projects/WorkingDirectories/startProjectTopicDraft';
import { useAgentFixedDeviceId } from '@/features/Projects/WorkingDirectories/useAgentFixedDeviceId';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useLocalMachineDeviceIds } from '@/hooks/useLocalMachineDeviceIds';
import { useAgentStore } from '@/store/agent';
import { useDeviceStore } from '@/store/device';
import { deviceSelectors } from '@/store/device/selectors';
import { useElectronStore } from '@/store/electron';
import { useProjectDirectories } from '@/store/projectWorkingDirectory';

import TopicItem from '../../List/Item';
import { useTopicListScope } from '../../TopicListScope';
import { deviceCategoryKey } from '../ByProjectMode/deviceIdentity';
import { type GroupItemComponentProps } from '../GroupedAccordion';
import {
  findDeviceTopicDirectory,
  hasNamesakeDevice,
  resolveDeviceGroupName,
} from './resolveDeviceGroup';

const DEVICE_GROUP_PREFIX = 'device:';

const GroupItem = memo<GroupItemComponentProps>(({ group }) => {
  const { t } = useTranslation('topic');
  const { t: tProject } = useTranslation('project');
  const { t: tChat } = useTranslation('chat');
  const { id, title, children } = group;
  const deviceId = id.startsWith(DEVICE_GROUP_PREFIX)
    ? id.slice(DEVICE_GROUP_PREFIX.length)
    : undefined;

  const scope = useTopicListScope();
  const directories = useProjectDirectories(scope?.projectId);
  const activeAgentId = useAgentStore((s) => s.activeAgentId);
  // The directory registry names most buckets; the device list covers devices
  // whose directory was removed from the project, and tells namesakes apart.
  useDeviceStore((s) => s.useFetchDevices)(!!deviceId);
  const device = useDeviceStore(deviceSelectors.getDeviceById(deviceId));
  const devices = useDeviceStore(deviceSelectors.deviceList);
  // This machine's group (keyed by its personal id) holds every identity it is
  // registered under; any other group stands for one device.
  const localDeviceIds = useLocalMachineDeviceIds();
  const ownIds = deviceId ? (localDeviceIds[0] === deviceId ? localDeviceIds : [deviceId]) : [];
  const currentDeviceId = useElectronStore((s) => s.gatewayDeviceInfo?.deviceId);

  // A synthetic bucket (e.g. favorites) carries its own title; only real
  // `device:` buckets resolve a name from the directory/device registries.
  const name = resolveDeviceGroupName({
    deviceName: directories.find((d) => d.deviceId === deviceId)?.deviceName,
    friendlyName: device?.friendlyName,
    hostname: device?.hostname,
    title,
    unknownLabel: t('groupTitle.byDevice.unknown'),
  });
  // Where this machine's identities cannot be merged (web, another machine),
  // a namesake group is told apart by its execution-environment category.
  const categoryKey =
    deviceId && hasNamesakeDevice({ devices, directories, name, ownIds })
      ? deviceCategoryKey(deviceId, devices, currentDeviceId)
      : undefined;

  // Stage a directory on this device so the blank conversation runs where the
  // group points; only a runnable directory can take the run, so without
  // one on this device the + would silently start work on another. An agent
  // fixed to another device could never run here, so it gets no "+".
  const navigate = useWorkspaceAwareNavigate();
  const fallbackAgentId = scope?.coordinatorAgentId ?? activeAgentId;
  const fixedDeviceId = useAgentFixedDeviceId(fallbackAgentId);
  const targetDirectory = findDeviceTopicDirectory(directories, ownIds, fixedDeviceId);
  const canAddTopic = !!scope && !!deviceId && !!fallbackAgentId && !!targetDirectory;
  const handleAddTopic = () => {
    if (!scope || !deviceId || !fallbackAgentId || !targetDirectory) return;
    startProjectTopicDraft({
      agentId: fallbackAgentId,
      directoryId: targetDirectory.id,
      navigate,
      projectId: scope.projectId,
    });
  };

  return (
    <AccordionItem value={id}>
      <AccordionHeader>
        <AccordionTrigger style={{ paddingBlock: 4, paddingInline: '8px 4px' }}>
          <Flexbox horizontal align="center" gap={8} height={24} style={{ overflow: 'hidden' }}>
            <Center color={cssVar.colorTextTertiary} flex={'none'} height={18} width={18}>
              {device ? (
                getDeviceIcon(device.platform, 15)
              ) : (
                <Icon icon={MonitorIcon} size={{ size: 15, strokeWidth: 1.5 }} />
              )}
            </Center>
            <Text ellipsis fontSize={14} style={{ flex: categoryKey ? '0 1 auto' : 1 }}>
              {name}
            </Text>
            {categoryKey && (
              <Tag
                size={'small'}
                style={{
                  color: cssVar.colorTextDescription,
                  flex: '0 100 auto',
                  fontSize: 10,
                  minWidth: 48,
                  overflow: 'hidden',
                }}
              >
                <TailMarquee>{tChat(categoryKey)}</TailMarquee>
              </Tag>
            )}
          </Flexbox>
        </AccordionTrigger>
        {canAddTopic && (
          <div
            className={cx(
              'accordion-action',
              accordionStyles.action,
              accordionStyles.actionBorderless,
            )}
          >
            <ActionIcon
              icon={PlusIcon}
              size={'small'}
              title={tProject('sidebar.newConversation')}
              onClick={(e) => {
                e.stopPropagation();
                handleAddTopic();
              }}
            />
          </div>
        )}
      </AccordionHeader>
      <AccordionPanel contentStyle={{ padding: 0 }}>
        <Flexbox gap={1} paddingBlock={1}>
          {children.map((topic) => (
            <TopicItem
              fav={topic.favorite}
              hasGoal={topic.hasGoal}
              id={topic.id}
              key={topic.id}
              metadata={topic.metadata}
              runStartedAt={topic.runStartedAt}
              status={topic.status}
              title={topic.title}
              userId={topic.userId}
            />
          ))}
        </Flexbox>
      </AccordionPanel>
    </AccordionItem>
  );
}, isEqual);

GroupItem.displayName = 'TopicByDeviceGroupItem';

export default GroupItem;
