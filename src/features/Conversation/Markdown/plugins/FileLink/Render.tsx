'use client';

import { isDesktop } from '@lobechat/const';
import { RENDERER_HANDLED_LINK_ATTR } from '@lobechat/desktop-bridge';
import { A, copyToClipboard, Icon, toast } from '@lobehub/ui';
import { CopyIcon } from 'lucide-react';
import type { MouseEvent } from 'react';
import { memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import FileIcon from '@/components/FileIcon';
import { EntityLinkRender, parseLobeLink } from '@/features/EntityLink';
import { useChatStore } from '@/store/chat';
import { useElectronStore } from '@/store/electron';
import { electronSyncSelectors } from '@/store/electron/selectors';
import { useFileStore } from '@/store/file';

import { useConversationStore } from '../../../store';
import type { MarkdownElementProps } from '../type';
import {
  getFileLinkCopyHref,
  getFileLinkOpenAction,
  getFileLinkTargetHref,
  isShareVisitorContext,
  resolveAppOrigin,
} from './parse';
import styles from './Render.module.css';

interface FileLinkProperties {
  fileId?: string;
  linkHref?: string;
  linkLabel?: string;
  linkScope?: 'active' | 'foreign';
  proxyHref?: string;
}

/**
 * The app server's origin, read at click time: on desktop the renderer's own
 * origin (`app://renderer`) is not the server a copied link must point at.
 * Kept out of render so the share page's SSR never touches the window or the
 * (stubbed) desktop store.
 */
const getAppOrigin = () =>
  resolveAppOrigin({
    isDesktop,
    remoteServerUrl: () => electronSyncSelectors.remoteServerUrl(useElectronStore.getState()),
    windowOrigin: () => window.location.origin,
  });

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
  const { fileId, linkHref, linkLabel, linkScope, proxyHref } = node?.properties || {};
  const openFilePreview = useChatStore((s) => s.openFilePreview);
  // A share reader previews and copies the public proxy, not the owner's page.
  const isShareVisitor = useConversationStore((s) => isShareVisitorContext(s.context));
  const { t } = useTranslation('common');
  const label = linkLabel || linkHref || '';
  const isBareLink = !linkLabel || linkLabel === linkHref || linkLabel === fileId;
  const targetHref = getFileLinkTargetHref({ isShareVisitor, linkHref, proxyHref });

  const handleCopy = useCallback(async () => {
    const href = getFileLinkCopyHref({
      isShareVisitor,
      linkHref,
      origin: getAppOrigin(),
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

  // The owner's link into another scope (a personal file inside a workspace,
  // another workspace's file) cannot preview in this one: it stays an ordinary
  // internal link that navigates there.
  if (linkScope === 'foreign' && !isShareVisitor) {
    return (
      <EntityLinkRender
        node={{
          properties: {
            linkHref,
            linkKind: parseLobeLink(linkHref)?.kind ?? 'generic',
            linkLabel: label,
          },
        }}
      />
    );
  }

  return (
    <>
      <A
        {...(fileId ? { [RENDERER_HANDLED_LINK_ATTR]: 'true' } : {})}
        className={styles.link}
        href={targetHref}
        rel="noopener noreferrer"
        onClick={handleClick}
      >
        {fileId && isBareLink && !isShareVisitor ? (
          <OwnedFileLabel fallback={label} fileId={fileId} />
        ) : (
          <FileLabel label={label} />
        )}
      </A>
      {targetHref && (
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
