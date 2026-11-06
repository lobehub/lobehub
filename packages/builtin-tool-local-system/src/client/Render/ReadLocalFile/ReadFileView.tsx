import { useToolRenderCapabilities } from '@lobechat/shared-tool-ui';
import type { ReadFileState } from '@lobechat/tool-runtime';
import {
  ActionIcon,
  // oxlint-disable-next-line stylex-migration/no-emotion-styles -- shiki .line spans inside SyntaxHighlighter get no className
  createStaticStyles,
  Flexbox,
  Image,
  Markdown,
  PreviewGroup,
  SyntaxHighlighter,
  Text,
} from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { ExternalLink, FolderOpen, SquareArrowOutUpRight } from 'lucide-react';
import type { CSSProperties } from 'react';
import React, { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { InlineHtmlPreview, isHtmlFile } from '@/components/HtmlPreview';
import { useOpenEditedFile } from '@/features/Conversation/Messages/EditedFilesCard/useOpenEditedFile';

import { stripFinalLineTerminator } from './buildReadFileState';
import { readFileMarker } from './marker.stylex';

const styles = stylex.create({
  actions: {
    cursor: 'pointer',
    color: cssVar.colorTextTertiary,
    opacity: { default: 0, [stylex.when.ancestor(':hover', readFileMarker)]: 1 },
    transitionProperty: 'opacity',
    transitionDuration: '0.2s',
    transitionTimingFunction: cssVar.motionEaseInOut,
  },
  container: {
    justifyContent: 'space-between',
  },
  image: {
    borderRadius: cssVar.borderRadiusLG,
  },
  imageList: {
    flexWrap: 'wrap',
  },
  path: {
    flexGrow: 0,
    flexShrink: 1,
    flexBasis: 'auto',
    minWidth: 0,
    paddingInline: '4px',
    fontSize: '12px',
    color: cssVar.colorTextSecondary,
  },
  previewBox: {
    position: 'relative',
    overflow: 'hidden',
    paddingBlock: 0,
    paddingInline: '8px',
    borderRadius: '8px',
    backgroundColor: cssVar.colorBgContainer,
    backgroundImage: 'none',
  },
});

const fallback = createStaticStyles(({ css, cssVar }) => ({
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

    const code = useMemo(() => stripFinalLineTerminator(content), [content]);

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
          <Flexbox
            horizontal
            align={'flex-start'}
            className={stylex.props(styles.imageList).className}
            gap={8}
          >
            {images.map((image, index) => (
              <Image
                alt={filename || image.mediaType || ''}
                className={stylex.props(styles.image).className}
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
      <Flexbox className={stylex.props(styles.container, readFileMarker).className} gap={8}>
        <Flexbox horizontal align={'center'} gap={4}>
          <Text
            ellipsis
            className={stylex.props(styles.path).className}
            title={path}
            type={'secondary'}
          >
            {displayPath}
          </Text>
          {(openInPanel || handleOpenFile || handleOpenFolder) && (
            <Flexbox
              horizontal
              className={stylex.props(styles.actions).className}
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
          className={stylex.props(styles.previewBox).className}
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
              className={fallback.lineNumbers}
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
