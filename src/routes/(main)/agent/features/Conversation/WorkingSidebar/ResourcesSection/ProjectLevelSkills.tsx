import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { startSkillDrag } from '@/features/ChatInput/InputEditor/ActionTag/skillDragData';
import { SkillSection, SkillsList, useProjectSkills } from '@/features/SkillsList';

interface ProjectLevelSkillsProps {
  workingDirectory: string;
}

const ProjectLevelSkills = memo<ProjectLevelSkillsProps>(({ workingDirectory }) => {
  const { t } = useTranslation('chat');
  const { isLoading, items, onOpenFile, onOpenSkill } = useProjectSkills(workingDirectory);

  return (
    <SkillSection
      emptyText={t('workingPanel.skills.empty')}
      isEmpty={items.length === 0}
      isLoading={isLoading}
      sectionHeader={{
        count: items.length,
        title: t('workingPanel.skills.section.project'),
      }}
    >
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
    </SkillSection>
  );
});

ProjectLevelSkills.displayName = 'ProjectLevelSkills';

export default ProjectLevelSkills;
