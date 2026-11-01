import { isDesktop } from '@lobechat/const';
import type React from 'react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { startSkillDrag } from '@/features/ChatInput/InputEditor/ActionTag/skillDragData';
import {
  filterSkillItems,
  type SkillListItem,
  SkillSection,
  SkillsList,
  SkillsSearchBar,
  useProjectSkills,
} from '@/features/SkillsList';

// Filesystem skills are resolved by the underlying runtime registry, so
// we serialize them as a literal `/skill-name` (projectSkill chip).
const handleSkillDragStart = (item: SkillListItem, event: React.DragEvent) => {
  startSkillDrag(event, {
    category: 'projectSkill',
    label: item.name,
    type: item.name,
  });
};

interface SkillsGroupProps {
  /** Bound remote device id; when set, skills are scanned over RPC. */
  deviceId?: string;
  workingDirectory: string;
}

const SkillsGroup = memo<SkillsGroupProps>(({ deviceId, workingDirectory }) => {
  const { t } = useTranslation('chat');
  const [searchQuery, setSearchQuery] = useState('');
  // Local desktop reads over IPC; a bound device reads over RPC. Either path
  // makes the skills list reachable even when this client isn't the desktop.
  const enabled = (isDesktop || !!deviceId) && !!workingDirectory;
  const {
    deviceItems,
    error,
    getRowActions,
    isLoading,
    mutate,
    onOpenFile,
    onOpenSkill,
    projectItems,
  } = useProjectSkills(enabled ? workingDirectory : undefined, deviceId);

  if (!enabled) return null;

  const renderList = (items: typeof projectItems) => (
    <SkillsList
      getRowActions={getRowActions}
      items={items}
      onOpenFile={onOpenFile}
      onOpenSkill={onOpenSkill}
      onSkillDragStart={handleSkillDragStart}
    />
  );

  const hasProject = projectItems.length > 0;
  const hasDevice = deviceItems.length > 0;

  if (hasProject || hasDevice) {
    const matchedProjectItems = filterSkillItems(projectItems, searchQuery);
    const matchedDeviceItems = filterSkillItems(deviceItems, searchQuery);
    const hasMatchedProject = matchedProjectItems.length > 0;
    const hasMatchedDevice = matchedDeviceItems.length > 0;

    return (
      <>
        <SkillsSearchBar onSearch={setSearchQuery} />
        {!hasMatchedProject && !hasMatchedDevice && (
          <SkillSection isEmpty emptyText={t('workingPanel.skills.noSearchResults')} />
        )}
        {hasMatchedProject && (
          <SkillSection
            sectionHeader={{
              collapsible: false,
              count: matchedProjectItems.length,
              title: t('workingPanel.skills.section.project'),
            }}
          >
            {renderList(matchedProjectItems)}
          </SkillSection>
        )}
        {hasMatchedDevice && (
          <SkillSection
            sectionHeader={{
              collapsible: false,
              count: matchedDeviceItems.length,
              title: t('workingPanel.skills.section.device'),
            }}
          >
            {renderList(matchedDeviceItems)}
          </SkillSection>
        )}
      </>
    );
  }

  return (
    <SkillSection
      isEmpty
      emptyText={t('workingPanel.skills.empty')}
      error={error}
      isLoading={isLoading}
      sectionHeader={{
        collapsible: false,
        title: t('workingPanel.skills.title'),
      }}
      onRetry={mutate}
    />
  );
});

SkillsGroup.displayName = 'SkillsGroup';

export default SkillsGroup;
