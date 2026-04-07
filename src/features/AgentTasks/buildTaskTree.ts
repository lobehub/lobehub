export interface TaskTreeNode {
  children: TaskTreeNode[];
  identifier: string;
  name: string | null;
  status: string;
}

interface FlatTaskItem {
  id?: string;
  identifier?: string;
  name?: string | null;
  // raw SQL returns snake_case, Drizzle select returns camelCase
  parent_task_id?: string | null;
  parentTaskId?: string | null;
  sort_order?: number | null;
  sortOrder?: number | null;
  status?: string;
}

/**
 * Build a nested tree from the flat array returned by getTaskTree API.
 * Handles both camelCase (Drizzle select) and snake_case (raw SQL) field names.
 */
export function buildTaskTree(flatItems: FlatTaskItem[], rootTaskId: string): TaskTreeNode[] {
  // Normalize field names (handle snake_case from raw SQL)
  const normalized = flatItems.map((item) => ({
    id: item.id ?? '',
    identifier: item.identifier ?? '',
    name: item.name ?? null,
    parentTaskId: item.parentTaskId ?? item.parent_task_id ?? null,
    sortOrder: item.sortOrder ?? item.sort_order ?? 0,
    status: item.status ?? 'backlog',
  }));

  // Group children by parentTaskId
  const childrenMap = new Map<string, typeof normalized>();
  for (const item of normalized) {
    if (!item.parentTaskId) continue;
    const list = childrenMap.get(item.parentTaskId) ?? [];
    list.push(item);
    childrenMap.set(item.parentTaskId, list);
  }

  // Sort children by sortOrder
  for (const children of childrenMap.values()) {
    children.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  }

  // Recursively build tree from a parent's id
  const buildChildren = (parentId: string): TaskTreeNode[] => {
    const children = childrenMap.get(parentId);
    if (!children) return [];
    return children.map((child) => ({
      children: buildChildren(child.id),
      identifier: child.identifier,
      name: child.name,
      status: child.status,
    }));
  };

  return buildChildren(rootTaskId);
}

/** Count all nodes in a tree (recursive) */
export function countTreeNodes(nodes: TaskTreeNode[]): { completed: number; total: number } {
  let total = 0;
  let completed = 0;
  const walk = (list: TaskTreeNode[]) => {
    for (const node of list) {
      total++;
      if (node.status === 'completed') completed++;
      walk(node.children);
    }
  };
  walk(nodes);
  return { completed, total };
}
