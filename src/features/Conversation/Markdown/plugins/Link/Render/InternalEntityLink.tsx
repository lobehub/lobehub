'use client';

import { isDesktop } from '@lobechat/const';
import { RENDERER_HANDLED_LINK_ATTR } from '@lobechat/desktop-bridge';
import { Icon } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import {
  BadgeCheckIcon,
  BotIcon,
  CheckCircleIcon,
  CheckSquareIcon,
  FileTextIcon,
} from 'lucide-react';
import type { MouseEvent } from 'react';
import { memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { shouldHardNavigateToWorkbench } from '@/libs/next/workbenchNavigation';
import { useClientDataSWR } from '@/libs/swr';
import { agentDocumentService, agentDocumentSWRKeys } from '@/services/agentDocument';
import { useAgentStore } from '@/store/agent';
import { useChatStore } from '@/store/chat';

import { type InternalLinkReference, isBareLinkLabel } from '../internalLink';
import {
  getPreviewData,
  InternalEntityPreview,
  internalEntityPreviewKey,
} from './InternalEntityPreview';

const styles = createStaticStyles(({ css, cssVar }) => ({
  link: css`
    display: inline-flex;
    gap: 4px;
    align-items: center;

    color: ${cssVar.colorText} !important;

    /* Tertiary, not colorBorder: on a dark background colorBorder sits so
       close to the bubble that the underline vanishes and the link reads as
       plain text — findability is the underline's whole job here. */
    text-decoration-color: ${cssVar.colorTextTertiary};
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
  acceptance: BadgeCheckIcon,
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
  const { t } = useTranslation('chat');
  const navigate = useWorkspaceAwareNavigate();
  const activeAgentId = useAgentStore((s) => s.activeAgentId);
  const [openAcceptance, openAgentDetail, openDocument, openTaskDetail, openVerifyReport] =
    useChatStore((s) => [
      s.openAcceptance,
      s.openAgentDetail,
      s.openDocument,
      s.openTaskDetail,
      s.openVerifyReport,
    ]);
  // A pasted URL says nothing about what it points to, so resolve the entity's
  // own title and show that instead — the same read the hover preview makes,
  // under the same key, so the eager fetch also makes the hover card instant.
  // Bare links are sparse in real messages, which is why prefetching the full
  // preview beats a dedicated title read. Cross-workspace links are skipped:
  // the ambient client resolves against the ACTIVE scope, where a
  // workspace-unique id like T-198 can name a different entity entirely.
  // Authored link text is never replaced; a failed read just leaves the URL.
  const shouldResolveTitle =
    reference.type !== 'route' && !reference.workspaceSlug && isBareLinkLabel(label, href);
  const { data: entity } = useClientDataSWR(
    shouldResolveTitle ? internalEntityPreviewKey(reference) : null,
    () => getPreviewData(reference, t),
    { revalidateOnFocus: false },
  );
  const displayLabel = (shouldResolveTitle && entity?.title) || label;

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

      if (
        (reference.type === 'acceptance' ||
          reference.type === 'document' ||
          reference.type === 'verify') &&
        shouldHardNavigateToWorkbench(reference.pathname)
      ) {
        window.location.assign(reference.pathname);
        return;
      }

      // Portal-backed entities (verify / acceptance) open in-context regardless
      // of workspace scope — their reads are id-addressed and scope-independent.
      if (
        'workspaceSlug' in reference &&
        reference.workspaceSlug &&
        reference.type !== 'verify' &&
        reference.type !== 'acceptance'
      ) {
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
        case 'acceptance': {
          // The conversation is the working surface — the acceptance opens
          // beside it in the portal, same as a verify report, never a
          // full-page navigation away from the chat.
          openAcceptance(reference.acceptanceId);
          break;
        }
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
      openAcceptance,
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
      {displayLabel}
    </a>
  );

  if (reference.type === 'route' || reference.workspaceSlug) return link;

  return (
    <InternalEntityPreview fallbackTitle={displayLabel} reference={reference}>
      {link}
    </InternalEntityPreview>
  );
});

InternalEntityLink.displayName = 'InternalEntityLink';
