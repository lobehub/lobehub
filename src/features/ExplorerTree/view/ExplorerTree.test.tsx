import { act, fireEvent, render, waitFor } from '@testing-library/react';
import { useRef } from 'react';
import { describe, expect, it, vi } from 'vitest';

import type { ExplorerTreeHandle } from '../types';
import ExplorerTree, { getItemPathFromEventPath } from './ExplorerTree';

const showContextMenu = vi.hoisted(() => vi.fn());

vi.mock('@lobehub/ui', () => ({
  showContextMenu,
}));

describe('ExplorerTree', () => {
  it('commits folder renames through the canonical adapter path', async () => {
    let handleRef: React.RefObject<ExplorerTreeHandle | null>;
    const onCommitRename = vi.fn();

    function TestWrapper() {
      handleRef = useRef<ExplorerTreeHandle>(null);
      return (
        <ExplorerTree
          nodes={[{ id: 'folder', isFolder: true, name: 'Notes', parentId: null }]}
          ref={handleRef}
          onCommitRename={onCommitRename}
        />
      );
    }

    const { container } = render(<TestWrapper />);

    act(() => {
      handleRef.current?.startRenaming('folder');
    });

    const host = container.querySelector('file-tree-container');

    await waitFor(() => {
      expect(host?.shadowRoot?.querySelector('[data-item-rename-input]')).toBeInstanceOf(
        HTMLInputElement,
      );
    });

    const input = host?.shadowRoot?.querySelector('[data-item-rename-input]');
    expect(input).toBeInstanceOf(HTMLInputElement);

    fireEvent.input(input!, { target: { value: 'Archive' } });
    fireEvent.blur(input!);

    expect(onCommitRename).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'folder', isFolder: true }),
      'Archive',
    );
  });

  it('resolves the clicked segment inside a flattened directory row', () => {
    const parentSegment = document.createElement('span');
    parentSegment.setAttribute('data-item-flattened-subitem', 'Parent/');

    const childSegment = document.createElement('span');
    childSegment.setAttribute('data-item-flattened-subitem', 'Parent/Child/');

    const row = document.createElement('button');
    row.dataset.type = 'item';
    row.dataset.itemPath = 'Parent/Child/';

    expect(getItemPathFromEventPath([parentSegment, row])).toBe('Parent/');
    expect(getItemPathFromEventPath([childSegment, row])).toBe('Parent/Child/');
    expect(getItemPathFromEventPath([row])).toBe('Parent/Child/');
  });
});
