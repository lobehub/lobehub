'use client';

import { isDesktop } from '@lobechat/const';
import { RENDERER_HANDLED_LINK_ATTR } from '@lobechat/desktop-bridge';
import { Icon } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { BotIcon, CheckCircleIcon, CheckSquareIcon, FileTextIcon } from 'lucide-react';
import type { MouseEvent } from 'react';
import { memo, useCallback } from 'react';

import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useClientDataSWR } from '@/libs/swr';
import { agentDocumentService, agentDocumentSWRKeys } from '@/services/agentDocument';
import { useAgentStore } from '@/store/agent';
import { useChatStore } from '@/store/chat';

import type { InternalLinkReference } from '../internalLink';
import { InternalEntityPreview } from './InternalEntityPreview';

const styles = createStaticStyles(({ css, cssVar }) => ({
  link: css`
    display: inline-flex;
    gap: 4px;
    align-items: center;

    color: ${cssVar.colorText} !important;
    text-decoration-color: ${cssVar.colorBorder};
    text-decoration-line: underline;
    text-decoration-thickness: 1px;
    text-underline-offset: 3px;

    transition:
      color 0.15s,
      text-decoration-color 0.15s;

    &:hover {
      color: ${cssVar.colorText} !important;
      text-decoration-color: ${cssVar.colorTextSecondary};
    }

    &:focus-visible {
      border-radius: 2px;
      outline: 2px solid ${cssVar.colorPrimaryBorder};
      outline-offset: 2px;
    }

    > svg {
      flex: none;
      color: ${cssVar.colorTextSecondary};
    }
  `,
}));

const ENTITY_ICONS = {
  agent: BotIcon,
  document: FileTextIcon,
  task: CheckSquareIcon,
  verify: CheckCircleIcon,
} as const;

interface InternalEntityLinkProps {
  href: string;
  label: string;
  reference: InternalLinkReference;
}

export const InternalEntityLink = memo<InternalEntityLinkProps>(({ href, label, reference }) => {
  const navigate = useWorkspaceAwareNavigate();
  const activeAgentId = useAgentStore((s) => s.activeAgentId);
  const [openAgentDetail, openDocument, openTaskDetail, openVerifyReport] = useChatStore((s) => [
    s.openAgentDetail,
    s.openDocument,
    s.openTaskDetail,
    s.openVerifyReport,
  ]);
  const linkedAgentId = reference.type === 'document' ? reference.agentId : undefined;
  const shouldResolveAgentDocument = !!linkedAgentId && linkedAgentId === activeAgentId;
  const { data: agentDocuments, mutate: resolveAgentDocuments } = useClientDataSWR(
    shouldResolveAgentDocument ? agentDocumentSWRKeys.documentsList(linkedAgentId) : null,
    () => agentDocumentService.listDocuments({ agentId: linkedAgentId! }),
  );

  const handleClick = useCallback(
    async (event: MouseEvent<HTMLAnchorElement>) => {
      if (event.button !== 0) return;

      // On the web a modifier-click means "open in a new tab", so let the browser
      // handle it. Desktop has no tabs: falling through would hand the OS an
      // `app://renderer/...` URL, which silently opens nothing.
      const modifierClick = event.metaKey || event.ctrlKey || event.shiftKey || event.altKey;
      if (!isDesktop && modifierClick) return;

      event.preventDefault();

      if ('workspaceSlug' in reference && reference.workspaceSlug && reference.type !== 'verify') {
        navigate(reference.pathname, { escape: true });
        return;
      }

      if (
        reference.type === 'document' &&
        reference.agentId &&
        reference.agentId !== activeAgentId
      ) {
        navigate(reference.pathname, { escape: true });
        return;
      }

      switch (reference.type) {
        case 'agent': {
          openAgentDetail(reference.agentId);
          break;
        }
        case 'document': {
          const documents = shouldResolveAgentDocument
            ? (agentDocuments ?? (await resolveAgentDocuments().catch(() => undefined)))
            : undefined;
          const agentDocumentId = documents?.find(
            (document) => document.documentId === reference.documentId,
          )?.id;

          openDocument(reference.documentId, agentDocumentId);
          break;
        }
        case 'task': {
          openTaskDetail(reference.taskId);
          break;
        }
        case 'verify': {
          openVerifyReport(reference.runId);
          break;
        }
        case 'route': {
          navigate(reference.pathname);
          break;
        }
      }
    },
    [
      activeAgentId,
      agentDocuments,
      navigate,
      openAgentDetail,
      openDocument,
      openTaskDetail,
      openVerifyReport,
      reference,
      resolveAgentDocuments,
      shouldResolveAgentDocument,
    ],
  );

  const icon = reference.type === 'route' ? undefined : ENTITY_ICONS[reference.type];

  const link = (
    <a
      {...{ [RENDERER_HANDLED_LINK_ATTR]: 'true' }}
      className={styles.link}
      href={href}
      rel="noopener noreferrer"
      target="_blank"
      onClick={handleClick}
    >
      {icon && <Icon icon={icon} size={14} />}
      {label}
    </a>
  );

  if (reference.type === 'route' || reference.workspaceSlug) return link;

  return (
    <InternalEntityPreview fallbackTitle={label} reference={reference}>
      {link}
    </InternalEntityPreview>
  );
});

InternalEntityLink.displayName = 'InternalEntityLink';
