import { Button, Tooltip } from '@lobehub/ui';
import { Checkbox, Image } from 'antd';
import { createStyles } from 'antd-style';
import { isNull } from 'lodash-es';
import { FileBoxIcon } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { memo, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';

import FileIcon from '@/components/FileIcon';
import { fileManagerSelectors, useFileStore } from '@/store/file';
import { FileListItem } from '@/types/files';
import { formatSize } from '@/utils/format';
import { isChunkingUnsupported } from '@/utils/isChunkingUnsupported';

import ChunksBadge from '../FileListItem/ChunkTag';
import DropdownMenu from '../FileListItem/DropdownMenu';

// Image file types
const IMAGE_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/gif',
  'image/webp',
  'image/svg+xml',
]);

// Markdown file types
const MARKDOWN_TYPES = new Set(['text/markdown', 'text/x-markdown']);

// Helper to check if filename ends with .md
const isMarkdownFile = (name: string, fileType?: string) => {
  return (
    name.toLowerCase().endsWith('.md') ||
    name.toLowerCase().endsWith('.markdown') ||
    (fileType && MARKDOWN_TYPES.has(fileType))
  );
};

const useStyles = createStyles(({ css, token }) => ({
  actions: css`
    opacity: 0;
    transition: opacity ${token.motionDurationMid};
  `,
  card: css`
    cursor: pointer;

    position: relative;

    overflow: visible;

    border: 1px solid ${token.colorBorderSecondary};
    border-radius: ${token.borderRadiusLG}px;

    background: ${token.colorBgContainer};

    transition: all ${token.motionDurationMid};

    &:hover {
      border-color: ${token.colorPrimary};
      box-shadow: ${token.boxShadowTertiary};

      .actions {
        opacity: 1;
      }

      .checkbox {
        opacity: 1;
      }

      .dropdown {
        opacity: 1;
      }

      .floatingChunkBadge {
        opacity: 1;
      }
    }
  `,
  checkbox: css`
    position: absolute;
    z-index: 2;
    inset-block-start: 8px;
    inset-inline-start: 8px;

    opacity: 0;

    transition: opacity ${token.motionDurationMid};
  `,
  content: css`
    position: relative;
  `,
  contentWithPadding: css`
    padding: 12px;
  `,
  dropdown: css`
    position: absolute;
    z-index: 2;
    inset-block-start: 8px;
    inset-inline-end: 8px;

    opacity: 0;

    transition: opacity ${token.motionDurationMid};
  `,
  floatingChunkBadge: css`
    position: absolute;
    z-index: 3;
    inset-block-end: 8px;
    inset-inline-end: 8px;

    padding-block: 4px;
    padding-inline: 8px;
    border-radius: ${token.borderRadius}px;

    opacity: 0;
    background: ${token.colorBgContainer};
    box-shadow: ${token.boxShadow};

    transition: opacity ${token.motionDurationMid};
  `,
  hoverOverlay: css`
    position: absolute;
    z-index: 1;
    inset: 0;

    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;

    padding: 16px;
    border-radius: ${token.borderRadiusLG}px;

    opacity: 0;
    background: ${token.colorBgMask};

    transition: opacity ${token.motionDurationMid};

    &:hover {
      opacity: 1;
    }
  `,
  iconWrapper: css`
    display: flex;
    align-items: center;
    justify-content: center;

    height: 120px;
    margin-block-end: 12px;
    border-radius: ${token.borderRadius}px;

    background: ${token.colorFillQuaternary};
  `,
  imagePlaceholder: css`
    display: flex;
    align-items: center;
    justify-content: center;

    min-height: 120px;

    background: ${token.colorFillQuaternary};
  `,
  imageWrapper: css`
    position: relative;

    overflow: hidden;

    width: 100%;
    border-radius: ${token.borderRadiusLG}px;

    background: ${token.colorFillQuaternary};

    img {
      display: block;
      width: 100%;
      height: auto;
    }
  `,
  markdownLoading: css`
    display: flex;
    align-items: center;
    justify-content: center;

    min-height: 120px;
    border-radius: ${token.borderRadiusLG}px;

    font-size: 12px;
    color: ${token.colorTextTertiary};

    background: ${token.colorFillQuaternary};
  `,
  markdownPreview: css`
    position: relative;

    overflow: hidden;

    width: 100%;
    min-height: 120px;
    max-height: 300px;
    padding: 16px;
    border-radius: ${token.borderRadiusLG}px;

    font-size: 13px;
    line-height: 1.6;
    color: ${token.colorTextSecondary};
    word-wrap: break-word;
    white-space: pre-wrap;

    background: ${token.colorFillQuaternary};

    &::after {
      pointer-events: none;
      content: '';

      position: absolute;
      inset-block-end: 0;
      inset-inline: 0;

      height: 60px;

      background: linear-gradient(to bottom, transparent, ${token.colorFillQuaternary});
    }
  `,
  name: css`
    overflow: hidden;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;

    margin-block-end: 12px;

    font-weight: ${token.fontWeightStrong};
    color: ${token.colorText};
    word-break: break-word;
  `,
  overlaySize: css`
    font-size: 12px;
    color: ${token.colorTextLightSolid};
    opacity: 0.9;
  `,
  overlayTitle: css`
    overflow: hidden;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 3;

    max-width: 100%;
    margin-block-end: 8px;

    font-size: 14px;
    font-weight: ${token.fontWeightStrong};
    color: ${token.colorTextLightSolid};
    text-align: center;
    word-break: break-word;
  `,
  selected: css`
    border-color: ${token.colorPrimary};
    background: ${token.colorPrimaryBg};

    .checkbox {
      opacity: 1;
    }
  `,
}));

