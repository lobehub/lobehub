'use client';

import { isDesktop } from '@lobechat/const';
import { RENDERER_HANDLED_LINK_ATTR } from '@lobechat/desktop-bridge';
import { A, copyToClipboard, Icon, toast } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
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
import { fileLinkMarker } from './markers.stylex';
import {
  getFileLinkCopyHref,
  getFileLinkOpenAction,
  getFileLinkTargetHref,
  isShareVisitorContext,
  resolveAppOrigin,
} from './parse';

const stylesAtomic = stylex.create({
  icon: { display: 'inline-flex', flexShrink: 0, alignItems: 'center' },
  label: {
    textDecorationColor: {
      default: cssVar.colorTextTertiary,
      [stylex.when.ancestor(':hover', fileLinkMarker)]: cssVar.colorTextSecondary,
    },
    textDecorationLine: 'underline',
    textDecorationThickness: '1px',
    textUnderlineOffset: '3px',
    transition: 'text-decoration-color 0.15s',
  },
  link: {
    cursor: 'pointer',
    display: 'inline-flex',
    gap: '4px',
    alignItems: 'center',
    color: cssVar.colorText,
    textDecoration: 'none',
    verticalAlign: '-0.16em',
    borderRadius: { 'default': null, ':focus-visible': '2px' },
    outlineWidth: { 'default': null, ':focus-visible': '2px' },
    outlineStyle: { 'default': null, ':focus-visible': 'solid' },
    outlineColor: { 'default': null, ':focus-visible': cssVar.colorPrimaryBorder },
    outlineOffset: { 'default': null, ':focus-visible': '2px' },
  },
  copy: {
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '18px',
    height: '18px',
    marginInlineStart: '2px',
    padding: '0',
    borderStyle: 'none',
    borderRadius: 'var(--lobe-border-radius-sm)',
    color: { 'default': 'var(--lobe-color-text-quaternary)', ':hover': 'var(--lobe-color-text)' },
    verticalAlign: '-0.2em',
    backgroundColor: { 'default': 'transparent', ':hover': 'var(--lobe-color-fill-secondary)' },
    backgroundImage: { 'default': 'none', ':hover': 'none' },
    transition: 'color 0.15s, background 0.15s',
    outlineWidth: { 'default': null, ':focus-visible': '2px' },
    outlineStyle: { 'default': null, ':focus-visible': 'solid' },
    outlineColor: { 'default': null, ':focus-visible': 'var(--lobe-color-primary-border)' },
    outlineOffset: { 'default': null, ':focus-visible': '1px' },
  },
});

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
    <span aria-hidden {...stylex.props(stylesAtomic['icon'])}>
      <FileIcon fileName={label} size={16} variant={'raw'} />
    </span>
    <span {...stylex.props(stylesAtomic['label'])}>{label}</span>
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
        {...stylex.props(stylesAtomic['link'], fileLinkMarker)}
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
          {...stylex.props(stylesAtomic['copy'])}
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
