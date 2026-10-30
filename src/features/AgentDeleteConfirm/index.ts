import { confirmModal } from '@lobehub/ui';
import { t } from 'i18next';

import { agentService } from '@/services/agent';

interface ConfirmRemoveAgentOptions {
  agentId: string;
  onConfirm: () => Promise<void> | void;
}

type AgentDeleteImpact = Awaited<ReturnType<typeof agentService.getAgentDeleteImpact>>;

/**
 * Pick the confirmation copy for an agent delete. The cascade trashes every
 * topic under the agent, teammates' included, so the dialog must say so when
 * they exist — with a count when other members started topics, or the generic
 * "includes other members' content" line when only comments, messages or
 * tasks are foreign.
 */
export const getRemoveAgentAlert = (impact: AgentDeleteImpact | null): string => {
  if (impact && impact.foreignTopicCount > 0)
    return t('confirmRemoveSessionItemAlertWithOthersCount', {
      count: impact.foreignTopicCount,
      ns: 'chat',
    });
  if (impact?.hasForeignContent)
    return t('confirmRemoveSessionItemAlertWithOthers', { ns: 'chat' });
  return t('confirmRemoveSessionItemAlert', { ns: 'chat' });
};

/**
 * Open the shared agent deletion confirmation. Every delete entry point (the
 * sidebar, the mobile list, the agent profile) goes through here so authors
 * and workspace owners read the same warning about other members' topics.
 * A failed impact lookup falls back to the plain copy; the delete itself is
 * still authorized server-side.
 */
export const confirmRemoveAgent = async ({
  agentId,
  onConfirm,
}: ConfirmRemoveAgentOptions): Promise<void> => {
  let impact: AgentDeleteImpact | null = null;
  try {
    impact = await agentService.getAgentDeleteImpact(agentId);
  } catch (error) {
    console.error('[confirmRemoveAgent]', error);
  }

  confirmModal({
    cancelText: t('cancel', { ns: 'common' }),
    content: getRemoveAgentAlert(impact),
    okButtonProps: { danger: true },
    okText: t('delete', { ns: 'common' }),
    onOk: async () => {
      await onConfirm();
    },
    title: t('delete', { ns: 'common' }),
  });
};
