import { confirmModal } from '@lobehub/ui/base-ui';
import { TRPCClientError } from '@trpc/client';
import { t } from 'i18next';

/**
 * `workspace.ensureMarketOrganization` returns `PRECONDITION_FAILED` when the
 * workspace has no Market organization mirror yet. The Community profile must
 * be set up explicitly by an owner before fork / publish flows can act on
 * behalf of the workspace — see workspace.ts ensureMarketOrganization for the
 * server-side throw site.
 */
export const isMarketOrgSetupRequiredError = (error: unknown): boolean => {
  return (
    error instanceof TRPCClientError &&
    (error as TRPCClientError<any>).data?.code === 'PRECONDITION_FAILED'
  );
};

interface PromptMarketOrgSetupParams {
  /** True when the active workspace member can perform the setup themselves. */
  isOwner: boolean;
  /** Triggered when an owner confirms the prompt — wire to a navigate call. */
  onSetup?: () => void;
}

/**
 * Show a role-aware modal explaining why a workspace fork can't proceed and
 * what the user should do next. Owners get a "go set it up" CTA; everyone
 * else gets a "ask your owner" notice.
 */
export const promptMarketOrgSetup = ({ isOwner, onSetup }: PromptMarketOrgSetupParams): void => {
  if (isOwner) {
    confirmModal({
      cancelText: t('cancel', { ns: 'common' }),
      content: t('fork.orgSetupRequired.ownerContent', { ns: 'discover' }),
      okText: t('fork.orgSetupRequired.ownerOk', { ns: 'discover' }),
      onOk: () => {
        onSetup?.();
      },
      title: t('fork.orgSetupRequired.title', { ns: 'discover' }),
    });
    return;
  }

  confirmModal({
    // confirmModal always renders both buttons. There's nothing a non-owner
    // can do themselves, so both buttons just dismiss the modal — the OK
    // and Cancel labels collapse into "Got it" / "Close" to avoid implying
    // there's an action to take.
    cancelText: t('close', { ns: 'common' }),
    content: t('fork.orgSetupRequired.memberContent', { ns: 'discover' }),
    okText: t('gotIt', { ns: 'common' }),
    title: t('fork.orgSetupRequired.title', { ns: 'discover' }),
  });
};
