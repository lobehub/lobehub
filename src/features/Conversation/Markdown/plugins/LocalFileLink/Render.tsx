'use client';

import { isDesktop } from '@lobechat/const';
import { RENDERER_HANDLED_LINK_ATTR } from '@lobechat/desktop-bridge';
import { A, Tooltip } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
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

const styles = stylex.create({
  reference: { display: 'inline-flex', gap: '4px', alignItems: 'center', verticalAlign: '-0.16em' },
  icon: { display: 'inline-flex', flexShrink: 0, alignItems: 'center' },
  link: {
    cursor: 'pointer',
    display: 'inline-flex',
    gap: '4px',
    alignItems: 'center',
    marginInline: '-2px',
    paddingInline: '2px',
    borderRadius: cssVar.borderRadiusSM,
    textDecoration: { 'default': 'none', ':hover': 'underline' },
    verticalAlign: '-0.16em',
    transition: `color 0.2s ${cssVar.motionEaseOut},
      background 0.2s ${cssVar.motionEaseOut},
      box-shadow 0.2s ${cssVar.motionEaseOut}`,
    color: { 'default': null, ':hover': cssVar.colorLinkHover, ':active': cssVar.colorLinkActive },
    textUnderlineOffset: { 'default': null, ':hover': '2px' },
    backgroundColor: {
      'default': null,
      ':hover': cssVar.colorFillSecondary,
      ':active': cssVar.colorFill,
    },
    backgroundImage: { 'default': null, ':hover': 'none', ':active': 'none' },
    boxShadow: { 'default': null, ':hover': `inset 0 0 0 1px ${cssVar.colorPrimaryBorder}` },
    outlineWidth: { 'default': null, ':focus-visible': '2px' },
    outlineStyle: { 'default': null, ':focus-visible': 'solid' },
    outlineColor: { 'default': null, ':focus-visible': cssVar.colorPrimaryBorder },
    outlineOffset: { 'default': null, ':focus-visible': '2px' },
  },
});

const getFileName = (filePath: string) => filePath.split(/[\\/]/).at(-1) || filePath;

const formatLocalFileTitle = ({ column, filePath, line }: ParsedLocalFileHref) => {
  if (!line) return filePath;

  return column ? `${filePath} (line ${line}, column ${column})` : `${filePath} (line ${line})`;
};

const Render = memo<MarkdownElementProps<LocalFileLinkProperties>>(({ node }) => {
  const { linkHref, linkLabel } = node?.properties || {};
  const openLocalFile = useChatStore((s) => s.openLocalFile);
  const workingDirectory = useChatStore(topicSelectors.currentTopicWorkingDirectory);
  const parsed = parseLocalFileHref(linkHref, { workingDirectory });
  const canPreview = isDesktop && !!parsed?.workingDirectory;
  const allowExternalFilePreview =
    !!parsed && (!workingDirectory || parsed.workingDirectory !== workingDirectory);
  const label = linkLabel || parsed?.filePath || linkHref || '';
  const iconFileName = parsed ? getFileName(parsed.filePath) : label;
  const title = parsed ? formatLocalFileTitle(parsed) : linkHref;

  const handleClick = useCallback(
    (event: MouseEvent<HTMLAnchorElement>) => {
      if (!parsed || !canPreview) return;
      if (event.button !== 0) return;

      event.preventDefault();
      openLocalFile({
        allowExternalFilePreview,
        filePath: parsed.filePath,
        workingDirectory: parsed.workingDirectory,
      });
    },
    [allowExternalFilePreview, canPreview, openLocalFile, parsed],
  );

  if (!canPreview) {
    return (
      <Tooltip mouseEnterDelay={0.1} placement={'topLeft'} title={title}>
        <span {...stylex.props(styles.reference)} data-file-path={parsed?.filePath}>
          <span aria-hidden {...stylex.props(styles.icon)}>
            <FileIcon fileName={iconFileName} size={16} variant={'raw'} />
          </span>
          <span>{label}</span>
        </span>
      </Tooltip>
    );
  }

  return (
    <Tooltip mouseEnterDelay={0.1} placement={'topLeft'} title={title}>
      <A
        {...(parsed ? { [RENDERER_HANDLED_LINK_ATTR]: 'true' } : {})}
        className={stylex.props(styles.link).className}
        href={linkHref}
        onClick={handleClick}
      >
        <span aria-hidden {...stylex.props(styles.icon)}>
          <FileIcon fileName={iconFileName} size={16} variant={'raw'} />
        </span>
        <span>{label}</span>
      </A>
    </Tooltip>
  );
});

Render.displayName = 'LocalFileLinkRender';

export default Render;
