import { Button, createModal, ModalFooter, Skeleton, useModalContext } from '@lobehub/ui';
import { t } from 'i18next';
import { type ReactNode, Suspense, use, useState } from 'react';

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

/**
 * The dialog's state for an impact lookup: `undefined` while it is in flight,
 * `null` once it failed. Delete stays disabled until the lookup settles, so no
 * one — workspace owners included — can confirm before reading the warning.
 * A failed lookup falls back to the plain copy and acknowledges nothing, which
 * keeps the server guard on for non-owners while an older server without the
 * lookup can still delete.
 */
export const getRemoveAgentConfirmState = (impact: AgentDeleteImpact | null | undefined) => {
  if (impact === undefined)
    return { acknowledgeForeignContent: false, alert: null, canConfirm: false } as const;
  return {
    acknowledgeForeignContent: !!impact?.hasForeignContent,
    alert: getRemoveAgentAlert(impact),
    canConfirm: true,
  } as const;
};

interface ConfirmLayoutProps {
  content: ReactNode;
  onConfirm?: () => Promise<void> | void;
}

const ConfirmLayout = ({ content, onConfirm }: ConfirmLayoutProps) => {
  const { close } = useModalContext();
  const [deleting, setDeleting] = useState(false);

  const handleConfirm = async () => {
    if (!onConfirm) return;
    setDeleting(true);
    try {
      await onConfirm();
    } catch {
      setDeleting(false);
      return;
    }
    close();
  };

  return (
    <>
      <div style={{ padding: '12px 16px' }}>{content}</div>
      <ModalFooter>
        <Button onClick={close}>{t('cancel', { ns: 'common' })}</Button>
        <Button
          danger
          disabled={!onConfirm}
          loading={deleting}
          type={'primary'}
          onClick={handleConfirm}
        >
          {t('delete', { ns: 'common' })}
        </Button>
      </ModalFooter>
    </>
  );
};

interface LoadedConfirmProps {
  impact: Promise<AgentDeleteImpact | null>;
  onConfirm: ConfirmRemoveAgentOptions['onConfirm'];
}

const LoadedConfirm = ({ impact, onConfirm }: LoadedConfirmProps) => {
  const state = getRemoveAgentConfirmState(use(impact));

  return (
    <ConfirmLayout
      content={state.alert}
      onConfirm={() => onConfirm({ acknowledgeForeignContent: state.acknowledgeForeignContent })}
    />
  );
};

/**
 * Open the shared agent deletion confirmation. Every delete entry point (the
 * sidebar, the mobile list, the agent profile) goes through here so authors
 * and workspace owners read the same warning about other members' topics.
 *
 * The dialog opens right away, bound to `agentId`: its mask keeps the user on
 * the agent they started from instead of a late dialog surfacing over another
 * one. It shows a placeholder with Delete disabled until the impact lookup
 * settles (see `getRemoveAgentConfirmState`).
 */
export const confirmRemoveAgent = ({ agentId, onConfirm }: ConfirmRemoveAgentOptions): void => {
  // Built inside a promise executor so a lookup that throws synchronously
  // still settles as "failed" and the dialog opens with the plain copy.
  const impact = new Promise<AgentDeleteImpact>((resolve) =>
    resolve(agentService.getAgentDeleteImpact(agentId)),
  ).catch((error) => {
    console.error('[confirmRemoveAgent]', error);
    return null;
  });

  createModal({
    content: (
      <Suspense fallback={<ConfirmLayout content={<Skeleton.Text rows={2} />} />}>
        <LoadedConfirm impact={impact} onConfirm={onConfirm} />
      </Suspense>
    ),
    styles: { content: { padding: 0 } },
    title: t('delete', { ns: 'common' }),
    width: 420,
  });
};
