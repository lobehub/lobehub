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
    const { error, getRowActions, items, mutate, onOpenFile, onOpenSkill } = useProjectSkills(
      workingDirectory,
      deviceId,
    );

    // A failed scan must surface an error + Retry, not silently vanish (ux Read
    // §1.1). Only genuinely-empty (no error) keeps the "hide the section" behavior.
    if (items.length === 0) {
      if (!error) return null;
      if (hideHeader) return <SkillSection isEmpty error={error} onRetry={mutate} />;
      return (
        <SkillSection
          isEmpty
          error={error}
          sectionHeader={{ title: t('workingPanel.skills.section.project') }}
          onRetry={mutate}
        />
      );
    }

    const list = (
      <SkillsList
        getRowActions={getRowActions}
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
