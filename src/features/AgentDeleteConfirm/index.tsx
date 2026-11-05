import { confirmModal, Skeleton } from '@lobehub/ui';
import { t } from 'i18next';
import { Suspense, use } from 'react';

import { agentService, type RemoveAgentOptions } from '@/services/agent';

interface ConfirmRemoveAgentOptions {
  agentId: string;
  /**
   * Runs the delete. Pass the options on to `removeAgent`: they carry the
   * acknowledgment that lets an author delete an agent holding teammates'
   * content, set only when the dialog actually warned about it.
   */
  onConfirm: (options: RemoveAgentOptions) => Promise<void> | void;
}

type AgentDeleteImpact = Awaited<ReturnType<typeof agentService.getAgentDeleteImpact>>;

/**
 * Pick the confirmation copy for an agent delete. The cascade trashes every
 * topic under the agent, teammates' included, so the dialog must say so when
 * they exist — with a count when other members started topics, or the generic
 * "includes other members' content" line when only comments or messages are
 * foreign.
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

const RemoveAgentAlert = ({ impact }: { impact: Promise<AgentDeleteImpact | null> }) => (
  <>{getRemoveAgentAlert(use(impact))}</>
);

/**
 * Open the shared agent deletion confirmation. Every delete entry point (the
 * sidebar, the mobile list, the agent profile) goes through here so authors
 * and workspace owners read the same warning about other members' topics.
 *
 * The dialog opens right away, bound to `agentId`, and fills in its copy once
 * the impact lookup lands — its mask keeps the user on the agent they started
 * from instead of a late dialog surfacing over another one. Confirming before
 * the lookup lands, or after it failed, does not acknowledge foreign content,
 * so the server keeps refusing an author's delete that would take teammates'
 * topics down unannounced.
 */
export const confirmRemoveAgent = ({ agentId, onConfirm }: ConfirmRemoveAgentOptions): void => {
  let impact: AgentDeleteImpact | null = null;
  const impactRequest = agentService.getAgentDeleteImpact(agentId).then(
    (value) => {
      impact = value;
      return value;
    },
    (error) => {
      console.error('[confirmRemoveAgent]', error);
      return null;
    },
  );

  confirmModal({
    cancelText: t('cancel', { ns: 'common' }),
    content: (
      <Suspense fallback={<Skeleton.Text rows={2} />}>
        <RemoveAgentAlert impact={impactRequest} />
      </Suspense>
    ),
    okButtonProps: { danger: true },
    okText: t('delete', { ns: 'common' }),
    onOk: async () => {
      await onConfirm({ acknowledgeForeignContent: !!impact?.hasForeignContent });
    },
    title: t('delete', { ns: 'common' }),
  });
};
