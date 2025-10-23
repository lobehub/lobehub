import { LocalReadFileResult } from '@lobechat/electron-client-ipc';
import { ActionIcon, Icon, Markdown, Text } from '@lobehub/ui';
import { createStyles } from 'antd-style';
import { AlignLeft, Asterisk, ChevronDownIcon, ExternalLink, FolderOpen } from 'lucide-react';
import React, { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';

import FileIcon from '@/components/FileIcon';
import { localFileService } from '@/services/electron/localFileService';
import { useElectronStore } from '@/store/electron';
import { desktopStateSelectors } from '@/store/electron/selectors';

const useStyles = createStyles(({ css, token, cx }) => ({
  actions: cx(
    'local-file-actions',
    css`
      cursor: pointer;
      color: ${token.colorTextTertiary};
      opacity: 0;
      transition: opacity 0.2s ${token.motionEaseInOut};
    `,
  ),
  container: css`
    justify-content: space-between;

    height: 64px;
    padding: 8px;
    border: 1px solid ${token.colorBorderSecondary};
    border-radius: ${token.borderRadiusLG}px;

    transition: all 0.2s ${token.motionEaseInOut};

    .local-file-actions {
      opacity: 0;
    }

    &:hover {
      border-color: ${token.colorBorder};

      .local-file-actions {
        opacity: 1;
      }
    }
  `,
  fileName: css`
    flex: 1;
    margin-inline-start: 8px;
    color: ${token.colorTextSecondary};

    &:hover {
      color: ${token.colorText};
    }
  `,
  header: css`
    cursor: pointer;
  `,
  lineCount: css`
    color: ${token.colorTextQuaternary};
  `,
  meta: cx(
    'local-file-actions',
    css`
      font-size: 12px;
      color: ${token.colorTextTertiary};
    `,
  ),
  path: css`
    margin-block-start: 4px;
    padding-inline: 4px;

    font-size: 12px;
    color: ${token.colorTextSecondary};
    word-break: break-all;
  `,
  previewBox: css`
    position: relative;

    overflow: hidden;

    margin-block-start: 8px;
    padding: 8px;
    border-radius: 8px;

    background: ${token.colorFillQuaternary};
  `,
  previewText: css`
    font-size: 12px;
    line-height: 1.6;
    word-break: break-all;
    white-space: pre-wrap;
  `,
}));

// Assuming the result object might include the original path and an optional warning
interface ReadFileViewProps extends LocalReadFileResult {
  path: string; // The full path requested
}

const ReadFileView = memo<ReadFileViewProps>(
  ({ filename, path, fileType, charCount, content, totalLineCount, totalCharCount, loc }) => {
    const { t } = useTranslation('tool');
    const { styles } = useStyles();
    const [isExpanded, setIsExpanded] = useState(false);

    const handleToggleExpand = () => {
      setIsExpanded(!isExpanded);
    };

    const handleOpenFile = (e: React.MouseEvent) => {
      e.stopPropagation();
      localFileService.openLocalFile({ path });
    };

    const handleOpenFolder = (e: React.MouseEvent) => {
      e.stopPropagation();
      localFileService.openLocalFolder({ isDirectory: false, path });
    };

    const displayPath = useElectronStore(desktopStateSelectors.displayRelativePath(path));

    return (
      <Flexbox className={styles.container}>
        <Flexbox
          align={'center'}
          className={styles.header}
          gap={12}
          horizontal
          justify={'space-between'}
          onClick={handleToggleExpand}
        >
          <Flexbox align={'center'} flex={1} gap={0} horizontal style={{ overflow: 'hidden' }}>
            <FileIcon fileName={filename} fileType={fileType} size={16} variant={'raw'} />
            <Flexbox horizontal>
              <Text className={styles.fileName} ellipsis>
                {filename}
              </Text>
              {/* Actions on Hover */}
              <Flexbox className={styles.actions} gap={2} horizontal style={{ marginLeft: 8 }}>
                <ActionIcon
                  icon={ExternalLink}
                  onClick={handleOpenFile}
                  size="small"
                  title={t('localFiles.openFile')}
                />
                <ActionIcon
                  icon={FolderOpen}
                  onClick={handleOpenFolder}
                  size="small"
                  title={t('localFiles.openFolder')}
                />
              </Flexbox>
            </Flexbox>
          </Flexbox>
          <Flexbox align={'center'} className={styles.meta} gap={8} horizontal>
            {isExpanded && (
              <Flexbox align={'center'} gap={4} horizontal>
                <Icon icon={Asterisk} size={'small'} />
                <span>
                  {charCount} / <span className={styles.lineCount}>{totalCharCount}</span>
                </span>
              </Flexbox>
            )}
            <Flexbox align={'center'} gap={4} horizontal>
              <Icon icon={AlignLeft} size={'small'} />
              {isExpanded ? (
                <span>
                  L{loc?.[0]}-{loc?.[1]} /{' '}
                  <span className={styles.lineCount}>{totalLineCount}</span>
                </span>
              ) : (
                <span>
                  L{loc?.[0]}-{loc?.[1]}
                </span>
              )}
            </Flexbox>
            <ActionIcon
              active={isExpanded}
              icon={ChevronDownIcon}
              onClick={handleToggleExpand}
              size="small"
              style={{
                transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)',
                transition: 'transform 0.2s',
              }}
            />
          </Flexbox>
        </Flexbox>

        {/* Path */}
        <Text className={styles.path} ellipsis type={'secondary'}>
          {displayPath}
        </Text>

        {isExpanded && (
          <Flexbox className={styles.previewBox} style={{ maxHeight: 240, overflow: 'auto' }}>
            {fileType === 'md' ? (
              <Markdown>{content}</Markdown>
            ) : (
              <div className={styles.previewText} style={{ width: '100%' }}>
                {content}
              </div>
            )}
          </Flexbox>
        )}
      </Flexbox>
    );
  },
);

export default ReadFileView;
