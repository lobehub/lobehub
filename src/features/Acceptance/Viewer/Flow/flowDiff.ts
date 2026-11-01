/** Compare authored definitions, never database identities or execution results. */
export interface FlowDefinitionSnapshot {
  edges: {
    edgeKey: string;
    sourceNodeKey: string;
    targetNodeKey: string;
    trigger: string;
    condition?: string | null;
    required: boolean;
  }[];
  entryNodeKey: string;
  nodes: { nodeKey: string; title: string; instruction: string; expected: string }[];
  title: string;
}

type FlowField =
  | 'title'
  | 'entryNodeKey'
  | 'instruction'
  | 'expected'
  | 'sourceNodeKey'
  | 'targetNodeKey'
  | 'trigger'
  | 'condition'
  | 'required';

export interface FlowChange {
  fields: { field: FlowField; before?: string; after?: string }[];
  key: string;
  kind: 'flow' | 'node' | 'edge';
  status: 'added' | 'removed' | 'modified';
  title: string;
}

export function diffFlowVersions(
  before: FlowDefinitionSnapshot,
  after: FlowDefinitionSnapshot,
): FlowChange[] {
  const changes: FlowChange[] = [];
  function compare<T>(
    kind: FlowChange['kind'],
    previous: T[],
    next: T[],
    keyOf: (item: T) => string,
    titleOf: (item: T) => string,
    fields: (keyof T & FlowField)[],
  ) {
    const oldItems = new Map(previous.map((item) => [keyOf(item), item]));
    const newItems = new Map(next.map((item) => [keyOf(item), item]));
    for (const key of new Set([...oldItems.keys(), ...newItems.keys()])) {
      const oldItem = oldItems.get(key);
      const newItem = newItems.get(key);
      const values = fields.flatMap((field) => {
        const oldValue = oldItem ? String(oldItem[field] ?? '') : undefined;
        const newValue = newItem ? String(newItem[field] ?? '') : undefined;
        return oldValue === newValue ? [] : [{ field, before: oldValue, after: newValue }];
      });
      if (values.length)
        changes.push({
          kind,
          key,
          title: titleOf(newItem ?? oldItem!),
          status: !oldItem ? 'added' : !newItem ? 'removed' : 'modified',
          fields: values,
        });
    }
  }
  compare(
    'flow',
    [before],
    [after],
    () => 'flow',
    (v) => v.title,
    ['title', 'entryNodeKey'],
  );
  compare(
    'node',
    before.nodes,
    after.nodes,
    (v) => v.nodeKey,
    (v) => v.title,
    ['title', 'instruction', 'expected'],
  );
  compare(
    'edge',
    before.edges,
    after.edges,
    (v) => v.edgeKey,
    (v) => v.trigger,
    ['sourceNodeKey', 'targetNodeKey', 'trigger', 'condition', 'required'],
  );
  return changes;
}