interface MasonryFileItemProps extends FileListItem {
  knowledgeBaseId?: string;
  onSelectedChange: (id: string, selected: boolean) => void;
  selected?: boolean;
}

const MasonryFileItem = memo<MasonryFileItemProps>(
  ({
    chunkingError,
    embeddingError,
    embeddingStatus,
    finishEmbedding,
    chunkCount,
    url,
    name,
    fileType,
    id,
    selected,
    chunkingStatus,
    onSelectedChange,
    knowledgeBaseId,
    size,
  }) => {
    const { t } = useTranslation('components');
    const { styles, cx } = useStyles();
    const router = useRouter();
    const [imageLoaded, setImageLoaded] = useState(false);
    const [markdownContent, setMarkdownContent] = useState<string>('');
    const [isLoadingMarkdown, setIsLoadingMarkdown] = useState(false);
    const [isCreatingFileParseTask, parseFiles] = useFileStore((s) => [
      fileManagerSelectors.isCreatingFileParseTask(id)(s),
      s.parseFilesToChunks,
    ]);

    const isSupportedForChunking = !isChunkingUnsupported(fileType);
    const isImage = fileType && IMAGE_TYPES.has(fileType);
    const isMarkdown = isMarkdownFile(name, fileType);

    const cardRef = useRef<HTMLDivElement>(null);
    const [isInView, setIsInView] = useState(false);

    // Use Intersection Observer to detect when card enters viewport
    useEffect(() => {
      if (!cardRef.current) return;

      const observer = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (entry.isIntersecting && !isInView) {
              setIsInView(true);
            }
          });
        },
        {
          rootMargin: '50px', // Start loading slightly before entering viewport
          threshold: 0.1,
        },
      );

      observer.observe(cardRef.current);

      return () => {
        observer.disconnect();
      };
    }, [isInView]);

    // Fetch markdown content only when in viewport
    useEffect(() => {
      if (isMarkdown && url && isInView && !markdownContent) {
        setIsLoadingMarkdown(true);
        fetch(url)
          .then((res) => res.text())
          .then((text) => {
            // Take first 500 characters for preview
            const preview = text.slice(0, 500);
            setMarkdownContent(preview);
          })
          .catch((error) => {
            console.error('Failed to fetch markdown content:', error);
            setMarkdownContent('');
          })
          .finally(() => {
            setIsLoadingMarkdown(false);
          });
      }
    }, [isMarkdown, url, isInView, markdownContent]);

    return (
      <div className={cx(styles.card, selected && styles.selected)} ref={cardRef}>
        <div
          className={cx('checkbox', styles.checkbox)}
          onClick={(e) => {
            e.stopPropagation();
            onSelectedChange(id, !selected);
          }}
        >
          <Checkbox checked={selected} />
        </div>

        <div className={cx('dropdown', styles.dropdown)} onClick={(e) => e.stopPropagation()}>
          <DropdownMenu filename={name} id={id} knowledgeBaseId={knowledgeBaseId} url={url} />
        </div>

        <div
          className={cx(styles.content, !isImage && !isMarkdown && styles.contentWithPadding)}
          onClick={() => {
            router.push(`/files/${id}`);
          }}
        >
          {isImage && url ? (
            <>
              <div className={styles.imageWrapper}>
                {!imageLoaded && (
                  <div className={styles.imagePlaceholder}>
                    <FileIcon fileName={name} fileType={fileType} size={64} />
                  </div>
                )}
                {isInView && (
                  <Image
                    alt={name}
                    loading="lazy"
                    onError={() => setImageLoaded(false)}
                    onLoad={() => setImageLoaded(true)}
                    preview={{
                      src: url,
                    }}
                    src={url}
                    style={{
                      display: 'block',
                      height: 'auto',
                      opacity: imageLoaded ? 1 : 0,
                      transition: 'opacity 0.3s',
                      width: '100%',
                    }}
                    wrapperStyle={{
                      display: 'block',
                      width: '100%',
                    }}
                  />
                )}
                {/* Hover overlay */}
                <div className={styles.hoverOverlay}>
                  <div className={styles.overlayTitle}>{name}</div>
                  <div className={styles.overlaySize}>{formatSize(size)}</div>
                </div>
              </div>
              {/* Floating chunk badge or action button */}
              {!isNull(chunkingStatus) && chunkingStatus ? (
                <div
                  className={cx('floatingChunkBadge', styles.floatingChunkBadge)}
                  onClick={(e) => e.stopPropagation()}
                >
                  <ChunksBadge
                    chunkCount={chunkCount}
                    chunkingError={chunkingError}
                    chunkingStatus={chunkingStatus}
                    embeddingError={embeddingError}
                    embeddingStatus={embeddingStatus}
                    finishEmbedding={finishEmbedding}
                    id={id}
                  />
                </div>
              ) : (
                isSupportedForChunking && (
                  <Tooltip title={t('FileManager.actions.chunkingTooltip')}>
                    <div
                      className={cx('floatingChunkBadge', styles.floatingChunkBadge)}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (!isCreatingFileParseTask) {
                          parseFiles([id]);
                        }
                      }}
                      style={{ cursor: 'pointer' }}
                    >
                      <Button
                        icon={FileBoxIcon}
                        loading={isCreatingFileParseTask}
                        size={'small'}
                        type={'text'}
                      />
                    </div>
                  </Tooltip>
                )
              )}
            </>
          ) : isMarkdown ? (
            <>
              <div style={{ position: 'relative' }}>
                {isLoadingMarkdown ? (
                  <div className={styles.markdownLoading}>Loading preview...</div>
                ) : markdownContent ? (
                  <div className={styles.markdownPreview}>{markdownContent}</div>
                ) : (
                  <div className={styles.iconWrapper}>
                    <FileIcon fileName={name} fileType={fileType} size={64} />
                  </div>
                )}
                {/* Hover overlay */}
                <div className={styles.hoverOverlay}>
                  <div className={styles.overlayTitle}>{name}</div>
                  <div className={styles.overlaySize}>{formatSize(size)}</div>
                </div>
              </div>
              {/* Floating chunk badge or action button */}
              {!isNull(chunkingStatus) && chunkingStatus ? (
                <div
                  className={cx('floatingChunkBadge', styles.floatingChunkBadge)}
                  onClick={(e) => e.stopPropagation()}
                >
                  <ChunksBadge
                    chunkCount={chunkCount}
                    chunkingError={chunkingError}
                    chunkingStatus={chunkingStatus}
                    embeddingError={embeddingError}
                    embeddingStatus={embeddingStatus}
                    finishEmbedding={finishEmbedding}
                    id={id}
                  />
                </div>
              ) : (
                isSupportedForChunking && (
                  <Tooltip title={t('FileManager.actions.chunkingTooltip')}>
                    <div
                      className={cx('floatingChunkBadge', styles.floatingChunkBadge)}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (!isCreatingFileParseTask) {
                          parseFiles([id]);
                        }
                      }}
                      style={{ cursor: 'pointer' }}
                    >
                      <Button
                        icon={FileBoxIcon}
                        loading={isCreatingFileParseTask}
                        size={'small'}
                        type={'text'}
                      />
                    </div>
                  </Tooltip>
                )
              )}
            </>
          ) : (
            <>
              <Flexbox
                align={'center'}
                gap={12}
                justify={'center'}
                paddingBlock={24}
                paddingInline={12}
                style={{ minHeight: 180 }}
              >
                <FileIcon fileName={name} fileType={fileType} size={64} />
                <div className={styles.name} style={{ textAlign: 'center' }}>
                  {name}
                </div>
                <div
                  style={{
                    color: 'var(--lobe-chat-text-tertiary)',
                    fontSize: 12,
                    textAlign: 'center',
                  }}
                >
                  {formatSize(size)}
                </div>
              </Flexbox>
              {/* Floating chunk badge or action button */}
              {!isNull(chunkingStatus) && chunkingStatus ? (
                <div
                  className={cx('floatingChunkBadge', styles.floatingChunkBadge)}
                  onClick={(e) => e.stopPropagation()}
                >
                  <ChunksBadge
                    chunkCount={chunkCount}
                    chunkingError={chunkingError}
                    chunkingStatus={chunkingStatus}
                    embeddingError={embeddingError}
                    embeddingStatus={embeddingStatus}
                    finishEmbedding={finishEmbedding}
                    id={id}
                  />
                </div>
              ) : (
                isSupportedForChunking && (
                  <Tooltip title={t('FileManager.actions.chunkingTooltip')}>
                    <div
                      className={cx('floatingChunkBadge', styles.floatingChunkBadge)}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (!isCreatingFileParseTask) {
                          parseFiles([id]);
                        }
                      }}
                      style={{ cursor: 'pointer' }}
                    >
                      <Button
                        icon={FileBoxIcon}
                        loading={isCreatingFileParseTask}
                        size={'small'}
                        type={'text'}
                      />
                    </div>
                  </Tooltip>
                )
              )}
            </>
          )}
        </div>
      </div>
    );
  },
);

export default MasonryFileItem;
