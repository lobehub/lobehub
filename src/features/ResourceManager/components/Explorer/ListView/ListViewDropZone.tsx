import { cx } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import type { ReactNode, RefObject } from 'react';
import type { VirtuosoHandle } from 'react-virtuoso';

import { styles } from './styles';
import { useExplorerDropZone } from './useExplorerDropZone';

interface ListViewDropZoneProps {
  children: ReactNode;
  currentFolderId: string | null;
  virtuosoRef: RefObject<VirtuosoHandle | null>;
}

const ListViewDropZone = ({ children, currentFolderId, virtuosoRef }: ListViewDropZoneProps) => {
  const { containerRef, handleDragLeave, handleDragOver, handleDrop, isDropZoneActive } =
    useExplorerDropZone(virtuosoRef);

  return (
    <div
      data-drop-target-id={currentFolderId || undefined}
      data-is-folder="true"
      ref={containerRef}
      className={cx(
        stylex.props(styles.dropZone, isDropZoneActive && styles.dropZoneActive).className,
        'list-view-drop-zone',
      )}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {children}
    </div>
  );
};

export default ListViewDropZone;
