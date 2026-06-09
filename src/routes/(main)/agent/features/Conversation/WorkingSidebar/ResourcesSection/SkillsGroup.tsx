import { isDesktop } from '@lobechat/const';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { startSkillDrag } from '@/features/ChatInput/InputEditor/ActionTag/skillDragData';
import { SkillSection, SkillsList, useProjectSkills } from '@/features/SkillsList';

interface SkillsGroupProps {
  /** Bound remote device id; when set, skills are scanned over RPC. */
  deviceId?: string;
  workingDirectory: string;
}

const SkillsGroup = memo<SkillsGroupProps>(({ deviceId, workingDirectory }) => {
  const { t } = useTranslation('chat');
  // Local desktop reads over IPC; a bound device reads over RPC. Either path
  // makes the skills list reachable even when this client isn't the desktop.
  const enabled = (isDesktop || !!deviceId) && !!workingDirectory;
  const { isLoading, items, onOpenFile, onOpenSkill } = useProjectSkills(
    enabled ? workingDirectory : undefined,
    deviceId,
  );

  if (!enabled) return null;

  return (
    <SkillSection
      emptyText={t('workingPanel.skills.empty')}
      isEmpty={items.length === 0}
      isLoading={isLoading}
      sectionHeader={{
        collapsible: false,
        count: items.length,
        title: t('workingPanel.skills.title'),
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

SkillsGroup.displayName = 'SkillsGroup';

export default SkillsGroup;
