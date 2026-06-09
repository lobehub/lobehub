import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { startSkillDrag } from '@/features/ChatInput/InputEditor/ActionTag/skillDragData';
import { SkillSection, SkillsList, useProjectSkills } from '@/features/SkillsList';

interface ProjectLevelSkillsProps {
  /** Bound remote device id; when set, skills are scanned over RPC. */
  deviceId?: string;
  /**
   * Skip the `SkillSection` wrapper (no header row). Set when the parent has
   * collapsed to a single visible source and wants the list rendered flat.
   */
  hideHeader?: boolean;
  workingDirectory: string;
}

const ProjectLevelSkills = memo<ProjectLevelSkillsProps>(
  ({ deviceId, hideHeader, workingDirectory }) => {
    const { t } = useTranslation('chat');
    const { items, onOpenFile, onOpenSkill } = useProjectSkills(workingDirectory, deviceId);

    if (items.length === 0) return null;

    const list = (
      <SkillsList
        items={items}
        onOpenFile={onOpenFile}
        onOpenSkill={onOpenSkill}
        onSkillDragStart={(item, event) => {
          // Project skills are resolved by the underlying CLI agent itself, so
          // we serialize them as a literal `/skill-name` (projectSkill chip).
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
          count: items.length,
          title: t('workingPanel.skills.section.project'),
        }}
      >
        {list}
      </SkillSection>
    );
  },
);

ProjectLevelSkills.displayName = 'ProjectLevelSkills';

export default ProjectLevelSkills;
