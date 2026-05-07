'use client';

import { Icon, useAppElement } from '@lobehub/ui';
import { App } from 'antd';
import { cssVar } from 'antd-style';
import { FileText, FolderIcon } from 'lucide-react';
import { type PropsWithChildren } from 'react';
import { createContext, memo, use, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

import FileIcon from '@/components/FileIcon';
import { useTreeStore } from '@/store/tree';

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
  parentKey: string;
  type: 'file' | 'folder';
}

const CurrentDragContext = createContext<DragState | null>(null);
const SetCurrentDragContext = createContext<((_state: DragState | null) => void) | null>(null);

export const useCurrentDrag = () => use(CurrentDragContext);

export const useSetCurrentDrag = () => {
  const setCurrentDrag = use(SetCurrentDragContext);

  if (!setCurrentDrag) {
    throw new Error('useSetCurrentDrag must be used within DndContextWrapper');
  }

  return setCurrentDrag;
};

/**
 * Pragmatic DnD wrapper for resource drag-and-drop
 * Much more performant than dnd-kit for large virtualized lists
 */
export const DndContextWrapper = memo<PropsWithChildren>(({ children }) => {
  const { t } = useTranslation('components');
  const { message } = App.useApp();
  const [currentDrag, setCurrentDrag] = useState<DragState | null>(null);
  const currentDragRef = useRef<DragState | null>(null);
  currentDragRef.current = currentDrag;
  const overlayRef = useRef<HTMLDivElement>(null);
  const [selectedFileIds, setSelectedFileIds] = useResourceManagerStore((s) => [
    s.selectedFileIds,
    s.setSelectedFileIds,
  ]);
  const selectedFileIdsRef = useRef(selectedFileIds);
  selectedFileIdsRef.current = selectedFileIds;

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

    const handleDrop = (event: DragEvent) => {
      event.preventDefault();

      const drag = currentDragRef.current;
      if (!drag) return;

      let dropTarget = event.target as HTMLElement;
      let targetId: string | undefined;
      let isFolder = false;
      let isRootDrop = false;

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

      const toParent = isRootDrop ? '' : (targetId ?? '');
      const fromParent = drag.parentKey;
      const currentSelectedIds = selectedFileIdsRef.current;
      const isDraggingSelection = currentSelectedIds.includes(drag.id);
      const itemsToMove = isDraggingSelection ? currentSelectedIds : [drag.id];

      if (!isRootDrop && targetId && itemsToMove.includes(targetId)) {
        setCurrentDrag(null);
        return;
      }

      if (fromParent === toParent) {
        setCurrentDrag(null);
        return;
      }

      setCurrentDrag(null);

      const treeState = useTreeStore.getState();
      const movePromise = isDraggingSelection
        ? treeState.moveItems(itemsToMove, fromParent, toParent)
        : treeState.moveItem(drag.id, fromParent, toParent);

      movePromise.catch(() => {
        message.error(t('FileManager.actions.moveError'));
      });

      message.success(t('FileManager.actions.moveSuccess'));

      if (isDraggingSelection) {
        setSelectedFileIds([]);
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
  }, [setCurrentDrag, setSelectedFileIds, message, t]);

  const appElement = useAppElement();

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
      <CurrentDragContext value={currentDrag}>
        <SetCurrentDragContext value={setCurrentDrag}>
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
              appElement ?? document.body,
            )}
        </SetCurrentDragContext>
      </CurrentDragContext>
    </DragActiveContext>
  );
});

DndContextWrapper.displayName = 'DndContextWrapper';
