type RevalidateParent = (parentId: string | null) => void | Promise<void>;
type MoveExternalItems = (ids: string[], parentId: string | null) => void | Promise<void>;

let revalidateParentRef: RevalidateParent | undefined;
let moveExternalItemsRef: MoveExternalItems | undefined;

export const bindResourceTreeBridge = (handlers: {
  moveExternalItems: MoveExternalItems;
  revalidateParent: RevalidateParent;
}) => {
  revalidateParentRef = handlers.revalidateParent;
  moveExternalItemsRef = handlers.moveExternalItems;

  return () => {
    if (revalidateParentRef === handlers.revalidateParent) revalidateParentRef = undefined;
    if (moveExternalItemsRef === handlers.moveExternalItems) moveExternalItemsRef = undefined;
  };
};

export const revalidateResourceTreeParent = (parentId: string | null) =>
  revalidateParentRef?.(parentId);

export const moveExternalResourceTreeItems = (ids: string[], parentId: string | null) =>
  moveExternalItemsRef?.(ids, parentId);
