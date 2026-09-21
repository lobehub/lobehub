'use client';

import { RENDERER_HANDLED_LINK_ATTR } from '@lobechat/desktop-bridge';
import { A } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import type { MouseEvent } from 'react';
import { memo, useCallback } from 'react';

import FileIcon from '@/components/FileIcon';
import { useChatStore } from '@/store/chat';

import type { MarkdownElementProps } from '../type';

interface FileLinkProperties {
  fileId?: string;
  linkHref?: string;
  linkLabel?: string;
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

const Render = memo<MarkdownElementProps<FileLinkProperties>>(({ node }) => {
  const { fileId, linkHref, linkLabel } = node?.properties || {};
  const openFilePreview = useChatStore((s) => s.openFilePreview);
  const label = linkLabel || linkHref || '';

  const handleClick = useCallback(
    (event: MouseEvent<HTMLAnchorElement>) => {
      if (!fileId) return;
      if (event.button !== 0) return;

      // Modifier/middle click keeps the native "open in a new tab" behavior.
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

      event.preventDefault();
      openFilePreview({ fileId });
    },
    [fileId, openFilePreview],
  );

  return (
    <A
      {...(fileId ? { [RENDERER_HANDLED_LINK_ATTR]: 'true' } : {})}
      className={styles.link}
      href={linkHref}
      rel="noopener noreferrer"
      onClick={handleClick}
    >
      <span aria-hidden className={styles.icon}>
        <FileIcon fileName={label} size={16} variant={'raw'} />
      </span>
      <span>{label}</span>
    </A>
  );
});

Render.displayName = 'FileLinkRender';

export default Render;
