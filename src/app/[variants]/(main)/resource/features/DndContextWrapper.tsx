'use client';

import { Icon } from '@lobehub/ui';
import { App } from 'antd';
import { cssVar } from 'antd-style';
import { FileText, FolderIcon } from 'lucide-react';
import { type PropsWithChildren } from 'react';
import { createContext, memo, use, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

import FileIcon from '@/components/FileIcon';
import { clearTreeFolderCache } from '@/features/ResourceManager/components/LibraryHierarchy';
import { useFileStore } from '@/store/file';

import { useResourceManagerStore } from './store';

/**
 * Pre-create a transparent 1x1 pixel image for drag operations
 * This ensures the image is loaded and ready when setDragImage is called
 */
let transparentDragImage: HTMLImageElement | null = null;

if (typeof globalThis.window !== 'undefined') {
  transparentDragImage = new Image();
  transparentDragImage.src =
    'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
}

/**
 * Get the pre-loaded transparent drag image
 * Use this in setDragImage to prevent browser default drag icons
 */
export const getTransparentDragImage = () => transparentDragImage;

/**
 * Context to track if drag is currently active
 * Used to optimize droppable zones - only activate them during active drag
 */
const DragActiveContext = createContext<boolean>(false);

/**
 * Hook to check if drag is currently active
 * Use this to conditionally enable droppable zones for performance optimization
 */
export const useDragActive = () => use(DragActiveContext);

interface DragState {
  data: any;
  id: string;
  type: 'file' | 'folder';
}

const DragStateContext = createContext<{
  currentDrag: DragState | null;

  setCurrentDrag: (_state: DragState | null) => void;
}>({
  currentDrag: null,
  setCurrentDrag: () => {},
});

export const useDragState = () => use(DragStateContext);

/**
 * Pragmatic DnD wrapper for resource drag-and-drop
 * Much more performant than dnd-kit for large virtualized lists
 */
export const DndContextWrapper = memo<PropsWithChildren>(({ children }) => {
  const { t } = useTranslation('components');
  const { message } = App.useApp();
  const [currentDrag, setCurrentDrag] = useState<DragState | null>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const moveResource = useFileStore((s) => s.moveResource);
  const resourceList = useFileStore((s) => s.resourceList);
  const selectedFileIds = useResourceManagerStore((s) => s.selectedFileIds);
  const setSelectedFileIds = useResourceManagerStore((s) => s.setSelectedFileIds);
  const libraryId = useResourceManagerStore((s) => s.libraryId);

  // Track mouse position and handle drag events
  useEffect(() => {
    const handleDragStart = (event: DragEvent) => {
      // Set initial position directly on DOM element
      if (overlayRef.current) {
        overlayRef.current.style.left = `${event.clientX + 12}px`;
        overlayRef.current.style.top = `${event.clientY + 12}px`;
      }
    };

    const handleDrag = (event: DragEvent) => {
      // Update position directly on DOM element (no React re-render!)
      // clientX/Y are 0 on dragend, so check for that
      if (overlayRef.current && (event.clientX !== 0 || event.clientY !== 0)) {
        overlayRef.current.style.left = `${event.clientX + 12}px`;
        overlayRef.current.style.top = `${event.clientY + 12}px`;
      }
    };

    const handleDrop = async (event: DragEvent) => {
      event.preventDefault();

      if (!currentDrag) return;

      // Find the drop target by traversing up the DOM tree
      let dropTarget = event.target as HTMLElement;
      let targetId: string | undefined;
      let isFolder = false;
      let isRootDrop = false;

      // Traverse up to find element with data-drop-target-id
      while (dropTarget && dropTarget !== document.body) {
        const dataset = dropTarget.dataset;
        if (dataset.dropTargetId) {
          targetId = dataset.dropTargetId;
          isFolder = dataset.isFolder === 'true';
          isRootDrop = dataset.rootDrop === 'true';
          break;
        }
        dropTarget = dropTarget.parentElement as HTMLElement;
      }

      if (!isFolder && !isRootDrop) {
        setCurrentDrag(null);
        return;
      }

      const targetParentId = isRootDrop ? null : (targetId ?? null);
      const isDraggingSelection = selectedFileIds.includes(currentDrag.id);
      const itemsToMove = isDraggingSelection ? selectedFileIds : [currentDrag.id];

      // Prevent dropping into itself
      if (!isRootDrop && targetParentId && itemsToMove.includes(targetParentId)) {
        setCurrentDrag(null);
        return;
      }

      setCurrentDrag(null);

      // Show loading toast
      const hideLoading = message.loading(t('FileManager.actions.moving'), 0);

      try {
        // Move all items using optimistic moveResource
        const pools = itemsToMove.map((id) => moveResource(id, targetParentId));

        await Promise.all(pools);

        // Refetch resources to update the view (items should disappear from current folder)
        const { revalidateResources } = await import('@/store/file/slices/resource/hooks');
        await revalidateResources();

        // Clear and reload all expanded folders in Tree's module-level cache
        if (libraryId) {
          await clearTreeFolderCache(libraryId);
        }

        // Hide loading and show success
        hideLoading();
        message.success(t('FileManager.actions.moveSuccess'));

        if (isDraggingSelection) {
          setSelectedFileIds([]);
        }
      } catch (error) {
        console.error('Failed to move file:', error);
        // Hide loading and show error
        hideLoading();
        message.error(t('FileManager.actions.moveError'));
      }
    };

    const handleDragOver = (event: DragEvent) => {
      event.preventDefault();
    };

    const handleDragEnd = () => {
      // Always clear drag state when drag ends, regardless of drop success
      // This ensures the overlay disappears immediately
      setCurrentDrag(null);
    };

    document.addEventListener('dragstart', handleDragStart);
    document.addEventListener('drag', handleDrag);
    // Use capture phase so drops still work even if some UI stops propagation
    // (e.g., header dropdowns / menus).
    document.addEventListener('drop', handleDrop, true);
    document.addEventListener('dragover', handleDragOver);
    document.addEventListener('dragend', handleDragEnd);

    return () => {
      document.removeEventListener('dragstart', handleDragStart);
      document.removeEventListener('drag', handleDrag);
      document.removeEventListener('drop', handleDrop, true);
      document.removeEventListener('dragover', handleDragOver);
      document.removeEventListener('dragend', handleDragEnd);
    };
  }, [
    currentDrag,
    selectedFileIds,
    resourceList,
    moveResource,
    setSelectedFileIds,
    message,
    t,
    libraryId,
  ]);

  // Change cursor to grabbing during drag
  useEffect(() => {
    let styleElement: HTMLStyleElement | null = null;

    if (currentDrag) {
      // Inject global style to ensure grabbing cursor shows everywhere
      styleElement = document.createElement('style');
      styleElement.id = 'drag-cursor-override';
      styleElement.textContent = `
        * {
          cursor: grabbing !important;
          user-select: none !important;
        }
      `;
      document.head.append(styleElement);
    }

    return () => {
      // Remove the style element when drag ends
      if (styleElement && styleElement.parentNode) {
        styleElement.remove();
      }
      // Also clean up any existing style element by ID
      const existingStyle = document.getElementById('drag-cursor-override');
      if (existingStyle && existingStyle.parentNode) {
        existingStyle.remove();
      }
    };
  }, [currentDrag]);

  return (
    <DragActiveContext value={currentDrag !== null}>
      <DragStateContext value={{ currentDrag, setCurrentDrag }}>
        {children}
        {typeof document !== 'undefined' &&
          createPortal(
            currentDrag ? (
              <div
                ref={overlayRef}
                style={{
                  alignItems: 'center',
                  background: cssVar.colorBgElevated,
                  border: `1px solid ${cssVar.colorPrimaryBorder}`,
                  borderRadius: cssVar.borderRadiusLG,
                  boxShadow: cssVar.boxShadow,
                  display: 'flex',
                  gap: 12,
                  height: 44,
                  left: '-999px',
                  maxWidth: 320,
                  minWidth: 200,
                  padding: '0 12px',
                  pointerEvents: 'none',
                  position: 'fixed',
                  top: '-999px',
                  transform: 'translate3d(0, 0, 0)',
                  willChange: 'transform',
                  zIndex: 9999,
                }}
              >
                <div
                  style={{
                    alignItems: 'center',
                    color: cssVar.colorPrimary,
                    display: 'flex',
                    flexShrink: 0,
                    justifyContent: 'center',
                  }}
                >
                  {currentDrag.data.fileType === 'custom/folder' ? (
                    <Icon icon={FolderIcon} size={20} />
                  ) : currentDrag.data.fileType === 'custom/document' ? (
                    <Icon icon={FileText} size={20} />
                  ) : (
                    <FileIcon
                      fileName={currentDrag.data.name}
                      fileType={currentDrag.data.fileType}
                      size={20}
                    />
                  )}
                </div>
                <span
                  style={{
                    color: cssVar.colorText,
                    flex: 1,
                    fontSize: cssVar.fontSize,
                    fontWeight: 500,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {currentDrag.data.name}
                </span>
                {selectedFileIds.includes(currentDrag.id) && selectedFileIds.length > 1 && (
                  <div
                    style={{
                      alignItems: 'center',
                      background: cssVar.colorPrimary,
                      borderRadius: cssVar.borderRadiusSM,
                      color: cssVar.colorTextLightSolid,
                      display: 'flex',
                      flexShrink: 0,
                      fontSize: 12,
                      fontWeight: 600,
                      height: 22,
                      justifyContent: 'center',
                      minWidth: 22,
                      padding: '0 6px',
                    }}
                  >
                    {selectedFileIds.length}
                  </div>
                )}
              </div>
            ) : null,
            document.body,
          )}
      </DragStateContext>
    </DragActiveContext>
  );
});

DndContextWrapper.displayName = 'DndContextWrapper';
