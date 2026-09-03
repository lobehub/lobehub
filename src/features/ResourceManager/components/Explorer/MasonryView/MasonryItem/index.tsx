import {
  CUSTOM_DOCUMENT_FILE_TYPE,
  CUSTOM_FOLDER_FILE_TYPE,
  MARKDOWN_MIME_TYPES,
} from '@lobechat/const';
import { stopPropagation } from '@lobehub/ui';
import { Checkbox } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  getTransparentDragImage,
  useDragActive,
  useSetCurrentDrag,
} from '@/features/ResourceManager/DndContextWrapper';
import { showContextMenu } from '@/libs/contextMenu';
import { getChunkTargetId, useFileStore } from '@/store/file';
import { type FileListItem } from '@/types/files';

import { useFileItemClick } from '../../hooks/useFileItemClick';
import DropdownMenu from '../../ItemDropdown/DropdownMenu';
import { useFileItemDropdown } from '../../ItemDropdown/useFileItemDropdown';
import AudioFileItem from './AudioFileItem';
import DefaultFileItem from './DefaultFileItem';
import ImageFileItem from './ImageFileItem';
import MarkdownFileItem from './MarkdownFileItem';
import NoteFileItem from './NoteFileItem';
import VideoFileItem from './VideoFileItem';
import WebpageFileItem from './WebpageFileItem';

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
const MARKDOWN_TYPES = new Set(MARKDOWN_MIME_TYPES);

// Custom note file type
const CUSTOM_NOTE_TYPE = CUSTOM_DOCUMENT_FILE_TYPE;

// Helper to check if filename ends with .md or is a custom note
const isMarkdownFile = (name: string, fileType?: string) => {
  return (
    name.toLowerCase().endsWith('.md') ||
    name.toLowerCase().endsWith('.markdown') ||
    (fileType && MARKDOWN_TYPES.has(fileType))
  );
};

// Helper to check if it's a custom page that should be rendered
// PDF and Office files should not be treated as pages even if they have fileType='custom/document'
const isCustomPage = (fileType?: string, name?: string) => {
  const lowerName = name?.toLowerCase();
  const isPDF = fileType?.toLowerCase() === 'pdf' || lowerName?.endsWith('.pdf');
  const isOfficeFile =
    lowerName?.endsWith('.xls') ||
    lowerName?.endsWith('.xlsx') ||
    lowerName?.endsWith('.doc') ||
    lowerName?.endsWith('.docx') ||
    lowerName?.endsWith('.ppt') ||
    lowerName?.endsWith('.pptx') ||
    lowerName?.endsWith('.odt');
  return !isPDF && !isOfficeFile && fileType === CUSTOM_NOTE_TYPE;
};

const styles = createStaticStyles(({ css }) => ({
  actions: css`
    opacity: 0;
    transition: opacity ${cssVar.motionDurationMid};
  `,
  card: css`
    cursor: pointer;

    position: relative;

    overflow: hidden;

    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};

    background: ${cssVar.colorBgContainer};

    transition: all ${cssVar.motionDurationMid};

    &:hover {
      border-color: ${cssVar.colorPrimary};
      box-shadow: ${cssVar.boxShadowTertiary};

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

    transition: opacity ${cssVar.motionDurationMid};
  `,
  content: css`
    position: relative;
  `,
  contentWithPadding: css`
    padding: 12px;
  `,
  dragOver: css`
    border-color: ${cssVar.colorText} !important;
    color: ${cssVar.colorBgElevated} !important;
    background-color: ${cssVar.colorText} !important;

    * {
      color: ${cssVar.colorBgElevated} !important;
    }
  `,
  dragging: css`
    will-change: transform;
    opacity: 0.5;
  `,
  dropdown: css`
    position: absolute;
    z-index: 2;
    inset-block-start: 8px;
    inset-inline-end: 8px;

    opacity: 0;

    transition: opacity ${cssVar.motionDurationMid};
  `,
  selected: css`
    border-color: ${cssVar.colorPrimary};
    background: ${cssVar.colorPrimaryBg};

    .checkbox {
      opacity: 1;
    }
  `,
}));

