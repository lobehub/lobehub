import { useToolRenderCapabilities } from '@lobechat/shared-tool-ui';
import type { ReadFileState } from '@lobechat/tool-runtime';
import { Flexbox, Image, Markdown, PreviewGroup, SyntaxHighlighter } from '@lobehub/ui';
import { ActionIcon, Text } from '@lobehub/ui/base-ui';
import { createStaticStyles } from 'antd-style';
import { ExternalLink, FolderOpen, SquareArrowOutUpRight } from 'lucide-react';
import type { CSSProperties } from 'react';
import React, { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { InlineHtmlPreview, isHtmlFile } from '@/components/HtmlPreview';
import { useOpenEditedFile } from '@/features/Conversation/Messages/EditedFilesCard/useOpenEditedFile';

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
  image: css`
    border-radius: ${cssVar.borderRadiusLG};
  `,
  imageList: css`
    flex-wrap: wrap;
  `,
  // Gutter drawn with a CSS counter on shiki's `.line` spans, so the numbers
  // never get copied along with the code. `&&` outranks the highlighter's own
  // `.line` padding.
  lineNumbers: css`
    && pre code {
      counter-reset: read-file-line var(--read-file-line-offset);
    }

    && pre code .line {
      counter-increment: read-file-line;
      position: relative;
      padding-inline-start: calc(var(--read-file-gutter) + 16px + 12px);
    }

    && pre code .line::before {
      content: counter(read-file-line);
      user-select: none;

      position: absolute;
      inset-inline-start: 16px;

      width: var(--read-file-gutter);

      color: ${cssVar.colorTextQuaternary};
      text-align: end;
    }

    /* Blank lines render as empty spans; give them a line box so they keep
       their row and number. */
    && pre code .line:empty::after {
      content: ' ';
    }
  `,
  // Shrinks to its text so the hover actions sit right after the path.
  path: css`
    flex: 0 1 auto;

    min-width: 0;
    padding-inline: 4px;

    font-size: 12px;
    color: ${cssVar.colorTextSecondary};
  `,
  previewBox: css`
    position: relative;

    overflow: hidden;

    padding-block: 0;
    padding-inline: 8px;
    border-radius: 8px;

    background: ${cssVar.colorBgContainer};
  `,
}));

interface ReadFileViewProps extends ReadFileState {
  /** 1-based number of the first line in `content`, seeds the gutter. */
  firstLineNumber?: number;
  /** The file lives in the cloud sandbox rather than on a local filesystem. */
  sandboxBacked?: boolean;
}

const ReadFileView = memo<ReadFileViewProps>(
  ({
    filename: filenameProp,
    path,
    fileType,
    content,
    images,
    firstLineNumber = 1,
    sandboxBacked = false,
  }) => {
    const { t } = useTranslation('tool');
    const { openFile, openFolder, displayRelativePath } = useToolRenderCapabilities();
    const resolveOpenInPanel = useOpenEditedFile();
    const filename = filenameProp || path.split('/').pop() || path;

    // A file's trailing newline is not a line of its own.
    const code = useMemo(() => content.replace(/\n+$/, ''), [content]);

    const lineNumberVars = useMemo(() => {
      const lastLine = firstLineNumber + code.split('\n').length - 1;
      return {
        '--read-file-gutter': `${String(lastLine).length}ch`,
        '--read-file-line-offset': firstLineNumber - 1,
      } as CSSProperties;
    }, [code, firstLineNumber]);

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
    const isMarkdown = fileType === 'md';

    const openInPanel = resolveOpenInPanel({ kind: 'modified', path, sandboxBacked });

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

    // The inspector header already names the file, so the card only carries its path.
    return (
      <Flexbox className={styles.container} gap={8}>
        <Flexbox horizontal align={'center'} gap={4}>
          <Text ellipsis className={styles.path} title={path} type={'secondary'}>
            {displayPath}
          </Text>
          {(openInPanel || handleOpenFile || handleOpenFolder) && (
            <Flexbox
              horizontal
              className={`${styles.actions} local-file-actions`}
              flex={'none'}
              gap={2}
            >
              {openInPanel && (
                <ActionIcon
                  icon={SquareArrowOutUpRight}
                  size="small"
                  title={t('localFiles.openInPanel')}
                  onClick={(e) => {
                    e.stopPropagation();
                    openInPanel();
                  }}
                />
              )}
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

        <Flexbox
          className={styles.previewBox}
          style={{ height: isHtml ? 240 : undefined, maxHeight: 240 }}
        >
          {isHtml ? (
            <InlineHtmlPreview content={content} />
          ) : isMarkdown ? (
            <Markdown style={{ overflow: 'auto' }}>{content}</Markdown>
          ) : (
            // The bare highlighter: `Highlighter` trims its input, which would
            // strip the first line's indentation and misalign the gutter.
            <SyntaxHighlighter
              className={styles.lineNumbers}
              language={fileType || 'text'}
              style={{ ...lineNumberVars, overflow: 'auto' }}
              variant={'borderless'}
            >
              {code}
            </SyntaxHighlighter>
          )}
        </Flexbox>
      </Flexbox>
    );
  },
);

export default ReadFileView;
