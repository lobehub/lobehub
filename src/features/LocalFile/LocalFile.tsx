import { Flexbox, Popover } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { ExternalLink, EyeIcon, FolderOpen, MessageSquarePlus } from 'lucide-react';
import React from 'react';
import { useTranslation } from 'react-i18next';

import FileIcon from '@/components/FileIcon';

import moduleStyles from './LocalFile.module.css';
import { type StartTopicConversation } from './StartTopicConversation';
import { useLocalFileActions } from './useLocalFileActions';
import { useStartTopicInDirectory } from './useStartTopicInDirectory';

const styles = stylex.create({
  container: {
    paddingBlock: '2px',
    paddingInlineStart: '4px',
    paddingInlineEnd: '8px',
    borderRadius: '4px',
    color: cssVar.colorText,
  },
  interactive: {
    cursor: 'pointer',
    color: { 'default': null, ':hover': cssVar.colorText },
    backgroundColor: { 'default': null, ':hover': cssVar.colorFillTertiary },
    backgroundImage: 'none',
    outlineColor: { 'default': null, ':focus-visible': cssVar.colorPrimaryBorder },
    outlineOffset: { 'default': null, ':focus-visible': '1px' },
    outlineStyle: { 'default': null, ':focus-visible': 'solid' },
    outlineWidth: { 'default': null, ':focus-visible': '2px' },
  },
  segmented: {
    overflow: 'hidden',
    display: 'inline-flex',
    alignItems: 'stretch',
    borderRadius: cssVar.borderRadiusLG,
  },
  title: {
    overflow: 'hidden',
    display: 'block',
    lineHeight: '20px',
    color: 'inherit',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
});

interface LocalFileProps {
  /**
   * The conversation rendering this reference, enabling "start a topic in this
   * folder" for it. Falls back to `StartTopicConversationContext`; absent
   * outside an eligible conversation.
   */
  conversation?: StartTopicConversation;
  isDirectory?: boolean;
  name: string;
  /**
   * Web only: opens the file in the right-side portal through the agent's
   * bound device. Without it the web chip is a static reference — the web app
   * has no Open / Show in Folder.
   */
  openInPortal?: () => void;
  path?: string;
  /**
   * When true, disable interactive actions (Open / Show in Folder).
   * Used in share pages where local file operations are not available.
   */
  readonly?: boolean;
}

export const LocalFile = ({
  conversation,
  name,
  path,
  isDirectory = false,
  openInPortal,
  readonly = false,
}: LocalFileProps) => {
  const { t } = useTranslation('components');
  const {
    canOpenNatively,
    canPreview,
    handleClick,
    handleOpenFile,
    handleOpenFolder,
    handlePreview,
  } = useLocalFileActions({ isDirectory, openInPortal, path, readonly });
  const { canStartTopic, startTopic } = useStartTopicInDirectory({
    conversation,
    isDirectory,
    path,
    readonly,
  });

  const fileContent = (
    <Flexbox
      horizontal
      align={'center'}
      className={
        stylex.props(styles.container, (handleClick || canOpenNatively) && styles.interactive)
          .className
      }
      gap={4}
      // Inline chip, not a <button> (block layout inside markdown prose) — so
      // give the clickable state complete button semantics by hand.
      role={handleClick ? 'button' : undefined}
      style={{ display: 'inline-flex', verticalAlign: 'middle' }}
      tabIndex={handleClick ? 0 : undefined}
      onClick={handleClick}
      onKeyDown={
        handleClick
          ? (event) => {
              if (event.key !== 'Enter' && event.key !== ' ') return;
              event.preventDefault();
              handleClick();
            }
          : undefined
      }
    >
      <FileIcon fileName={name} isDirectory={isDirectory} size={22} variant={'raw'} />
      <Flexbox horizontal align={'baseline'} gap={4} style={{ overflow: 'hidden', width: '100%' }}>
        <div {...stylex.props(styles.title)}>{name}</div>
      </Flexbox>
    </Flexbox>
  );

  // Readonly mode (e.g. share page) and the web app have no system actions;
  // there the chip only previews on click, so a hover menu would add nothing.
  if (!canOpenNatively) {
    return fileContent;
  }

  // Files and directories share the same hover action surface. Directory chips
  // keep their direct click-to-open behavior while exposing the contextual
  // "start topic here" action without adding persistent markdown clutter.
  const popoverContent = (
    <div {...stylex.props(styles.segmented)}>
      {canPreview && (
        <button className={moduleStyles.segment} type={'button'} onClick={handlePreview}>
          <EyeIcon size={15} />
          {t('LocalFile.action.preview')}
        </button>
      )}
      <button className={moduleStyles.segment} type={'button'} onClick={handleOpenFile}>
        <ExternalLink size={15} />
        {t('LocalFile.action.open')}
      </button>
      {isDirectory ? (
        canStartTopic && (
          <button
            className={moduleStyles.segment}
            type={'button'}
            onClick={() => void startTopic()}
          >
            <MessageSquarePlus size={15} />
            {t('LocalFile.action.startTopic')}
          </button>
        )
      ) : (
        <button className={moduleStyles.segment} type={'button'} onClick={handleOpenFolder}>
          <FolderOpen size={15} />
          {t('LocalFile.action.showInFolder')}
        </button>
      )}
    </div>
  );

  return (
    <Popover
      content={popoverContent}
      trigger="hover"
      styles={{
        content: { padding: 0 },
      }}
    >
      {fileContent}
    </Popover>
  );
};
