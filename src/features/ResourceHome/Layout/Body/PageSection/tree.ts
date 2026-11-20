interface TreeNode {
  id: string;
  parentId?: string | null;
}

export interface PageTreeRow<T extends TreeNode> {
  depth: number;
  doc: T;
}

/**
 * Flatten a page list into display rows: each page follows its parent, one
 * level deeper. A page whose parent is not in the list is a root. Input order
 * (most recently updated first) is kept among siblings.
 */
export const buildPageTree = <T extends TreeNode>(docs: T[]): PageTreeRow<T>[] => {
  const ids = new Set(docs.map((doc) => doc.id));
  const children = new Map<string, T[]>();
  const roots: T[] = [];

  for (const doc of docs) {
    if (doc.parentId && doc.parentId !== doc.id && ids.has(doc.parentId)) {
      const siblings = children.get(doc.parentId);
      if (siblings) siblings.push(doc);
      else children.set(doc.parentId, [doc]);
    } else {
      roots.push(doc);
    }
  }

  const rows: PageTreeRow<T>[] = [];
  const visited = new Set<string>();
  const visit = (doc: T, depth: number) => {
    // A parent cycle would otherwise recurse forever.
    if (visited.has(doc.id)) return;
    visited.add(doc.id);
    rows.push({ depth, doc });
    for (const child of children.get(doc.id) ?? []) visit(child, depth + 1);
  };
  for (const root of roots) visit(root, 0);
  // Pages caught in a parent cycle have no root; list them rather than drop them.
  for (const doc of docs) visit(doc, 0);

  return rows;
};
