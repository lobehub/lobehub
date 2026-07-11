'use client';

import { Icon } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { BotIcon, CheckSquareIcon, FileTextIcon } from 'lucide-react';
import type { MouseEvent } from 'react';
import { memo, useCallback } from 'react';

import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
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
} as const;

interface InternalEntityLinkProps {
  label: string;
  reference: InternalLinkReference;
}

export const InternalEntityLink = memo<InternalEntityLinkProps>(({ label, reference }) => {
  const navigate = useWorkspaceAwareNavigate();
  const [openAgentDetail, openDocument, openTaskDetail] = useChatStore((s) => [
    s.openAgentDetail,
    s.openDocument,
    s.openTaskDetail,
  ]);

  const handleClick = useCallback(
    (event: MouseEvent<HTMLAnchorElement>) => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
        return;
      }

      event.preventDefault();

      if ('workspaceSlug' in reference && reference.workspaceSlug) {
        navigate(reference.pathname, { escape: true });
        return;
      }

      switch (reference.type) {
        case 'agent': {
          openAgentDetail(reference.agentId);
          break;
        }
        case 'document': {
          openDocument(reference.documentId);
          break;
        }
        case 'task': {
          openTaskDetail(reference.taskId);
          break;
        }
        case 'route': {
          navigate(reference.pathname, { escape: true });
          break;
        }
      }
    },
    [navigate, openAgentDetail, openDocument, openTaskDetail, reference],
  );

  const icon = reference.type === 'route' ? undefined : ENTITY_ICONS[reference.type];

  const link = (
    <a
      className={styles.link}
      href={reference.pathname}
      rel="noopener noreferrer"
      target="_blank"
      onClick={handleClick}
    >
      {icon && <Icon icon={icon} size={14} />}
      {label}
    </a>
  );

  if (reference.type === 'route') return link;

  return (
    <InternalEntityPreview fallbackTitle={label} reference={reference}>
      {link}
    </InternalEntityPreview>
  );
});

InternalEntityLink.displayName = 'InternalEntityLink';
