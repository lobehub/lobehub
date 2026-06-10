'use client';

import { isDesktop } from '@lobechat/const';
import { A } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { memo, type MouseEvent, useCallback } from 'react';

import FileIcon from '@/components/FileIcon';
import { useChatStore } from '@/store/chat';
import { topicSelectors } from '@/store/chat/selectors';

import { type MarkdownElementProps } from '../type';
import { parseLocalFileHref } from './parse';

interface LocalFileLinkProperties {
  linkHref?: string;
  linkLabel?: string;
}

const styles = createStaticStyles(({ css }) => ({
  icon: css`
    display: inline-flex;
    flex-shrink: 0;
    align-items: center;
  `,
  link: css`
    display: inline-flex;
    gap: 4px;
    align-items: center;
    vertical-align: -0.16em;
  `,
}));

const getFileName = (filePath: string) => filePath.split(/[\\/]/).at(-1) || filePath;

const Render = memo<MarkdownElementProps<LocalFileLinkProperties>>(({ node }) => {
  const { linkHref, linkLabel } = node?.properties || {};
  const openLocalFile = useChatStore((s) => s.openLocalFile);
  const workingDirectory = useChatStore(topicSelectors.currentTopicWorkingDirectory);
  const parsed = isDesktop ? parseLocalFileHref(linkHref, { workingDirectory }) : null;
  const label = linkLabel || parsed?.filePath || linkHref || '';
  const iconFileName = parsed ? getFileName(parsed.filePath) : label;

  const handleClick = useCallback(
    (event: MouseEvent<HTMLAnchorElement>) => {
      if (!parsed) return;
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
        return;
      }

      event.preventDefault();
      openLocalFile({
        filePath: parsed.filePath,
        workingDirectory: parsed.workingDirectory,
      });
    },
    [openLocalFile, parsed],
  );

  return (
    <A className={styles.link} href={linkHref} onClick={handleClick}>
      <span aria-hidden className={styles.icon}>
        <FileIcon fileName={iconFileName} size={16} variant={'raw'} />
      </span>
      <span>{label}</span>
    </A>
  );
});

Render.displayName = 'LocalFileLinkRender';

export default Render;
