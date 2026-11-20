import { getLibrarySkillMode } from '@lobechat/types';
import { ActionIcon } from '@lobehub/ui';
import isEqual from 'fast-deep-equal';
import { SettingsIcon } from 'lucide-react';
import type React from 'react';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { startSkillDrag } from '@/features/ChatInput/InputEditor/ActionTag/skillDragData';
import {
  filterSkillItems,
  type SkillListItem,
  SkillSection,
  SkillsList,
} from '@/features/SkillsList';
import { useAgentStore } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';
import { useToolStore } from '@/store/tool';
import { agentSkillsSelectors } from '@/store/tool/selectors';

import { useSelectSkill } from './useSelectSkill';

const EMPTY_ITEMS: SkillListItem[] = [];

const handleSkillDragStart = (item: SkillListItem, event: React.DragEvent) => {
  startSkillDrag(event, {
    category: 'skill',
    label: item.name,
    type: item.id,
  });
};

/**
 * Reads user-installed skills (entries in the `agent_skill` table — market
 * imports plus user-created customs) enabled for the current agent into the
 * `SkillsList` row shape. Builtin tools and LobeHub MCP servers are intentionally
 * excluded — those belong in the Tools popover, not in the per-user skill inventory.
 *
 * Also triggers the underlying SWR fetch so the working sidebar surfaces the
 * data even when the Tools popover hasn't been opened in this session. The key
 * is deduplicated, so co-mounting with `useControls` doesn't double-fetch.
 */
export const useUserSkills = (enabled = true, includeDisabled = false): SkillListItem[] => {
  useToolStore((s) => s.useFetchAgentSkills)(enabled);
  const agentSkills = useToolStore(agentSkillsSelectors.getAgentSkills, isEqual);
  const plugins = useAgentStore((s) => agentSelectors.currentAgentConfig(s)?.plugins);

  return useMemo(
    () =>
      !enabled
        ? EMPTY_ITEMS
        : agentSkills
            .filter(
              (skill) =>
                includeDisabled || getLibrarySkillMode(plugins, skill.identifier) !== 'disabled',
            )
            .map((skill) => ({
              description: skill.description ?? undefined,
              // `identifier` is what the runtime resolves through the skill registry,
              // and is unique per skill — reuse it as both the React key and the
              // drag payload's `type`.
              id: skill.identifier,
              name: skill.name,
            })),
    [agentSkills, enabled, includeDisabled, plugins],
  );
};

interface UserLevelSkillsProps {
  /**
   * Skip the `SkillSection` wrapper (no header row). Set when the parent has
   * collapsed to a single visible source and wants the list rendered flat,
   * matching the agent-only layout this used to ship with.
   */
  hideHeader?: boolean;
  onManage?: () => void;
  /** Only render skills matching this query. */
  searchQuery?: string;
}

const UserLevelSkills = memo<UserLevelSkillsProps>(({ hideHeader, onManage, searchQuery = '' }) => {
  const { t } = useTranslation('chat');
  const onSelectSkill = useSelectSkill('skill');

  const userItems = useUserSkills();
  const items = useMemo(() => filterSkillItems(userItems, searchQuery), [userItems, searchQuery]);
  if (items.length === 0 && !onManage) return null;

  const list = (
    <SkillsList
      compact
      items={items}
      onSelectSkill={onSelectSkill}
      onSkillDragStart={handleSkillDragStart}
    />
  );

  if (hideHeader && !onManage) return list;

  return (
    <SkillSection
      compact
      isEmpty={items.length === 0}
      emptyText={t(
        searchQuery
          ? 'workingPanel.skills.noSearchResults'
          : 'workingPanel.skills.manage.noneEnabled',
      )}
      sectionHeader={{
        action: onManage && (
          <ActionIcon
            aria-label={t('workingPanel.skills.manage.title')}
            icon={SettingsIcon}
            size="small"
            title={t('workingPanel.skills.manage.title')}
            onClick={onManage}
          />
        ),
        count: onManage ? userItems.length : items.length,
        title: t('workingPanel.skills.section.user'),
      }}
    >
      {list}
    </SkillSection>
  );
});

UserLevelSkills.displayName = 'UserLevelSkills';

export default UserLevelSkills;
