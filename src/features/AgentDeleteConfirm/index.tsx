import { type AgentDeleteImpact } from '@lobechat/types';
import { Alert, Button, createModal, ModalFooter, Skeleton, useModalContext } from '@lobehub/ui';
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

/**
 * Pick the confirmation copy for an agent delete. The cascade trashes every
 * topic under the agent, teammates' included, so the dialog must say so when
 * they exist — with a count when other members started topics, or the generic
 * "includes other members' content" line when only comments or messages are
 * foreign. A failed lookup (`null`) cannot rule teammates' content out, so it
 * warns that every topic goes rather than showing the plain copy: workspace
 * owners skip the server guard and would otherwise delete it unwarned.
 */
export const getRemoveAgentAlert = (
  impact: Pick<AgentDeleteImpact, 'foreignTopicCount' | 'hasForeignContent'> | null,
): string => {
  if (impact === null) return t('confirmRemoveSessionItemAlertImpactUnknown', { ns: 'chat' });
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
 * The strong warning shown when someone other than the caller created the
 * agent — a workspace Admin or Owner deleting a member's agent. `null` when
 * the caller created it.
 */
export const getOtherCreatorWarning = (impact: AgentDeleteImpact | null): string | null => {
  if (!impact?.createdByOther) return null;
  return impact.creatorName
    ? t('confirmRemoveAgentOtherCreator', { name: impact.creatorName, ns: 'chat' })
    : t('confirmRemoveAgentOtherCreatorUnknown', { ns: 'chat' });
};

/**
 * The dialog's state for an impact lookup: `undefined` while it is in flight,
 * `null` once it failed. Delete stays disabled until the lookup settles, so no
 * one — workspace owners included — can confirm before reading the warning.
 * A failed lookup shows the "can't tell, every topic goes" warning and
 * acknowledges nothing, which keeps the server guard on for non-owners while an
 * older server without the lookup can still delete.
 */
export const getRemoveAgentConfirmState = (impact: AgentDeleteImpact | null | undefined) => {
  if (impact === undefined)
    return {
      acknowledgeForeignContent: false,
      acknowledgeOtherCreator: false,
      alert: null,
      canConfirm: false,
      otherCreatorWarning: null,
    } as const;
  return {
    acknowledgeForeignContent: !!impact?.hasForeignContent,
    acknowledgeOtherCreator: !!impact?.createdByOther,
    alert: getRemoveAgentAlert(impact),
    canConfirm: true,
    otherCreatorWarning: getOtherCreatorWarning(impact),
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

  // Someone else's agent: both facts go into one error alert, so the creator
  // and the other members' topics cannot be skimmed past as routine copy.
  const content = state.otherCreatorWarning ? (
    <Alert showIcon description={state.alert} title={state.otherCreatorWarning} type={'error'} />
  ) : (
    state.alert
  );

  return (
    <ConfirmLayout
      content={content}
      onConfirm={() =>
        onConfirm({
          acknowledgeForeignContent: state.acknowledgeForeignContent,
          acknowledgeOtherCreator: state.acknowledgeOtherCreator,
        })
      }
    />
  );
};

/**
 * How long the dialog waits for the impact lookup before it gives up and shows
 * the impact-unknown copy. The lookup scans the agent's topics and messages and
 * can run into the function timeout on large agents; without a bound the
 * dialog would sit on its placeholder with Delete disabled for good.
 */
export const AGENT_DELETE_IMPACT_TIMEOUT_MS = 8000;

/**
 * Look up what deleting `agentId` would take down, settling as `null` when the
 * lookup fails, throws synchronously, or outlives `timeoutMs`. `null` is the
 * "can't tell" state: the dialog warns that every topic goes and acknowledges
 * nothing, so the server guard still decides for non-owners.
 */
export const lookupAgentDeleteImpact = (
  agentId: string,
  timeoutMs: number = AGENT_DELETE_IMPACT_TIMEOUT_MS,
): Promise<AgentDeleteImpact | null> =>
  new Promise<AgentDeleteImpact | null>((resolve) => {
    const timer = setTimeout(() => {
      console.error('[confirmRemoveAgent] impact lookup timed out', { agentId, timeoutMs });
      resolve(null);
    }, timeoutMs);
    const settle = (value: AgentDeleteImpact | null) => {
      clearTimeout(timer);
      resolve(value);
    };

    // Built inside a promise executor so a lookup that throws synchronously
    // still settles as "failed".
    new Promise<AgentDeleteImpact>((resolveLookup) =>
      resolveLookup(agentService.getAgentDeleteImpact(agentId)),
    ).then(settle, (error) => {
      console.error('[confirmRemoveAgent]', error);
      settle(null);
    });
  });

/**
 * Open the shared agent deletion confirmation. Every delete entry point (the
 * sidebar, the mobile list, the agent profile) goes through here so authors
 * and workspace owners read the same warning about other members' topics.
 *
 * The dialog opens right away, bound to `agentId`: its mask keeps the user on
 * the agent they started from instead of a late dialog surfacing over another
 * one. It shows a placeholder with Delete disabled until the impact lookup
 * settles (see `getRemoveAgentConfirmState`), which takes at most
 * `AGENT_DELETE_IMPACT_TIMEOUT_MS`.
 */
export const confirmRemoveAgent = ({ agentId, onConfirm }: ConfirmRemoveAgentOptions): void => {
  const impact = lookupAgentDeleteImpact(agentId);

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
