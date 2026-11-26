import { AccordionRoot, cssVar, Flexbox, Icon } from '@lobehub/ui';
import isEqual from 'fast-deep-equal';
import { FolderClosedIcon, FolderXIcon } from 'lucide-react';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import ProjectAvatar from '@/features/Projects/ProjectAvatar';
import { canStageDraftOn } from '@/features/Projects/WorkingDirectories/startProjectTopicDraft';
import { useAgentFixedDeviceId } from '@/features/Projects/WorkingDirectories/useAgentFixedDeviceId';
import { useProjectDirectories } from '@/store/projectWorkingDirectory';
import { type ChatTopic } from '@/types/topic';

import TopicSubGroupItem, { renderSubGroupTopic, useSubGroupExpansion } from '../TopicSubGroupItem';
import { useStartTopicInDirectory } from '../useStartTopicInDirectory';
import {
  directorySectionTag,
  directorySectionTitle,
  groupTopicsByDirectory,
  NO_DIRECTORY_SECTION_ID,
} from './directorySections';

interface DirectoryTopicListProps {
  topics: ChatTopic[];
}

/**
 * The second level of an agent's by-device grouping: one device's topics,
 * sectioned by the directory they work in.
 */
const DirectoryTopicList = memo<DirectoryTopicListProps>(({ topics }) => {
  const { t } = useTranslation('topic');
  const directories = useProjectDirectories();
  const sections = useMemo(() => groupTopicsByDirectory(topics), [topics]);
  const { expandedIds, onExpandedChange } = useSubGroupExpansion(sections);

  // A project directory section starts a topic in place, where the agent can
  // run there — an agent fixed to another device never could.
  const { agentId, startInDirectory } = useStartTopicInDirectory();
  const fixedDeviceId = useAgentFixedDeviceId(agentId);

  if (!sections) {
    return (
      <Flexbox gap={1} paddingBlock={1}>
        {topics.map((topic) => renderSubGroupTopic(topic))}
      </Flexbox>
    );
  }

  const labels = {
    noDirectory: t('groupTitle.byProject.noProject'),
    unknownDirectory: t('groupTitle.byDevice.unknownDirectory'),
  };
  const titles = sections.map((section) => directorySectionTitle(section, directories, labels));

  return (
    <AccordionRoot
      indicatorPlacement="inline"
      style={{ gap: 1, paddingBlock: 1 }}
      value={expandedIds}
      onValueChange={onExpandedChange}
    >
      {sections.map((section, index) => {
        const directory = section.directoryId
          ? directories.find((item) => item.id === section.directoryId)
          : undefined;
        const startable = !!agentId && !!directory && canStageDraftOn(directory, fixedDeviceId);
        const duplicated = titles.filter((title) => title === titles[index]).length > 1;

        return (
          <TopicSubGroupItem
            expanded={!!expandedIds?.includes(section.id)}
            group={section}
            key={section.id}
            startDirectoryId={startable ? directory.id : undefined}
            tag={duplicated ? directorySectionTag(section, directories) : undefined}
            title={titles[index]}
            icon={
              directory ? (
                <ProjectAvatar
                  avatar={directory.projectAvatar}
                  id={directory.projectId}
                  name={directory.projectName}
                  size={14}
                />
              ) : (
                <Icon
                  color={cssVar.colorTextTertiary}
                  icon={section.id === NO_DIRECTORY_SECTION_ID ? FolderXIcon : FolderClosedIcon}
                  size={{ size: 12 }}
                />
              )
            }
            onStartInDirectory={startInDirectory}
          />
        );
      })}
    </AccordionRoot>
  );
}, isEqual);

DirectoryTopicList.displayName = 'DeviceDirectoryTopicList';

export default DirectoryTopicList;
