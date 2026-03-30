import { createStaticStyles, cx } from 'antd-style';
import type { ReactNode, RefObject } from 'react';
import type { VirtuosoHandle } from 'react-virtuoso';

import { styles } from './styles';
import { useExplorerDropZone } from './useExplorerDropZone';

interface ListViewDropZoneProps {
  children: ReactNode;
  currentFolderId: string | null;
  virtuosoRef: RefObject<VirtuosoHandle | null>;
}

const localStyles = createStaticStyles(({ css }) => ({
  container: css`
    position: relative;
    overflow: hidden;
  `,
}));

const ListViewDropZone = ({ children, currentFolderId, virtuosoRef }: ListViewDropZoneProps) => {
  const { containerRef, handleDragLeave, handleDragOver, handleDrop, isDropZoneActive } =
    useExplorerDropZone(virtuosoRef);

  return (
    <div
      data-drop-target-id={currentFolderId || undefined}
      data-is-folder="true"
      ref={containerRef}
      className={cx(
        localStyles.container,
        'list-view-drop-zone',
        styles.dropZone,
        isDropZoneActive && styles.dropZoneActive,
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
