'use client';

import { RENDERER_HANDLED_LINK_ATTR } from '@lobechat/desktop-bridge';
import { A, copyToClipboard, createStaticStyles, Icon, toast } from '@lobehub/ui';
import { CopyIcon } from 'lucide-react';
import type { MouseEvent } from 'react';
import { memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import FileIcon from '@/components/FileIcon';
import { useChatStore } from '@/store/chat';
import { useFileStore } from '@/store/file';

import { useConversationStore } from '../../../store';
import type { MarkdownElementProps } from '../type';
import { getFileLinkCopyHref, getFileLinkOpenAction, isShareVisitorContext } from './parse';

interface FileLinkProperties {
  fileId?: string;
  linkHref?: string;
  linkLabel?: string;
  proxyHref?: string;
}

const styles = createStaticStyles(({ css, cssVar }) => ({
  copy: css`
    cursor: pointer;

    display: inline-flex;
    align-items: center;
    justify-content: center;

    width: 18px;
    height: 18px;
    margin-inline-start: 2px;
    padding: 0;
    border: none;
    border-radius: ${cssVar.borderRadiusSM};

    color: ${cssVar.colorTextQuaternary};
    vertical-align: -0.2em;

    background: transparent;

    transition:
      color 0.15s,
      background 0.15s;

    &:hover {
      color: ${cssVar.colorText};
      background: ${cssVar.colorFillSecondary};
    }

    &:focus-visible {
      outline: 2px solid ${cssVar.colorPrimaryBorder};
      outline-offset: 1px;
    }
  `,
  icon: css`
    display: inline-flex;
    flex-shrink: 0;
    align-items: center;
  `,
  label: css`
    /* The same treatment as an internal entity link: body text with an
       underline, not link blue — the file icon already says what it is. */
    text-decoration-color: ${cssVar.colorTextTertiary};
    text-decoration-line: underline;
    text-decoration-thickness: 1px;
    text-underline-offset: 3px;

    transition: text-decoration-color 0.15s;
  `,
  link: css`
    cursor: pointer;

    display: inline-flex;
    gap: 4px;
    align-items: center;

    color: ${cssVar.colorText} !important;
    text-decoration: none;
    vertical-align: -0.16em;

    &:hover {
      color: ${cssVar.colorText} !important;
    }

    &:hover > span:last-child {
      text-decoration-color: ${cssVar.colorTextSecondary};
    }

    &:focus-visible {
      border-radius: 2px;
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
    <span className={styles.label}>{label}</span>
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
  // A share reader previews and copies the public proxy, not the owner's page.
  const isShareVisitor = useConversationStore((s) => isShareVisitorContext(s.context));
  const { t } = useTranslation('common');
  const label = linkLabel || linkHref || '';
  const isBareLink = !linkLabel || linkLabel === linkHref || linkLabel === fileId;
  const hasCopyHref = !!(isShareVisitor ? (proxyHref ?? linkHref) : linkHref);

  const handleCopy = useCallback(async () => {
    const href = getFileLinkCopyHref({
      isShareVisitor,
      linkHref,
      origin: window.location.origin,
      proxyHref,
    });
    if (!href) return;
    await copyToClipboard(href);
    toast.success(t('copySuccess'));
  }, [isShareVisitor, linkHref, proxyHref, t]);

  const handleClick = useCallback(
    (event: MouseEvent<HTMLAnchorElement>) => {
      if (!fileId) return;
      if (event.button !== 0) return;

      // Modifier/middle click keeps the native "open in a new tab" behavior.
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

      event.preventDefault();
      const action = getFileLinkOpenAction({ fileId, isShareVisitor, label, proxyHref });
      if (action.kind === 'newTab') {
        window.open(action.url, '_blank', 'noopener,noreferrer');
        return;
      }
      openFilePreview(action.params);
    },
    [fileId, isShareVisitor, label, openFilePreview, proxyHref],
  );

  return (
    <>
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
      {hasCopyHref && (
        <button
          aria-label={t('copy')}
          className={styles.copy}
          title={t('copy')}
          type={'button'}
          onClick={handleCopy}
        >
          <Icon icon={CopyIcon} size={12} />
        </button>
      )}
    </>
  );
});

Render.displayName = 'FileLinkRender';

export default Render;
