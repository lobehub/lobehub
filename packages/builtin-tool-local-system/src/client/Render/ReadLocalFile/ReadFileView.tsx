import { useToolRenderCapabilities } from '@lobechat/shared-tool-ui';
import type { ReadFileState } from '@lobechat/tool-runtime';
import { Flexbox, Image, Markdown, PreviewGroup } from '@lobehub/ui';
import { ActionIcon, Text } from '@lobehub/ui/base-ui';
import { createStaticStyles } from 'antd-style';
import { ExternalLink, FolderOpen } from 'lucide-react';
import React, { memo } from 'react';
import { useTranslation } from 'react-i18next';

import FileIcon from '@/components/FileIcon';
import { InlineHtmlPreview, isHtmlFile } from '@/components/HtmlPreview';

const styles = createStaticStyles(({ css, cssVar }) => ({
  actions: css`
    cursor: pointer;
    color: ${cssVar.colorTextTertiary};
    opacity: 0;
    transition: opacity 0.2s ${cssVar.motionEaseInOut};
  `,
  container: css`
    justify-content: space-between;

    .local-file-actions {
      opacity: 0;
    }

    &:hover .local-file-actions {
      opacity: 1;
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
  image: css`
    border-radius: ${cssVar.borderRadiusLG};
  `,
  imageList: css`
    flex-wrap: wrap;
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

const ReadFileView = memo<ReadFileState>(
  ({ filename: filenameProp, path, fileType, content, images }) => {
    const { t } = useTranslation('tool');
    const { openFile, openFolder, displayRelativePath } = useToolRenderCapabilities();
    const filename = filenameProp || path.split('/').pop() || path;

    // Reading an image is best shown as the image itself: no card, no header, no path.
    if (images && images.length > 0) {
      return (
        <PreviewGroup>
          <Flexbox horizontal align={'flex-start'} className={styles.imageList} gap={8}>
            {images.map((image, index) => (
              <Image
                alt={filename || image.mediaType || ''}
                className={styles.image}
                key={image.url || index}
                maxHeight={600}
                objectFit={'contain'}
                src={image.url}
                variant={'outlined'}
              />
            ))}
          </Flexbox>
        </PreviewGroup>
      );
    }

    const isHtml = isHtmlFile({ fileName: filename, fileType, path });

    const handleOpenFile = openFile
      ? (e: React.MouseEvent) => {
          e.stopPropagation();
          openFile(path);
        }
      : undefined;

    const handleOpenFolder = openFolder
      ? (e: React.MouseEvent) => {
          e.stopPropagation();
          openFolder(path);
        }
      : undefined;

    const displayPath = displayRelativePath ? displayRelativePath(path) : path;

    return (
      <Flexbox className={styles.container} gap={8}>
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
                {(handleOpenFile || handleOpenFolder) && (
                  <Flexbox
                    horizontal
                    className={`${styles.actions} local-file-actions`}
                    gap={2}
                    style={{ marginLeft: 8 }}
                  >
                    {handleOpenFile && (
                      <ActionIcon
                        icon={ExternalLink}
                        size="small"
                        title={t('localFiles.openFile')}
                        onClick={handleOpenFile}
                      />
                    )}
                    {handleOpenFolder && (
                      <ActionIcon
                        icon={FolderOpen}
                        size="small"
                        title={t('localFiles.openFolder')}
                        onClick={handleOpenFolder}
                      />
                    )}
                  </Flexbox>
                )}
              </Flexbox>
            </Flexbox>
          </Flexbox>

          <Text ellipsis className={styles.path} type={'secondary'}>
            {displayPath}
          </Text>
        </Flexbox>

        <Flexbox
          className={styles.previewBox}
          style={{ height: isHtml ? 240 : undefined, maxHeight: 240 }}
        >
          {isHtml ? (
            <InlineHtmlPreview content={content} />
          ) : fileType === 'md' ? (
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
