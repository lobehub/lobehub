import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  bindResourceTreeBridge,
  moveExternalResourceTreeItems,
  revalidateResourceTreeParent,
} from './resourceTreeBridge';

describe('resourceTreeBridge', () => {
  beforeEach(() => {
    bindResourceTreeBridge({
      moveExternalItems: vi.fn(),
      revalidateParent: vi.fn(),
    })();
  });

  it('forwards calls to the bound handlers', () => {
    const moveExternalItems = vi.fn();
    const revalidateParent = vi.fn();

    bindResourceTreeBridge({ moveExternalItems, revalidateParent });

    revalidateResourceTreeParent('folder-a');
    moveExternalResourceTreeItems(['file-a', 'file-b'], null);

    expect(revalidateParent).toHaveBeenCalledWith('folder-a');
    expect(moveExternalItems).toHaveBeenCalledWith(['file-a', 'file-b'], null);
  });

  it('only clears handlers that match the cleanup owner', () => {
    const firstMoveExternalItems = vi.fn();
    const firstRevalidateParent = vi.fn();
    const secondMoveExternalItems = vi.fn();
    const secondRevalidateParent = vi.fn();

    const cleanupFirst = bindResourceTreeBridge({
      moveExternalItems: firstMoveExternalItems,
      revalidateParent: firstRevalidateParent,
    });
    const cleanupSecond = bindResourceTreeBridge({
      moveExternalItems: secondMoveExternalItems,
      revalidateParent: secondRevalidateParent,
    });

    cleanupFirst();

    revalidateResourceTreeParent('folder-b');
    moveExternalResourceTreeItems(['file-c'], 'folder-b');

    expect(firstRevalidateParent).not.toHaveBeenCalled();
    expect(firstMoveExternalItems).not.toHaveBeenCalled();
    expect(secondRevalidateParent).toHaveBeenCalledWith('folder-b');
    expect(secondMoveExternalItems).toHaveBeenCalledWith(['file-c'], 'folder-b');

    cleanupSecond();

    revalidateResourceTreeParent('folder-c');
    moveExternalResourceTreeItems(['file-d'], 'folder-c');

    expect(secondRevalidateParent).toHaveBeenCalledTimes(1);
    expect(secondMoveExternalItems).toHaveBeenCalledTimes(1);
  });
});
