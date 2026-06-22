import { Modal } from '@lobehub/ui';
import { confirmModal } from '@lobehub/ui/base-ui';
import { App } from 'antd';
import isEqual from 'fast-deep-equal';
import { EyeIcon, PencilIcon, Trash2Icon } from 'lucide-react';
import { lazy, memo, Suspense, useMemo, useState } from 'react';
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
  const { t: tCommon } = useTranslation('common');
  const { message } = App.useApp();
  const items = useUserSkills();
  // The row shape keys off `identifier`, but the store mutations key off the DB
  // id — resolve one from the other through the raw skill list.
  const agentSkills = useToolStore(agentSkillsSelectors.getAgentSkills, isEqual);
  const updateAgentSkill = useToolStore((s) => s.updateAgentSkill);
  const deleteAgentSkill = useToolStore((s) => s.deleteAgentSkill);
  const { allowed: canEdit } = usePermission('edit_own_content');
  const [detailSkillId, setDetailSkillId] = useState<string>();

  const getRowActions = (item: SkillListItem): SkillRowAction[] => {
    const skill = agentSkills.find((s) => s.identifier === item.id);
    if (!skill) return [];

    const actions: SkillRowAction[] = [
      {
        icon: EyeIcon,
        key: 'view',
        label: t('workingPanel.skills.actions.view'),
        onClick: () => setDetailSkillId(skill.id),
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
              message.success(t('workingPanel.skills.delete.success'));
            } catch (error) {
              message.error(
                error instanceof Error ? error.message : t('workingPanel.skills.delete.error'),
              );
            }
          },
          title: t('workingPanel.skills.delete.title'),
        });
      },
    });

    return actions;
  };

  if (items.length === 0) return null;

  const list = (
    <SkillsList
      getRowActions={getRowActions}
      items={items}
      onOpenSkill={(item) => {
        const skill = agentSkills.find((s) => s.identifier === item.id);
        if (skill) setDetailSkillId(skill.id);
      }}
      onSkillDragStart={(item, event) => {
        startSkillDrag(event, {
          category: 'skill',
          label: item.name,
          type: item.id,
        });
      }}
    />
  );

  const detailModal = (
    <Modal
      destroyOnHidden
      footer={null}
      open={!!detailSkillId}
      styles={{ body: { height: 'calc(100dvh - 200px)', overflow: 'hidden', padding: 0 } }}
      title={t('workingPanel.skills.detail.title')}
      width={960}
      onCancel={() => setDetailSkillId(undefined)}
    >
      <Suspense fallback={<div style={{ height: '100%' }} />}>
        {detailSkillId && <AgentSkillDetail skillId={detailSkillId} />}
      </Suspense>
    </Modal>
  );

  if (hideHeader)
    return (
      <>
        {list}
        {detailModal}
      </>
    );

  return (
    <>
      <SkillSection
        sectionHeader={{
          count: items.length,
          title: t('workingPanel.skills.section.user'),
        }}
      >
        {list}
      </SkillSection>
      {detailModal}
    </>
  );
});

UserLevelSkills.displayName = 'UserLevelSkills';

export default UserLevelSkills;
