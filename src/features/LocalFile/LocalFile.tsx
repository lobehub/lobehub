import { Flexbox, Popover } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { ExternalLink, EyeIcon, FolderOpen } from 'lucide-react';
import React from 'react';
import { useTranslation } from 'react-i18next';

import FileIcon from '@/components/FileIcon';

import { useLocalFileActions } from './useLocalFileActions';

const styles = createStaticStyles(({ css }) => ({
  container: css`
    cursor: pointer;

    padding-block: 2px;
    padding-inline: 4px 8px;
    border-radius: 4px;

    color: ${cssVar.colorText};

    :hover {
      color: ${cssVar.colorText};
      background: ${cssVar.colorFillTertiary};
    }

    &:focus-visible {
      outline: 2px solid ${cssVar.colorPrimaryBorder};
      outline-offset: 1px;
    }
  `,
  title: css`
    overflow: hidden;
    display: block;

    line-height: 20px;
    color: inherit;
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
}));

interface LocalFileProps {
  isDirectory?: boolean;
  name: string;
  path?: string;
  /**
   * When true, disable interactive actions (Open / Show in Folder).
   * Used in share pages where local file operations are not available.
   */
  readonly?: boolean;
}

export const LocalFile = ({
  name,
  path,
  isDirectory = false,
  readonly = false,
}: LocalFileProps) => {
  const { t } = useTranslation('components');
  const { canPreview, handleClick, handleOpenFile, handleOpenFolder, handlePreview } =
    useLocalFileActions({ isDirectory, path, readonly });

  const fileContent = (
    <Flexbox
      horizontal
      align={'center'}
      className={styles.container}
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
        <div className={styles.title}>{name}</div>
      </Flexbox>
    </Flexbox>
  );

  // Directory or readonly mode (e.g. share page): no popover, just display
  if (isDirectory || readonly) {
    return fileContent;
  }

  // File: show popover with actions
  const popoverContent = (
    <Flexbox horizontal gap={4} padding={4}>
      {canPreview && (
        <Button
          icon={EyeIcon}
          size="small"
          title={t('LocalFile.action.preview')}
          onClick={handlePreview}
        >
          {t('LocalFile.action.preview')}
        </Button>
      )}
      <Button
        icon={ExternalLink}
        size="small"
        title={t('LocalFile.action.open')}
        onClick={handleOpenFile}
      >
        {t('LocalFile.action.open')}
      </Button>
      <Button
        icon={FolderOpen}
        size="small"
        title={t('LocalFile.action.showInFolder')}
        onClick={handleOpenFolder}
      >
        {t('LocalFile.action.showInFolder')}
      </Button>
    </Flexbox>
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
