type RevalidateParent = (parentId: string | null) => void | Promise<void>;
type MoveExternalItems = (ids: string[], parentId: string | null) => void | Promise<void>;

interface ResourceTreeBridgeBinding {
  moveExternalItems: MoveExternalItems;
  revalidateParent: RevalidateParent;
}

let currentBinding: ResourceTreeBridgeBinding | undefined;

export const bindResourceTreeBridge = (handlers: {
  moveExternalItems: MoveExternalItems;
  revalidateParent: RevalidateParent;
}) => {
  const binding = {
    moveExternalItems: handlers.moveExternalItems,
    revalidateParent: handlers.revalidateParent,
  };

  currentBinding = binding;

  return () => {
    if (currentBinding === binding) currentBinding = undefined;
  };
};

export const revalidateResourceTreeParent = (parentId: string | null) =>
  currentBinding?.revalidateParent(parentId);

export const moveExternalResourceTreeItems = (ids: string[], parentId: string | null) =>
  currentBinding?.moveExternalItems(ids, parentId);