interface MasonryFileItemProps extends FileListItem {
  knowledgeBaseId?: string;
  onOpen?: (id: string) => void;
  onSelectedChange: (id: string, selected: boolean) => void;
  selectable?: boolean;
  selected?: boolean;
  slug?: string | null;
}

const MasonryFileItem = memo<MasonryFileItemProps>(
  ({
    chunkingError,
    embeddingError,
    embeddingStatus,
    finishEmbedding,
    chunkCount,
    contentPreview,
    url,
    name,
    fileType,
    fileId,
    id,
    selected,
    selectable = true,
    chunkingStatus,
    onSelectedChange,
    knowledgeBaseId,
    size,
    onOpen,
    metadata,
    sourceType,
    slug,
    userId,
    visibility,
  }) => {
    const { t } = useTranslation('components');
    const chunkTargetId = getChunkTargetId({ fileId, id });
    const isDragActive = useDragActive();
    const setCurrentDrag = useSetCurrentDrag();
    const [isDragging, setIsDragging] = useState(false);
    const [isOver, setIsOver] = useState(false);

    // Memoize computed values that don't change
    const computedValues = useMemo(
      () => ({
        isAudio: !!fileType?.startsWith('audio'),
        isFolder: fileType === CUSTOM_FOLDER_FILE_TYPE,
        isImage: fileType && IMAGE_TYPES.has(fileType),
        isMarkdown: isMarkdownFile(name, fileType),
        isPage: isCustomPage(fileType, name),
        isVideo: !!fileType?.startsWith('video'),
        // web clippings: article documents plus raw html captures
        isWebpage: fileType === 'article' || !!fileType?.startsWith('text/html'),
      }),
      [fileType, name],
    );

    const { isAudio, isImage, isMarkdown, isPage, isFolder, isVideo, isWebpage } = computedValues;

    // Use shared click handler hook
    const handleItemClick = useFileItemClick({
      id,
      isFolder,
      isPage,
      libraryId: knowledgeBaseId,
      onOpen,
      slug,
    });

    // Memoize drag data to prevent recreation
    const dragData = useMemo(
      () => ({
        fileType,
        isFolder,
        name,
        sourceType,
      }),
      [fileType, isFolder, name, sourceType],
    );

    // Native HTML5 drag event handlers
    const handleDragStart = useCallback(
      (e: React.DragEvent) => {
        if (!knowledgeBaseId) {
          e.preventDefault();
          return;
        }

        setIsDragging(true);
        const parentKey = useFileStore.getState().queryParams?.parentId ?? '';
        setCurrentDrag({
          data: dragData,
          id,
          parentKey,
          type: isFolder ? 'folder' : 'file',
        });

        // Set drag image to be transparent (we use custom overlay)
        const img = getTransparentDragImage();
        if (img) {
          e.dataTransfer.setDragImage(img, 0, 0);
        }
        e.dataTransfer.effectAllowed = 'move';
      },
      [knowledgeBaseId, dragData, id, isFolder, setCurrentDrag],
    );

    const handleDragEnd = useCallback(() => {
      setIsDragging(false);
    }, []);

    const handleDragOver = useCallback(
      (e: React.DragEvent) => {
        if (!isFolder || !isDragActive) return;

        e.preventDefault();
        e.stopPropagation();
        setIsOver(true);
      },
      [isFolder, isDragActive],
    );

    const handleDragLeave = useCallback(() => {
      setIsOver(false);
    }, []);

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
          rootMargin: '200px', // Increased margin to load content earlier
          threshold: 0.01, // Lower threshold for earlier triggering
        },
      );

      observer.observe(cardRef.current);

      return () => {
        observer.disconnect();
      };
    }, [isInView]);

    const { menuItems } = useFileItemDropdown({
      fileId,
      fileType,
      filename: name,
      id,
      libraryId: knowledgeBaseId,
      size,
      sourceType,
      url,
      userId,
      visibility,
    });

    return (
      <div
        data-drop-target-id={id}
        data-is-folder={isFolder}
        draggable={!!knowledgeBaseId}
        ref={cardRef}
        className={cx(
          styles.card,
          selected && styles.selected,
          isDragging && styles.dragging,
          isOver && styles.dragOver,
        )}
        onDragEnd={handleDragEnd}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDragStart={handleDragStart}
        onContextMenu={(e) => {
          e.preventDefault();
          showContextMenu(menuItems());
        }}
      >
        <div
          className={cx('checkbox', styles.checkbox)}
          style={{ cursor: selectable ? 'pointer' : 'not-allowed' }}
          title={selectable ? undefined : t('FileManager.selection.onlyOwn')}
          onPointerDown={stopPropagation}
          onClick={(e) => {
            e.stopPropagation();
            if (!selectable) return;
            onSelectedChange(id, !selected);
          }}
        >
          <Checkbox checked={selected} disabled={!selectable} />
        </div>

        <div
          className={cx('dropdown', styles.dropdown)}
          onClick={stopPropagation}
          onPointerDown={stopPropagation}
        >
          <DropdownMenu items={menuItems} />
        </div>

        <div
          className={cx(
            styles.content,
            !isImage &&
              !isMarkdown &&
              !isPage &&
              !isVideo &&
              !isAudio &&
              !isWebpage &&
              styles.contentWithPadding,
          )}
          onClick={handleItemClick}
        >
          {(() => {
            switch (true) {
              case isWebpage: {
                return <WebpageFileItem contentPreview={contentPreview} name={name} url={url} />;
              }
              case isVideo && !!url: {
                return <VideoFileItem isInView={isInView} name={name} size={size} url={url} />;
              }
              case isAudio && !!url: {
                return <AudioFileItem isInView={isInView} name={name} size={size} url={url} />;
              }
              case isImage && !!url: {
                return (
                  <ImageFileItem
                    chunkCount={chunkCount ?? undefined}
                    chunkingError={chunkingError}
                    chunkingStatus={chunkingStatus ?? undefined}
                    embeddingError={embeddingError}
                    embeddingStatus={embeddingStatus ?? undefined}
                    fileType={fileType}
                    finishEmbedding={finishEmbedding}
                    id={chunkTargetId}
                    isInView={isInView}
                    metadata={metadata}
                    name={name}
                    size={size}
                    url={url}
                  />
                );
              }
              case isPage: {
                return (
                  <NoteFileItem
                    chunkCount={chunkCount ?? undefined}
                    chunkingError={chunkingError}
                    chunkingStatus={chunkingStatus ?? undefined}
                    contentPreview={contentPreview}
                    embeddingError={embeddingError}
                    embeddingStatus={embeddingStatus ?? undefined}
                    fileType={fileType}
                    finishEmbedding={finishEmbedding}
                    id={chunkTargetId}
                    metadata={metadata}
                    name={name}
                  />
                );
              }
              case isMarkdown: {
                return (
                  <MarkdownFileItem
                    chunkCount={chunkCount ?? undefined}
                    chunkingError={chunkingError}
                    chunkingStatus={chunkingStatus ?? undefined}
                    contentPreview={contentPreview}
                    embeddingError={embeddingError}
                    embeddingStatus={embeddingStatus ?? undefined}
                    fileType={fileType}
                    finishEmbedding={finishEmbedding}
                    id={chunkTargetId}
                    name={name}
                    size={size}
                  />
                );
              }
              default: {
                return (
                  <DefaultFileItem
                    chunkCount={chunkCount ?? undefined}
                    chunkingError={chunkingError}
                    chunkingStatus={chunkingStatus ?? undefined}
                    embeddingError={embeddingError}
                    embeddingStatus={embeddingStatus ?? undefined}
                    fileType={fileType}
                    finishEmbedding={finishEmbedding}
                    id={chunkTargetId}
                    name={name}
                    size={size}
                  />
                );
              }
            }
          })()}
        </div>
      </div>
    );
  },
);

export default MasonryFileItem;
