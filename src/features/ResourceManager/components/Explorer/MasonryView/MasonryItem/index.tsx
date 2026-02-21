import { Checkbox, showContextMenu, stopPropagation } from '@lobehub/ui';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  getTransparentDragImage,
  useDragActive,
  useDragState,
} from '@/app/[variants]/(main)/resource/features/DndContextWrapper';
import { documentService } from '@/services/document';
import { type FileListItem } from '@/types/files';

import { useFileItemClick } from '../../hooks/useFileItemClick';
import DropdownMenu from '../../ItemDropdown/DropdownMenu';
import { useFileItemDropdown } from '../../ItemDropdown/useFileItemDropdown';
import DefaultFileItem from './DefaultFileItem';
import ImageFileItem from './ImageFileItem';
import MarkdownFileItem from './MarkdownFileItem';
import NoteFileItem from './NoteFileItem';

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

// Custom note file type
const CUSTOM_NOTE_TYPE = 'custom/document';

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

// Helper function to extract text from editor's JSON format for preview
const extractTextFromEditorJSON = (editorData: any): string => {
  if (!editorData || !editorData.root || !editorData.root.children) {
    return '';
  }

  const extractFromNode = (node: any): string => {
    if (!node) return '';

    // If node has text, return it
    if (node.text) return node.text;

    // If node has children, recursively extract text
    if (node.children && Array.isArray(node.children)) {
      return node.children.map((child: any) => extractFromNode(child)).join('');
    }

    return '';
  };

  return editorData.root.children.map((node: any) => extractFromNode(node)).join('\n');
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
    url,
    name,
    fileType,
    id,
    selected,
    chunkingStatus,
    onSelectedChange,
    knowledgeBaseId,
    size,
    onOpen,
    metadata,
    sourceType,
    slug,
  }) => {
    const [markdownContent, setMarkdownContent] = useState<string>('');
    const [isLoadingMarkdown, setIsLoadingMarkdown] = useState(false);

    const isDragActive = useDragActive();
    const { setCurrentDrag } = useDragState();
    const [isDragging, setIsDragging] = useState(false);
    const [isOver, setIsOver] = useState(false);

    // Memoize computed values that don't change
    const computedValues = useMemo(
      () => ({
        isFolder: fileType === 'custom/folder',
        isImage: fileType && IMAGE_TYPES.has(fileType),
        isMarkdown: isMarkdownFile(name, fileType),
        isPage: isCustomPage(fileType, name),
      }),
      [fileType, name],
    );

    const { isImage, isMarkdown, isPage, isFolder } = computedValues;

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
        setCurrentDrag({
          data: dragData,
          id,
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

    // Fetch markdown content only when in viewport
    useEffect(() => {
      if ((isMarkdown || isPage) && isInView && !markdownContent) {
        setIsLoadingMarkdown(true);

        const fetchContent = async () => {
          try {
            let text: string;

            if (isPage) {
              // For custom pages, fetch from document service
              const page = await documentService.getDocumentById(id);
              const content = page?.content || '';

              // Try to parse as JSON (editor's native format) and convert to markdown for preview
              try {
                const editorData = JSON.parse(content);
                // Since we can't easily convert JSON to markdown here without an editor instance,
                // we'll extract plain text from the JSON structure for preview
                text = extractTextFromEditorJSON(editorData);
              } catch {
                // If it's not JSON, use it as-is (might be old markdown format)
                text = content;
              }
            } else if (url) {
              // For regular markdown files, fetch from URL
              const res = await fetch(url);
              text = await res.text();
            } else {
              text = '';
            }

            // For custom pages, take more content for better preview; for regular markdown, take first 500 chars
            const preview = isPage ? text.slice(0, 1000) : text.slice(0, 500);
            setMarkdownContent(preview);
          } catch (error) {
            console.error('Failed to fetch markdown content:', error);
            setMarkdownContent('');
          } finally {
            setIsLoadingMarkdown(false);
          }
        };

        fetchContent();
      }
    }, [isMarkdown, isPage, url, isInView, markdownContent, id]);

    const { menuItems } = useFileItemDropdown({
      fileType,
      filename: name,
      id,
      libraryId: knowledgeBaseId,
      sourceType,
      url,
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
          onPointerDown={stopPropagation}
          onClick={(e) => {
            e.stopPropagation();
            onSelectedChange(id, !selected);
          }}
        >
          <Checkbox checked={selected} />
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
            !isImage && !isMarkdown && !isPage && styles.contentWithPadding,
          )}
          onClick={handleItemClick}
        >
          {(() => {
            switch (true) {
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
                    id={id}
                    isInView={isInView}
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
                    embeddingError={embeddingError}
                    embeddingStatus={embeddingStatus ?? undefined}
                    fileType={fileType}
                    finishEmbedding={finishEmbedding}
                    id={id}
                    isLoadingMarkdown={isLoadingMarkdown}
                    markdownContent={markdownContent}
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
                    embeddingError={embeddingError}
                    embeddingStatus={embeddingStatus ?? undefined}
                    fileType={fileType}
                    finishEmbedding={finishEmbedding}
                    id={id}
                    isLoadingMarkdown={isLoadingMarkdown}
                    markdownContent={markdownContent}
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
                    id={id}
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
