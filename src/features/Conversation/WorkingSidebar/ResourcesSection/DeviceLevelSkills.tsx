import type React from 'react';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { startSkillDrag } from '@/features/ChatInput/InputEditor/ActionTag/skillDragData';
import {
  filterSkillItems,
  type SkillListItem,
  SkillSection,
  SkillsList,
  useProjectSkills,
} from '@/features/SkillsList';

const handleSkillDragStart = (item: SkillListItem, event: React.DragEvent) => {
  startSkillDrag(event, {
    category: 'projectSkill',
    label: item.name,
    type: item.name,
  });
};

interface DeviceLevelSkillsProps {
  /** Bound remote device id; when set, skills are scanned over RPC. */
  deviceId?: string;
  /**
   * Skip the `SkillSection` wrapper (no header row). Set when the parent has
   * collapsed to a single visible source and wants the list rendered flat.
   */
  hideHeader?: boolean;
  /** Only render skills matching this query. */
  searchQuery?: string;
  workingDirectory: string;
}

const DeviceLevelSkills = memo<DeviceLevelSkillsProps>(
  ({ deviceId, hideHeader, searchQuery = '', workingDirectory }) => {
    const { t } = useTranslation('chat');
    const { deviceItems, error, getRowActions, mutate, onOpenFile, onOpenSkill } = useProjectSkills(
      workingDirectory,
      deviceId,
    );

    const items = useMemo(
      () => filterSkillItems(deviceItems, searchQuery),
      [deviceItems, searchQuery],
    );

    if (deviceItems.length === 0) {
      if (!error) return null;
      if (hideHeader) return <SkillSection isEmpty error={error} onRetry={mutate} />;
      return (
        <SkillSection
          isEmpty
          error={error}
          sectionHeader={{ title: t('workingPanel.skills.section.device') }}
          onRetry={mutate}
        />
      );
    }

    if (items.length === 0) return null;

    const list = (
      <SkillsList
        getRowActions={getRowActions}
        items={items}
        onOpenFile={onOpenFile}
        onOpenSkill={onOpenSkill}
        onSkillDragStart={handleSkillDragStart}
      />
    );

    if (hideHeader) return list;

    return (
      <SkillSection
        sectionHeader={{
          count: items.length,
          title: t('workingPanel.skills.section.device'),
        }}
      >
        {list}
      </SkillSection>
    );
  },
);

DeviceLevelSkills.displayName = 'DeviceLevelSkills';

export default DeviceLevelSkills;
