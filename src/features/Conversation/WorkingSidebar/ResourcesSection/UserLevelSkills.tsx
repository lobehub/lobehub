import { confirmModal, createModal, toast } from '@lobehub/ui/base-ui';
import isEqual from 'fast-deep-equal';
import { t as translate } from 'i18next';
import { EyeIcon, PencilIcon, Trash2Icon } from 'lucide-react';
import type React from 'react';
import { lazy, memo, Suspense, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { startSkillDrag } from '@/features/ChatInput/InputEditor/ActionTag/skillDragData';
import {
  openRenameSkillModal,
  type SkillListItem,
  type SkillRowAction,
  SkillSection,
  SkillsList,
} from '@/features/SkillsList';
import { usePermission } from '@/hooks/usePermission';
import { useToolStore } from '@/store/tool';
import { agentSkillsSelectors } from '@/store/tool/selectors';

const AgentSkillDetail = lazy(() => import('@/features/AgentSkillDetail'));

const EMPTY_ITEMS: SkillListItem[] = [];

const handleSkillDragStart = (item: SkillListItem, event: React.DragEvent) => {
  startSkillDrag(event, {
    category: 'skill',
    label: item.name,
    type: item.id,
  });
};

const openSkillDetailModal = (skillId: string) =>
  createModal({
    content: (
      <Suspense fallback={<div style={{ height: '100%' }} />}>
        <AgentSkillDetail skillId={skillId} />
      </Suspense>
    ),
    footer: null,
    styles: { content: { height: 'calc(100dvh - 200px)', overflow: 'hidden', padding: 0 } },
    title: translate('workingPanel.skills.detail.title', { ns: 'chat' }),
    width: 960,
  });

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
export const useUserSkills = (enabled = true): SkillListItem[] => {
  useToolStore((s) => s.useFetchAgentSkills)(enabled);
  const agentSkills = useToolStore(agentSkillsSelectors.getAgentSkills, isEqual);

  return useMemo(
    () =>
      !enabled
        ? EMPTY_ITEMS
        : agentSkills.map((skill) => ({
            description: skill.description ?? undefined,
            // `identifier` is what the runtime resolves through the skill registry,
            // and is unique per skill — reuse it as both the React key and the
            // drag payload's `type`.
            id: skill.identifier,
            name: skill.name,
          })),
    [agentSkills, enabled],
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
  const { t: tCommon } = useTranslation('common');

  const items = useUserSkills();
  // The row shape keys off `identifier`, but the store mutations key off the DB
  // id — resolve one from the other through the raw skill list.
  const agentSkills = useToolStore(agentSkillsSelectors.getAgentSkills, isEqual);
  const updateAgentSkill = useToolStore((s) => s.updateAgentSkill);
  const deleteAgentSkill = useToolStore((s) => s.deleteAgentSkill);
  const { allowed: canEdit } = usePermission('edit_own_content');

  const getRowActions = useCallback(
    (item: SkillListItem): SkillRowAction[] => {
      const skill = agentSkills.find((s) => s.identifier === item.id);
      if (!skill) return [];

      const actions: SkillRowAction[] = [
        {
          icon: EyeIcon,
          key: 'view',
          label: t('workingPanel.skills.actions.view'),
          onClick: () => openSkillDetailModal(skill.id),
          sfSymbol: 'eye',
        },
      ];

      // Only user-authored skills carry an editable name; market imports are
      // pinned to their source manifest.
      if (skill.source === 'user') {
        actions.push({
          disabled: !canEdit,
          icon: PencilIcon,
          key: 'rename',
          label: t('workingPanel.skills.actions.rename'),
          onClick: () => {
            openRenameSkillModal({
              currentName: skill.name,
              onSubmit: async (newName) => {
                try {
                  await updateAgentSkill({ id: skill.id, name: newName });
                  return undefined;
                } catch (error) {
                  return error instanceof Error
                    ? error.message
                    : t('workingPanel.skills.rename.error');
                }
              },
            });
          },
          sfSymbol: 'pencil',
        });
      }

      actions.push({
        danger: true,
        disabled: !canEdit,
        icon: Trash2Icon,
        key: 'delete',
        label: t('workingPanel.skills.actions.delete'),
        onClick: () => {
          confirmModal({
            cancelText: tCommon('cancel'),
            content: t('workingPanel.skills.delete.userConfirm', { name: skill.name }),
            okButtonProps: { danger: true },
            okText: tCommon('delete'),
            onOk: async () => {
              try {
                await deleteAgentSkill(skill.id);
                toast.success(t('workingPanel.skills.delete.success'));
              } catch (error) {
                toast.error(
                  error instanceof Error ? error.message : t('workingPanel.skills.delete.error'),
                );
              }
            },
            title: t('workingPanel.skills.delete.title'),
          });
        },
        sfSymbol: 'trash',
      });

      return actions;
    },
    [agentSkills, canEdit, deleteAgentSkill, t, tCommon, updateAgentSkill],
  );

  const onOpenSkill = useCallback(
    (item: SkillListItem) => {
      const skill = agentSkills.find((s) => s.identifier === item.id);
      if (skill) openSkillDetailModal(skill.id);
    },
    [agentSkills],
  );

  if (items.length === 0) return null;

  const list = (
    <SkillsList
      getRowActions={getRowActions}
      items={items}
      onOpenSkill={onOpenSkill}
      onSkillDragStart={handleSkillDragStart}
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
