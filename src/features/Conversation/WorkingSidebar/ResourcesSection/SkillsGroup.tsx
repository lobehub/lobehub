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
      onSkillDragStart={(item, event) => {
        // Filesystem skills are resolved by the underlying runtime registry, so
        // we serialize them as a literal `/skill-name` (projectSkill chip).
        startSkillDrag(event, {
          category: 'projectSkill',
          label: item.name,
          type: item.name,
        });
      }}
    />
  );

  const hasProject = projectItems.length > 0;
  const hasDevice = deviceItems.length > 0;

  if (hasProject || hasDevice) {
    return (
      <>
        {hasProject && (
          <SkillSection
            sectionHeader={{
              collapsible: false,
              count: projectItems.length,
              title: t('workingPanel.skills.section.project'),
            }}
          >
            {renderList(projectItems)}
          </SkillSection>
        )}
        {hasDevice && (
          <SkillSection
            sectionHeader={{
              collapsible: false,
              count: deviceItems.length,
              title: t('workingPanel.skills.section.device'),
            }}
          >
            {renderList(deviceItems)}
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
