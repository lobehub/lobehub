import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { startSkillDrag } from '@/features/ChatInput/InputEditor/ActionTag/skillDragData';
import { SkillSection, SkillsList, useProjectSkills } from '@/features/SkillsList';

interface DeviceLevelSkillsProps {
  /** Bound remote device id; when set, skills are scanned over RPC. */
  deviceId?: string;
  /**
   * Skip the `SkillSection` wrapper (no header row). Set when the parent has
   * collapsed to a single visible source and wants the list rendered flat.
   */
  hideHeader?: boolean;
  workingDirectory: string;
}

const DeviceLevelSkills = memo<DeviceLevelSkillsProps>(
  ({ deviceId, hideHeader, workingDirectory }) => {
    const { t } = useTranslation('chat');
    const { deviceItems, error, getRowActions, mutate, onOpenFile, onOpenSkill } = useProjectSkills(
      workingDirectory,
      deviceId,
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

    const list = (
      <SkillsList
        getRowActions={getRowActions}
        items={deviceItems}
        onOpenFile={onOpenFile}
        onOpenSkill={onOpenSkill}
        onSkillDragStart={(item, event) => {
          startSkillDrag(event, {
            category: 'projectSkill',
            label: item.name,
            type: item.name,
          });
        }}
      />
    );

    if (hideHeader) return list;

    return (
      <SkillSection
        sectionHeader={{
          count: deviceItems.length,
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
