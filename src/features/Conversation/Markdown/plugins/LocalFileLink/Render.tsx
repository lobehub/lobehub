'use client';

import { isDesktop } from '@lobechat/const';
import { RENDERER_HANDLED_LINK_ATTR } from '@lobechat/desktop-bridge';
import { A, Tooltip } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import type { MouseEvent } from 'react';
import { memo, useCallback } from 'react';

import FileIcon from '@/components/FileIcon';
import { useChatStore } from '@/store/chat';
import { topicSelectors } from '@/store/chat/selectors';

import type { MarkdownElementProps } from '../type';
import type { ParsedLocalFileHref } from './parse';
import { parseLocalFileHref } from './parse';

interface LocalFileLinkProperties {
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

const getFileName = (filePath: string) => filePath.split(/[\\/]/).at(-1) || filePath;

const formatLocalFileTitle = ({ column, filePath, line }: ParsedLocalFileHref) => {
  if (!line) return filePath;

  return column ? `${filePath} (line ${line}, column ${column})` : `${filePath} (line ${line})`;
};

const Render = memo<MarkdownElementProps<LocalFileLinkProperties>>(({ node }) => {
  const { linkHref, linkLabel } = node?.properties || {};
  const openLocalFile = useChatStore((s) => s.openLocalFile);
  const workingDirectory = useChatStore(topicSelectors.currentTopicWorkingDirectory);
  const parsed = isDesktop ? parseLocalFileHref(linkHref, { workingDirectory }) : null;
  const allowExternalFilePreview =
    !!parsed && (!workingDirectory || parsed.workingDirectory !== workingDirectory);
  const label = linkLabel || parsed?.filePath || linkHref || '';
  const iconFileName = parsed ? getFileName(parsed.filePath) : label;
  const title = parsed ? formatLocalFileTitle(parsed) : linkHref;

  const handleClick = useCallback(
    (event: MouseEvent<HTMLAnchorElement>) => {
      // `parsed` is only non-null on desktop, where a local path has no meaningful
      // modifier-click behaviour — always take over the click.
      if (!parsed) return;
      if (event.button !== 0) return;

      event.preventDefault();
      openLocalFile({
        allowExternalFilePreview,
        filePath: parsed.filePath,
        workingDirectory: parsed.workingDirectory,
      });
    },
    [allowExternalFilePreview, openLocalFile, parsed],
  );

  return (
    <Tooltip mouseEnterDelay={0.1} placement={'topLeft'} title={title}>
      <A
        {...(parsed ? { [RENDERER_HANDLED_LINK_ATTR]: 'true' } : {})}
        className={styles.link}
        href={linkHref}
        onClick={handleClick}
      >
        <span aria-hidden className={styles.icon}>
          <FileIcon fileName={iconFileName} size={16} variant={'raw'} />
        </span>
        <span>{label}</span>
      </A>
    </Tooltip>
  );
});

Render.displayName = 'LocalFileLinkRender';

export default Render;
