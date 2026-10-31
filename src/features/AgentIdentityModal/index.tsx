'use client';

import { createModal } from '@lobehub/ui';
import { t } from 'i18next';

import AgentIdentityContent from './Content';
import CreateAgentIdentityContent, { type CreateAgentIdentityContentProps } from './CreateContent';

const MODAL_WIDTH = 'min(90%, 460px)';

/** Open the identity form (name / role / description / slug) for a specific agent. */
export const createAgentIdentityModal = (agentId: string) =>
  createModal({
    content: <AgentIdentityContent agentId={agentId} />,
    footer: null,
    styles: { content: { padding: 0 } },
    title: t('settingAgent.identity.edit', { ns: 'setting' }),
    width: MODAL_WIDTH,
  });

export interface OpenCreateAgentIdentityModalOptions extends CreateAgentIdentityContentProps {
  /** Runs once the modal has been dismissed, for whatever reason. */
  onClosed?: () => void;
}

/** Open the create-agent form: avatar plus the identity fields. */
export const openCreateAgentIdentityModal = ({
  onClosed,
  ...contentProps
}: OpenCreateAgentIdentityModalOptions) =>
  createModal({
    content: <CreateAgentIdentityContent {...contentProps} />,
    footer: null,
    // `onOpenChange` only fires for user dismissal; the in-content close goes
    // through `instance.close()`, which only `onOpenChangeComplete` observes.
    onOpenChangeComplete: (open) => {
      if (!open) onClosed?.();
    },
    styles: { content: { padding: 0 } },
    title: t('newAgent', { ns: 'chat' }),
    width: MODAL_WIDTH,
  });
