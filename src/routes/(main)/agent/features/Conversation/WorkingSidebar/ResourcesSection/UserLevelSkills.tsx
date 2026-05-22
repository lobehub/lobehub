import isEqual from 'fast-deep-equal';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { startSkillDrag } from '@/features/ChatInput/InputEditor/ActionTag/skillDragData';
import { type SkillListItem, SkillSection, SkillsList } from '@/features/SkillsList';
import { useToolStore } from '@/store/tool';
import { agentSkillsSelectors } from '@/store/tool/selectors';

/**
 * Reads user-installed skills (entries in the `agent_skill` table — market
 * imports plus user-created customs) into the `SkillsList` row shape. Builtin
 * tools and LobeHub MCP servers are intentionally excluded — those belong in
 * the Tools popover, not in the per-user skill inventory.
 *
 * Also triggers the underlying SWR fetch so the working sidebar surfaces the
 * data even when the Tools popover hasn't been opened in this session. The key
 * is deduplicated, so co-mounting with `useControls` doesn't double-fetch.
 */
export const useUserSkills = (): SkillListItem[] => {
  useToolStore((s) => s.useFetchAgentSkills)(true);
  const agentSkills = useToolStore(agentSkillsSelectors.getAgentSkills, isEqual);

  return useMemo(
    () =>
      agentSkills.map((skill) => ({
        description: skill.description ?? undefined,
        // `identifier` is what the runtime resolves through the skill registry,
        // and is unique per skill — reuse it as both the React key and the
        // drag payload's `type`.
        id: skill.identifier,
        name: skill.name,
      })),
    [agentSkills],
  );
};

interface UserLevelSkillsProps {
  /**
   * Skip the `SkillSection` wrapper (no header row). Set when the parent has
   * collapsed to a single visible source and wants the list rendered flat,
   * matching the agent-only layout this used to ship with.
   */
  hideHeader?: boolean;
}

const UserLevelSkills = memo<UserLevelSkillsProps>(({ hideHeader }) => {
  const { t } = useTranslation('chat');
  const items = useUserSkills();

  if (items.length === 0) return null;

  const list = (
    <SkillsList
      items={items}
      onSkillDragStart={(item, event) => {
        startSkillDrag(event, {
          category: 'skill',
          label: item.name,
          type: item.id,
        });
      }}
    />
  );

  if (hideHeader) return list;

  return (
    <SkillSection
      sectionHeader={{
        count: items.length,
        title: t('workingPanel.skills.section.user'),
      }}
    >
      {list}
    </SkillSection>
  );
});

UserLevelSkills.displayName = 'UserLevelSkills';

export default UserLevelSkills;
