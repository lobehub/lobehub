import { confirmModal, Icon, toast } from '@lobehub/ui';
import { RotateCcwIcon } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useResourceAccess } from '@/features/ResourcePermission/useResourceAccess';
import { usePermission } from '@/hooks/usePermission';
import type { NativeContextMenuItem } from '@/libs/contextMenu/types';
import { useAgentStore } from '@/store/agent';
import { isForbiddenError } from '@/utils/forbiddenError';

/**
 * "Restore defaults" entry for the default assistant (inbox), shared by its
 * sidebar row menu and the Agent profile header menu. The inbox cannot be
 * deleted and recreated like other agents, so this is its only way back to a
 * clean name, avatar, prompt and model. The caller passes the inbox agent's
 * id; any other agent is refused by the server.
 *
 * Offered only to who may manage the row: the reset wipes what every member of
 * a workspace sees, so it follows the delete gate rather than the edit one.
 * Personal mode always qualifies. The label stays a plain string so the
 * sidebar menu remains eligible for the native desktop context menu.
 */
export const useRestoreInboxDefaultMenuItem = (
  agentId: string | null | undefined,
): NativeContextMenuItem | null => {
  const { t } = useTranslation(['chat', 'common']);
  const resetInboxAgent = useAgentStore((s) => s.resetInboxAgent);
  const { allowed: canEdit } = usePermission('edit_own_content');
  const { canManageResource } = useResourceAccess('agent', agentId ?? undefined);

  return useMemo(() => {
    if (!agentId || !canEdit || !canManageResource) return null;

    return {
      icon: <Icon icon={RotateCcwIcon} />,
      key: 'restoreDefault',
      label: t('agent.restoreDefault'),
      onClick: (info?: { domEvent?: { stopPropagation: () => void } }) => {
        info?.domEvent?.stopPropagation();
        confirmModal({
          cancelText: t('cancel', { ns: 'common' }),
          content: t('agent.restoreDefault.confirm.content'),
          okButtonProps: { danger: true },
          okText: t('agent.restoreDefault.confirm.ok'),
          onOk: async () => {
            try {
              await resetInboxAgent(agentId);
              toast.success(t('agent.restoreDefault.success'));
            } catch (error) {
              console.error('Failed to restore the default agent:', error);
              toast.error(
                t(isForbiddenError(error) ? 'manageOnlyCreator' : 'operationFailed', {
                  ns: 'common',
                }),
              );
            }
          },
          title: t('agent.restoreDefault.confirm.title'),
        });
      },
      sfSymbol: 'arrow.counterclockwise',
    };
  }, [agentId, canEdit, canManageResource, resetInboxAgent, t]);
};
