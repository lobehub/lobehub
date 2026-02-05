import type { LocalReadFileResult } from '@lobechat/electron-client-ipc';
import { ActionIcon, Flexbox, Icon, Markdown, Text } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { AlignLeft, Asterisk, ExternalLink, FolderOpen } from 'lucide-react';
import React, { memo } from 'react';
import { useTranslation } from 'react-i18next';

import FileIcon from '@/components/FileIcon';
import { localFileService } from '@/services/electron/localFileService';
import { useElectronStore } from '@/store/electron';
import { desktopStateSelectors } from '@/store/electron/selectors';

const styles = createStaticStyles(({ css, cssVar }) => ({
  actions: css`
    cursor: pointer;
    color: ${cssVar.colorTextTertiary};
    opacity: 0;
    transition: opacity 0.2s ${cssVar.motionEaseInOut};
  `,
  container: css`
    justify-content: space-between;

    padding: 8px;
    border-radius: ${cssVar.borderRadiusLG};

    background: ${cssVar.colorFillQuaternary};

    transition: all 0.2s ${cssVar.motionEaseInOut};

    .local-file-actions {
      opacity: 0;
    }

    &:hover {
      border-color: ${cssVar.colorBorder};

      .local-file-actions {
        opacity: 1;
      }
    }
  `,
  fileName: css`
    flex: 1;
    margin-inline-start: 8px;
    color: ${cssVar.colorTextSecondary};

    &:hover {
      color: ${cssVar.colorText};
    }
  `,
  header: css`
    cursor: pointer;
  `,
  lineCount: css`
    color: ${cssVar.colorTextQuaternary};
  `,
  meta: css`
    font-size: 12px;
    color: ${cssVar.colorTextTertiary};
  `,
  path: css`
    margin-block-start: 4px;
    padding-inline: 4px;

    font-size: 12px;
    color: ${cssVar.colorTextSecondary};
    word-break: break-all;
  `,
  previewBox: css`
    position: relative;

    overflow: hidden;

    padding-block: 0;
    padding-inline: 8px;
    border-radius: 8px;

    background: ${cssVar.colorBgContainer};
  `,
  previewText: css`
    overflow: auto;

    font-family: ${cssVar.fontFamilyCode};
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
      <Flexbox className={styles.container} gap={12}>
        <Flexbox>
          <Flexbox
            horizontal
            align={'center'}
            className={styles.header}
            gap={12}
            justify={'space-between'}
          >
            <Flexbox horizontal align={'center'} flex={1} gap={0} style={{ overflow: 'hidden' }}>
              <FileIcon fileName={filename} fileType={fileType} size={16} variant={'raw'} />
              <Flexbox horizontal>
                <Text ellipsis className={styles.fileName}>
                  {filename}
                </Text>
                {/* Actions on Hover */}
                <Flexbox horizontal className={styles.actions} gap={2} style={{ marginLeft: 8 }}>
                  <ActionIcon
                    icon={ExternalLink}
                    size="small"
                    title={t('localFiles.openFile')}
                    onClick={handleOpenFile}
                  />
                  <ActionIcon
                    icon={FolderOpen}
                    size="small"
                    title={t('localFiles.openFolder')}
                    onClick={handleOpenFolder}
                  />
                </Flexbox>
              </Flexbox>
            </Flexbox>
            <Flexbox horizontal align={'center'} className={styles.meta} gap={16}>
              <Flexbox horizontal align={'center'} gap={4}>
                <Icon icon={Asterisk} size={'small'} />
                <span>
                  {charCount} / <span className={styles.lineCount}>{totalCharCount}</span>
                </span>
              </Flexbox>
              <Flexbox horizontal align={'center'} gap={4}>
                <Icon icon={AlignLeft} size={'small'} />
                <span>
                  L{loc?.[0]}-{loc?.[1]} /{' '}
                  <span className={styles.lineCount}>{totalLineCount}</span>
                </span>
              </Flexbox>
            </Flexbox>
          </Flexbox>

          {/* Path */}
          <Text ellipsis className={styles.path} type={'secondary'}>
            {displayPath}
          </Text>
        </Flexbox>

        <Flexbox className={styles.previewBox} style={{ maxHeight: 240 }}>
          {fileType === 'md' ? (
            <Markdown style={{ overflow: 'auto' }}>{content}</Markdown>
          ) : (
            <div className={styles.previewText} style={{ width: '100%' }}>
              {content}
            </div>
          )}
        </Flexbox>
      </Flexbox>
    );
  },
);

export default ReadFileView;
