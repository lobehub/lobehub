'use client';

import { RENDERER_HANDLED_LINK_ATTR } from '@lobechat/desktop-bridge';
import { A, createStaticStyles } from '@lobehub/ui';
import type { MouseEvent } from 'react';
import { memo, useCallback } from 'react';

import FileIcon from '@/components/FileIcon';
import { useChatStore } from '@/store/chat';
import { useFileStore } from '@/store/file';

import { useConversationStore } from '../../../store';
import type { MarkdownElementProps } from '../type';
import { getFileLinkOpenAction } from './parse';

interface FileLinkProperties {
  fileId?: string;
  linkHref?: string;
  linkLabel?: string;
  proxyHref?: string;
}

const styles = createStaticStyles(({ css, cssVar }) => ({
  icon: css`
    display: inline-flex;
    flex-shrink: 0;
    align-items: center;
  `,
  link: css`
    cursor: pointer;

    display: inline-flex;
    gap: 4px;
    align-items: center;

    margin-inline: -2px;
    padding-inline: 2px;
    border-radius: ${cssVar.borderRadiusSM};

    text-decoration: none;
    vertical-align: -0.16em;

    transition:
      color 0.2s ${cssVar.motionEaseOut},
      background 0.2s ${cssVar.motionEaseOut},
      box-shadow 0.2s ${cssVar.motionEaseOut};

    &:hover {
      color: ${cssVar.colorLinkHover};
      text-decoration: underline;
      text-underline-offset: 2px;

      background: ${cssVar.colorFillSecondary};
      box-shadow: inset 0 0 0 1px ${cssVar.colorPrimaryBorder};
    }

    &:active {
      color: ${cssVar.colorLinkActive};
      background: ${cssVar.colorFill};
    }

    &:focus-visible {
      outline: 2px solid ${cssVar.colorPrimaryBorder};
      outline-offset: 2px;
    }
  `,
}));

const FileLabel = ({ label }: { label: string }) => (
  <>
    <span aria-hidden className={styles.icon}>
      <FileIcon fileName={label} size={16} variant={'raw'} />
    </span>
    <span>{label}</span>
  </>
);

/**
 * A pasted address (`https://…/resource/file/file_x`) says nothing about the
 * file, so the owner sees its name instead — the same item the preview panel
 * reads, so the click opens instantly.
 */
const OwnedFileLabel = memo<{ fallback: string; fileId: string }>(({ fallback, fileId }) => {
  const useFetchKnowledgeItem = useFileStore((s) => s.useFetchKnowledgeItem);
  const { data: file } = useFetchKnowledgeItem(fileId);

  return <FileLabel label={file?.name || fallback} />;
});

OwnedFileLabel.displayName = 'FileLinkOwnedFileLabel';

const Render = memo<MarkdownElementProps<FileLinkProperties>>(({ node }) => {
  const { fileId, linkHref, linkLabel, proxyHref } = node?.properties || {};
  const openFilePreview = useChatStore((s) => s.openFilePreview);
  const isAgentShareVisitor = useConversationStore((s) => !!s.context.agentShareId);
  // Share pages read the creator's transcript; the visitor's file store holds
  // none of those files (and is an empty stub during share SSR).
  const isShareVisitor = useConversationStore(
    (s) => !!s.context.agentShareId || !!s.context.topicShareId,
  );
  const label = linkLabel || linkHref || '';
  const isBareLink = !linkLabel || linkLabel === linkHref || linkLabel === fileId;

  const handleClick = useCallback(
    (event: MouseEvent<HTMLAnchorElement>) => {
      if (!fileId) return;
      if (event.button !== 0) return;

      // Modifier/middle click keeps the native "open in a new tab" behavior.
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

      event.preventDefault();
      const action = getFileLinkOpenAction({ fileId, isAgentShareVisitor, label, proxyHref });
      if (action.kind === 'newTab') {
        window.open(action.url, '_blank', 'noopener,noreferrer');
        return;
      }
      openFilePreview(action.params);
    },
    [fileId, isAgentShareVisitor, label, openFilePreview, proxyHref],
  );

  return (
    <A
      {...(fileId ? { [RENDERER_HANDLED_LINK_ATTR]: 'true' } : {})}
      className={styles.link}
      href={linkHref}
      rel="noopener noreferrer"
      onClick={handleClick}
    >
      {fileId && isBareLink && !isShareVisitor ? (
        <OwnedFileLabel fallback={label} fileId={fileId} />
      ) : (
        <FileLabel label={label} />
      )}
    </A>
  );
});

Render.displayName = 'FileLinkRender';

export default Render;
